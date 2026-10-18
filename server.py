#!/usr/bin/env python3
"""DouK Web UI local server.

Zero-dependency static file server + reverse proxy for the DouK-Downloader
API server (default http://127.0.0.1:5555).

The UI is served from this server's origin, so browser requests to /api/*
are same-origin and no CORS configuration is required on the API server.
A /download endpoint streams remote media with an attachment header so the
browser downloads it reliably instead of opening it inline.
"""

from __future__ import annotations

import argparse
import functools
import json
import mimetypes
import os
import re
import shutil
import sys
import urllib.error
import urllib.parse
import urllib.request
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DEFAULT_API = "http://127.0.0.1:5555"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 18080

API_TIMEOUT = 1800
DOWNLOAD_TIMEOUT = 300
CHUNK_SIZE = 64 * 1024
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

API_BASE = DEFAULT_API
# Never route localhost API calls through a system HTTP proxy.
LOCAL_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
# Remote media downloads honour the system proxy settings (if any).
REMOTE_OPENER = urllib.request.build_opener()


class WebUIHandler(SimpleHTTPRequestHandler):
    server_version = "DouKWebUI/1.0"
    protocol_version = "HTTP/1.1"

    # ---------------------------------------------------------------- helpers

    def _send_bytes(
        self,
        status: int,
        payload: bytes,
        content_type: str = "application/json; charset=utf-8",
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _send_json(self, status: int, data: dict) -> None:
        self._send_bytes(
            status,
            json.dumps(data, ensure_ascii=False).encode("utf-8"),
        )

    def _error(self, status: int, message: str) -> None:
        self._send_json(status, {"detail": message})

    @staticmethod
    def _api_target(path: str) -> str:
        parsed = urllib.parse.urlsplit(path)
        suffix = parsed.path[len("/api"):] or "/"
        if not suffix.startswith("/"):
            suffix = "/" + suffix
        query = f"?{parsed.query}" if parsed.query else ""
        return f"{API_BASE}{suffix}{query}"

    # ----------------------------------------------------------------- routes

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/docs", "/redoc", "/openapi.json"):
            self._redirect(f"{API_BASE}{self.path}")
            return
        if self.path == "/webui-config.json":
            return self._send_json(
                HTTPStatus.OK,
                {
                    "api_base": API_BASE,
                    "docs": f"{API_BASE}/docs",
                    "redoc": f"{API_BASE}/redoc",
                },
            )
        if self.path == "/api" or self.path.startswith("/api/"):
            return self._proxy()
        if self.path == "/media" or self.path.startswith("/media?"):
            return self._media()
        if self.path == "/download" or self.path.startswith("/download?"):
            return self._download()
        if self.path in ("", "/"):
            self.path = "/index.html"
        return super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802
        if self.path == "/api" or self.path.startswith("/api/"):
            return self._proxy()
        if self.path == "/media" or self.path.startswith("/media?"):
            return self._media()
        if self.path in ("", "/"):
            self.path = "/index.html"
        return super().do_HEAD()

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/api" or self.path.startswith("/api/"):
            return self._proxy()
        self._error(HTTPStatus.NOT_FOUND, "Not Found")

    def do_PUT(self) -> None:  # noqa: N802
        if self.path == "/api" or self.path.startswith("/api/"):
            return self._proxy()
        self._error(HTTPStatus.METHOD_NOT_ALLOWED, "Method Not Allowed")

    def do_DELETE(self) -> None:  # noqa: N802
        if self.path == "/api" or self.path.startswith("/api/"):
            return self._proxy()
        self._error(HTTPStatus.METHOD_NOT_ALLOWED, "Method Not Allowed")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Allow", "GET, HEAD, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _redirect(self, location: str) -> None:
        self.send_response(HTTPStatus.TEMPORARY_REDIRECT)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    # ------------------------------------------------------------------ proxy

    def _read_body(self) -> bytes | None:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return None
        return self.rfile.read(length)

    def _proxy(self) -> None:
        target = self._api_target(self.path)
        body = self._read_body()
        request = urllib.request.Request(target, data=body, method=self.command)
        request.add_header(
            "Content-Type", self.headers.get("Content-Type") or "application/json"
        )
        token = self.headers.get("token")
        if token:
            request.add_header("token", token)
        accept = self.headers.get("Accept")
        if accept:
            request.add_header("Accept", accept)

        try:
            with LOCAL_OPENER.open(request, timeout=API_TIMEOUT) as response:
                payload = response.read()
                self._send_bytes(
                    response.status,
                    payload,
                    response.headers.get(
                        "Content-Type", "application/json; charset=utf-8"
                    ),
                    {"Cache-Control": "no-store"},
                )
        except urllib.error.HTTPError as error:
            payload = error.read()
            content_type = (
                error.headers.get("Content-Type", "application/json; charset=utf-8")
                if error.headers
                else "application/json; charset=utf-8"
            )
            self._send_bytes(
                error.code, payload, content_type, {"Cache-Control": "no-store"}
            )
        except Exception as error:  # noqa: BLE001 - surface any proxy failure
            self._send_json(
                HTTPStatus.BAD_GATEWAY,
                {
                    "detail": (
                        f"无法连接 API 服务 {API_BASE}：{error}。"
                        "请确认 DouK-Downloader 已以 API 模式运行在 5555 端口。"
                    )
                },
            )

    # --------------------------------------------------------------- download

    @staticmethod
    def _referer_for(url: str) -> str:
        host = urllib.parse.urlsplit(url).netloc.lower()
        return "https://www.tiktok.com/" if "tiktok" in host else "https://www.douyin.com/"

    def _media(self) -> None:
        """Inline media proxy with Range support for <video> playback.

        Douyin/TikTok CDNs frequently reject direct browser requests (hotlink
        protection), while the same URL works when a platform Referer and a
        desktop User-Agent are supplied. Range headers are forwarded so the
        browser can seek.
        """
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        url = (query.get("url") or [""])[0]
        if not re.match(r"^https?://", url, re.IGNORECASE):
            self._error(HTTPStatus.BAD_REQUEST, "Missing or invalid url parameter")
            return

        headers = {
            "User-Agent": USER_AGENT,
            "Referer": self._referer_for(url),
            "Accept": "*/*",
        }
        range_header = self.headers.get("Range")
        if range_header:
            headers["Range"] = range_header

        request = urllib.request.Request(url, headers=headers)
        try:
            remote = REMOTE_OPENER.open(request, timeout=DOWNLOAD_TIMEOUT)
        except urllib.error.HTTPError as error:
            if error.code == HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                if content_range := error.headers.get("Content-Range"):
                    self.send_header("Content-Range", content_range)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self._error(
                HTTPStatus.BAD_GATEWAY,
                f"远程媒体返回 HTTP {error.code}，链接可能已过期。",
            )
            return
        except Exception as error:  # noqa: BLE001
            self._error(HTTPStatus.BAD_GATEWAY, f"媒体代理失败：{error}")
            return

        with remote:
            self.close_connection = True
            self.send_response(remote.status)
            self.send_header(
                "Content-Type",
                remote.headers.get("Content-Type", "application/octet-stream"),
            )
            content_length = remote.headers.get("Content-Length")
            if content_length:
                self.send_header("Content-Length", content_length)
            content_range = remote.headers.get("Content-Range")
            if content_range:
                self.send_header("Content-Range", content_range)
            accept_ranges = remote.headers.get("Accept-Ranges")
            if accept_ranges or remote.status == HTTPStatus.PARTIAL_CONTENT:
                self.send_header("Accept-Ranges", accept_ranges or "bytes")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            if self.command == "HEAD":
                return
            try:
                shutil.copyfileobj(remote, self.wfile, CHUNK_SIZE)
            except (BrokenPipeError, ConnectionResetError):
                pass

    @staticmethod
    def _safe_filename(name: str) -> str:
        name = re.sub(r"[\x00-\x1f\x7f]", "", name or "").strip()
        name = re.sub(r'[<>:"/\\|?*]', "_", name)
        name = name.strip(" .")
        return name[:150]

    @staticmethod
    def _infer_extension(url: str, content_type: str) -> str:
        suffix = Path(urllib.parse.urlsplit(url).path).suffix.lower()
        if suffix and len(suffix) <= 6:
            return suffix
        guessed = mimetypes.guess_extension(
            (content_type or "").split(";")[0].strip()
        )
        return guessed or ".bin"

    @staticmethod
    def _content_disposition(name: str) -> str:
        fallback = name.encode("ascii", "replace").decode("ascii")
        fallback = fallback.replace("?", "_").replace("\\", "_").replace('"', "_")
        quoted = urllib.parse.quote(name, safe="")
        return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quoted}"

    def _download(self) -> None:
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        url = (query.get("url") or [""])[0]
        name = self._safe_filename((query.get("name") or [""])[0])
        if not re.match(r"^https?://", url, re.IGNORECASE):
            self._error(HTTPStatus.BAD_REQUEST, "Missing or invalid url parameter")
            return

        referer = self._referer_for(url)
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Referer": referer,
                "Accept": "*/*",
            },
        )
        try:
            with REMOTE_OPENER.open(request, timeout=DOWNLOAD_TIMEOUT) as remote:
                content_type = remote.headers.get(
                    "Content-Type", "application/octet-stream"
                )
                length = remote.headers.get("Content-Length")
                if not name:
                    name = f"download{self._infer_extension(url, content_type)}"
                elif not Path(name).suffix:
                    name += self._infer_extension(url, content_type)

                self.close_connection = True
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", content_type)
                if length:
                    self.send_header("Content-Length", length)
                self.send_header("Content-Disposition", self._content_disposition(name))
                self.send_header("Connection", "close")
                self.end_headers()
                try:
                    shutil.copyfileobj(remote, self.wfile, CHUNK_SIZE)
                except (BrokenPipeError, ConnectionResetError):
                    pass
        except urllib.error.HTTPError as error:
            self._error(
                HTTPStatus.BAD_GATEWAY,
                f"远程资源返回 HTTP {error.code}，下载链接可能已过期。",
            )
        except Exception as error:  # noqa: BLE001
            self._error(HTTPStatus.BAD_GATEWAY, f"下载失败：{error}")

    # ------------------------------------------------------------------ misc

    def end_headers(self) -> None:
        if not (
            self.path.startswith("/api")
            or self.path.startswith("/download")
            or self.path.startswith("/media")
        ):
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        # Keep the console quiet during normal use; log client errors only.
        if args and str(args[1]).startswith(("4", "5")):
            sys.stderr.write(f"[webui] {self.address_string()} - {format % args}\n")


