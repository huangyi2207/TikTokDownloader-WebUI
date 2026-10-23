#!/usr/bin/env python3
"""DouK Web UI local server.

Zero-dependency static file server + reverse proxy for the DouK-Downloader
API server (default http://127.0.0.1:5555).

The UI is served from this server's origin, so browser requests to /api/*
are same-origin and no CORS configuration is required on the API server.
A /download endpoint streams remote media with an attachment header so the
browser downloads it reliably instead of opening it inline.

A /server-download endpoint launches server_download.py with the local
TikTokDownloader project's virtualenv, so the project itself saves files into
its configured `root` directory. The bundled TikTokDownloader source contains
the settings-persistence fix; see README "全局配置".
"""

from __future__ import annotations

import argparse
import functools
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DEFAULT_API = "http://127.0.0.1:5555"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 18080
DEFAULT_PROJECT = Path(
    #os.environ.get("DOUK_PROJECT", r"D:\Dev\TikTokDownloader-develop")
    os.environ.get("DOUK_PROJECT", r"./TikTokDownloader")
)

PROJECT_DIR = DEFAULT_PROJECT
HELPER_SCRIPT = BASE_DIR / "server_download.py"
DOWNLOAD_JOBS: dict[str, dict] = {}
DOWNLOAD_JOBS_LOCK = threading.Lock()

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
        if self.path == "/server-download/jobs" or self.path.startswith(
            "/server-download/jobs?"
        ):
            return self._server_download_jobs()
        if self.path == "/server-download/log" or self.path.startswith(
            "/server-download/log?"
        ):
            return self._server_download_log()
        if self.path == "/server-download/status" or self.path.startswith(
            "/server-download/status?"
        ):
            return self._server_download_status()
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
        if self.path == "/server-download":
            return self._server_download()
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

    # -------------------------------------------------------- server download

    @staticmethod
    def _project_paths() -> tuple[Path, Path, Path] | None:
        project = PROJECT_DIR
        if not (project / "src").is_dir():
            return None
        python = next(
            (
                candidate
                for candidate in (
                    project / ".venv" / "Scripts" / "python.exe",
                    project / ".venv" / "bin" / "python",
                )
                if candidate.is_file()
            ),
            None,
        )
        if not python:
            return None
        return project, python, project / "Volume" / "settings.json"

    @staticmethod
    def _read_project_settings(path: Path) -> dict:
        try:
            with path.open("r", encoding="utf-8-sig") as file:
                data = json.load(file)
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    @staticmethod
    def _safe_folder_name(name: str) -> str:
        name = re.sub(r"[\x00-\x1f\x7f]", "", name or "")
        name = re.sub(r'[<>:"/\\|?*]', "_", name)
        return name.strip(" .")[:180]

    @staticmethod
    def _server_download_root(settings: dict, project: Path) -> Path:
        root = str(settings.get("root") or "").strip()
        if root:
            path = Path(root)
            if not path.is_absolute():
                path = project / path
            if path.is_dir():
                return path
        return project / "Volume"

    def _server_download(self) -> None:
        try:
            raw = self._read_body() or b"{}"
            if len(raw) > 8192:
                raise ValueError
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return self._error(HTTPStatus.BAD_REQUEST, "请求体不是有效的 JSON")
        if not isinstance(payload, dict):
            return self._error(HTTPStatus.BAD_REQUEST, "请求体不是有效的 JSON")

        raw_urls = payload.get("urls")
        if isinstance(raw_urls, list):
            urls = [str(item).strip() for item in raw_urls]
        else:
            urls = [str(payload.get("url") or "").strip()]
        urls = list(dict.fromkeys(url for url in urls if url))
        if not urls or len(urls) > 100:
            return self._error(
                HTTPStatus.BAD_REQUEST, "缺少作品链接，或一次提交超过 100 个"
            )
        if any(
            len(url) > 2048 or not re.match(r"^https?://\S+$", url, re.IGNORECASE)
            for url in urls
        ):
            return self._error(HTTPStatus.BAD_REQUEST, "包含无效的作品链接")
        # Keep the Windows command line well below its ~32K limit.
        if sum(len(url) + 8 for url in urls) > 20000:
            return self._error(
                HTTPStatus.BAD_REQUEST, "一次提交的链接过多或过长，请减少作品数量"
            )

        folder = self._safe_folder_name(str(payload.get("folder") or ""))
        if payload.get("folder") and not folder:
            return self._error(HTTPStatus.BAD_REQUEST, "无效的文件夹名")

        paths = self._project_paths()
        if not paths:
            return self._error(
                HTTPStatus.SERVICE_UNAVAILABLE,
                f"未找到 TikTokDownloader 项目或其 .venv：{PROJECT_DIR}。"
                "请用 --project 指定正确路径。",
            )
        project, python, settings_path = paths
        if not HELPER_SCRIPT.is_file():
            return self._error(
                HTTPStatus.INTERNAL_SERVER_ERROR, "缺少 server_download.py"
            )

        settings = self._read_project_settings(settings_path)
        if settings.get("download") is False:
            return self._error(
                HTTPStatus.CONFLICT,
                "全局配置中的 download 已关闭，服务端不会下载文件；"
                "请先在设置页启用下载功能。",
            )
        with DOWNLOAD_JOBS_LOCK:
            running = sum(
                1
                for job in DOWNLOAD_JOBS.values()
                if job.get("state") == "running"
            )
        if running >= 2:
            return self._error(
                HTTPStatus.TOO_MANY_REQUESTS,
                "已有服务端下载任务在运行，请等待完成后再试。",
            )

        job_id = uuid.uuid4().hex[:12]
        log_dir = BASE_DIR / "logs"
        try:
            log_dir.mkdir(exist_ok=True)
            log_path = log_dir / (
                f"server-download-{time.strftime('%Y%m%d-%H%M%S')}-{job_id}.log"
            )
            log_file = log_path.open("w", encoding="utf-8")
        except OSError as error:
            return self._error(
                HTTPStatus.INTERNAL_SERVER_ERROR, f"无法创建下载日志：{error}"
            )

        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUTF8"] = "1"
        env["NO_COLOR"] = "1"
        kwargs = {}
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        try:
            command = [
                str(python),
                str(HELPER_SCRIPT),
                "--project",
                str(project),
            ]
            if folder:
                command.extend(["--folder", folder])
            for url in urls:
                command.extend(["--url", url])
            process = subprocess.Popen(
                command,
                cwd=str(project),
                stdout=log_file,
                stderr=subprocess.STDOUT,
                env=env,
                **kwargs,
            )
        except Exception as error:  # noqa: BLE001 - report launch failures to the UI
            log_file.close()
            return self._error(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                f"启动服务端下载进程失败：{error}",
            )
        finally:
            log_file.close()

        root = self._server_download_root(settings, project)
        self._prune_download_jobs()
        with DOWNLOAD_JOBS_LOCK:
            DOWNLOAD_JOBS[job_id] = {
                "job_id": job_id,
                "urls": urls,
                "folder": folder,
                "state": "running",
                "started": time.time(),
                "finished": None,
                "code": None,
                "root": str(root),
                "log": str(log_path),
            }
        threading.Thread(
            target=self._wait_server_download,
            args=(job_id, process),
            daemon=True,
        ).start()
        self._send_json(
            HTTPStatus.ACCEPTED,
            {
                "message": "已提交服务端下载",
                "job_id": job_id,
                "root": str(root),
                "folder": folder,
                "count": len(urls),
                "log": str(log_path),
            },
        )

    @staticmethod
    def _wait_server_download(job_id: str, process: subprocess.Popen) -> None:
        code = process.wait()
        with DOWNLOAD_JOBS_LOCK:
            job = DOWNLOAD_JOBS.get(job_id)
            if job:
                job["state"] = "done" if code == 0 else "failed"
                job["code"] = code
                job["finished"] = time.time()

    @staticmethod
    def _prune_download_jobs() -> None:
        cutoff = time.time() - 6 * 60 * 60
        with DOWNLOAD_JOBS_LOCK:
            for old_id in [
                key
                for key, job in DOWNLOAD_JOBS.items()
                if job.get("finished") and job["finished"] < cutoff
            ]:
                DOWNLOAD_JOBS.pop(old_id, None)

    @staticmethod
    def _job_public(job: dict) -> dict:
        data = dict(job)
        urls = data.get("urls") or []
        started = float(data.get("started") or 0)
        end = data.get("finished") or time.time()
        data["elapsed"] = round(max(0.0, end - started), 1) if started else 0
        data["count"] = len(urls)
        data["first_url"] = urls[0] if urls else ""
        data.pop("urls", None)
        return data

    def _server_download_jobs(self) -> None:
        self._prune_download_jobs()
        with DOWNLOAD_JOBS_LOCK:
            all_jobs = [dict(job) for job in DOWNLOAD_JOBS.values()]
        all_jobs.sort(key=lambda job: job.get("started") or 0, reverse=True)
        jobs = [self._job_public(job) for job in all_jobs[:100]]
        self._send_json(
            HTTPStatus.OK,
            {
                "jobs": jobs,
                "total": len(all_jobs),
                "running": sum(
                    1 for job in all_jobs if job.get("state") == "running"
                ),
                "done": sum(1 for job in all_jobs if job.get("state") == "done"),
                "failed": sum(
                    1 for job in all_jobs if job.get("state") == "failed"
                ),
            },
        )

    def _server_download_log(self) -> None:
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        job_id = (query.get("job_id") or [""])[0]
        with DOWNLOAD_JOBS_LOCK:
            job = dict(DOWNLOAD_JOBS.get(job_id) or {})
        if not job:
            return self._error(HTTPStatus.NOT_FOUND, "下载任务不存在或已过期")
        log_path = Path(str(job.get("log") or ""))
        if not log_path.is_file():
            return self._error(HTTPStatus.NOT_FOUND, "日志文件不存在")
        try:
            with log_path.open("rb") as file:
                file.seek(0, os.SEEK_END)
                size = file.tell()
                file.seek(max(0, size - 65536))
                raw = file.read()
        except OSError as error:
            return self._error(
                HTTPStatus.INTERNAL_SERVER_ERROR, f"读取日志失败：{error}"
            )
        text = raw.decode("utf-8", errors="replace")
        text = re.sub(r"\x1b\[[0-9;]*m", "", text)
        self._send_json(
            HTTPStatus.OK,
            {
                "job_id": job_id,
                "log": str(log_path),
                "truncated": size > len(raw),
                "text": text,
            },
        )

    def _server_download_status(self) -> None:
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        job_id = (query.get("job_id") or [""])[0]
        with DOWNLOAD_JOBS_LOCK:
            job = DOWNLOAD_JOBS.get(job_id)
            data = dict(job) if job else None
        if not data:
            return self._error(HTTPStatus.NOT_FOUND, "下载任务不存在或已过期")
        self._send_json(HTTPStatus.OK, self._job_public(data))

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
    parser.add_argument(
        "--project",
        default=os.environ.get("DOUK_PROJECT", str(DEFAULT_PROJECT)),
        help=(
            "TikTokDownloader project directory used by server downloads "
            f"(default: {DEFAULT_PROJECT})"
        ),
    )
    return parser.parse_args()


def main() -> int:
    global API_BASE, PROJECT_DIR

    args = parse_args()
    API_BASE = args.api.rstrip("/")
    if not re.match(r"^https?://", API_BASE, re.IGNORECASE):
        API_BASE = f"http://{API_BASE}"
    PROJECT_DIR = Path(args.project).expanduser().resolve()

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
    print(f"  Server download -> {PROJECT_DIR}")
    if not (PROJECT_DIR / "src").is_dir():
        print("  [WARN] TikTokDownloader project not found; server download disabled.")
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