def check_api(api_base: str) -> str | None:
    try:
        with LOCAL_OPENER.open(f"{api_base}/openapi.json", timeout=4) as response:
            spec = json.load(response)
        info = spec.get("info", {})
        title = info.get("title", "API")
        version = info.get("version", "")
        return f"{title} {version}".strip()
    except Exception:  # noqa: BLE001
        return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="DouK Web UI local server")
    parser.add_argument(
        "--host",
        default=os.environ.get("DOUK_WEB_HOST", DEFAULT_HOST),
        help=f"listen host (default: {DEFAULT_HOST})",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("DOUK_WEB_PORT", DEFAULT_PORT)),
        help=f"listen port (default: {DEFAULT_PORT})",
    )
    parser.add_argument(
        "--api",
        default=os.environ.get("DOUK_API", DEFAULT_API),
        help=f"API server base URL (default: {DEFAULT_API})",
    )
    return parser.parse_args()


def main() -> int:
    global API_BASE

    args = parse_args()
    API_BASE = args.api.rstrip("/")
    if not re.match(r"^https?://", API_BASE, re.IGNORECASE):
        API_BASE = f"http://{API_BASE}"

    if not STATIC_DIR.is_dir():
        print(f"[webui] static directory not found: {STATIC_DIR}", file=sys.stderr)
        return 1

    handler = functools.partial(WebUIHandler, directory=str(STATIC_DIR))
    try:
        httpd = ThreadingHTTPServer((args.host, args.port), handler)
    except OSError as error:
        print(
            f"[webui] cannot listen on {args.host}:{args.port}: {error}\n"
            "        Another process may be using this port; try --port 8081.",
            file=sys.stderr,
        )
        return 1

    backend = check_api(API_BASE)
    print()
    print("  DouK Web UI")
    print(f"  -> http://{args.host}:{args.port}")
    if backend:
        print(f"  API {API_BASE}  [connected: {backend}]")
    else:
        print(f"  API {API_BASE}  [NOT CONNECTED]")
        print("  Start DouK-Downloader in API mode first (port 5555).")
    print("  Press Ctrl+C to stop.")
    print()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[webui] stopped")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
