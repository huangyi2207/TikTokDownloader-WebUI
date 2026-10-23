#!/usr/bin/env python3
"""Download works with the local DouK-Downloader project.

The TikTokDownloader API (port 5555) only extracts data and never saves files,
so Web UI "server download" jobs run here instead. This process uses the
project's own settings (root, folder, naming, cookies, proxy, ...) and its
Downloader, without modifying the server source.

It is started by server.py with the project's virtualenv Python.

Speed notes:
- URLs that already contain a work ID skip the link-resolution request.
- Link resolution and detail requests run with bounded concurrency.
- The upstream ``wait()`` random delay (1.5-33 s after every metadata
  request) is disabled in this worker because it only affects data
  requests, not file transfers. Set DOUK_KEEP_DELAY=1 to keep it.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
import time
import traceback
from pathlib import Path

MAX_CONCURRENCY = 4

DETAIL_ID_PATTERNS = {
    "douyin": (
        re.compile(r"/(?:video|note|slides)/(\d{15,25})"),
        re.compile(r"[?&](?:modal_id|aweme_id|item_id)=(\d{15,25})"),
    ),
    "tiktok": (
        re.compile(r"/(?:video|photo)/(\d{15,25})"),
        re.compile(r"[?&](?:modal_id|item_id)=(\d{15,25})"),
    ),
}
PURE_ID = re.compile(r"^\d{15,25}$")


def safe_folder_name(name: str) -> str:
    name = re.sub(r"[\x00-\x1f\x7f]", "", name or "")
    name = re.sub(r'[<>:"/\\|?*]', "_", name)
    return name.strip(" .")[:180]


def extract_detail_id(text: str, platform: str) -> str | None:
    """Return the work ID when the URL already contains it."""
    value = (text or "").strip()
    if PURE_ID.fullmatch(value):
        return value
    for pattern in DETAIL_ID_PATTERNS[platform]:
        if match := pattern.search(value):
            return match.group(1)
    return None


def disable_rate_limit_delay() -> None:
    """Remove the artificial delay before metadata requests.

    Upstream ``wait()`` sleeps 1.5-33 s (6 s on average) after every data
    request. It does not throttle file downloads, so it only adds latency
    between the user clicking "server download" and the transfer starting.
    """
    if os.environ.get("DOUK_KEEP_DELAY") == "1":
        return

    async def no_wait(**kwargs):
        return None

    import src.custom as custom

    custom.wait = no_wait
    for name, module in list(sys.modules.items()):
        # Keep the retry backoff in src.tools.retry: only the normal
        # request path should skip the delay.
        if (
            name.startswith("src.")
            and name != "src.tools.retry"
            and getattr(module, "wait", None) is not None
        ):
            module.wait = no_wait


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="DouK-Downloader worker")
    parser.add_argument(
        "--project",
        required=True,
        help="TikTokDownloader project directory",
    )
    parser.add_argument(
        "--url",
        action="append",
        required=True,
        help="work link; repeat for multiple works",
    )
    parser.add_argument(
        "--folder",
        default="",
        help="folder name under root (defaults to settings folder_name)",
    )
    return parser.parse_args()


async def run(project: Path, urls: list[str], folder: str) -> int:
    started = time.perf_counter()

    def log(message: str) -> None:
        print(f"[{time.perf_counter() - started:6.1f}s] {message}", flush=True)

    # The project resolves Volume/ and other relative paths from cwd.
    os.chdir(project)
    sys.path.insert(0, str(project))

    from src.application import TikTokDownloader
    from src.application.main_terminal import TikTok as Terminal
    from src.interface import Detail, DetailTikTok

    disable_rate_limit_delay()

    log("正在初始化下载器...")
    async with TikTokDownloader() as app:
        app.check_config()
        await app.check_settings(False)
        # No need to keep refreshing cookies in a short-lived download worker.
        app.event_cookie.set()

        if folder:
            # Downloader captures folder_name while being constructed below.
            app.parameter.folder_name = folder

        terminal = Terminal(
            app.parameter,
            app.database,
            server_mode=True,
        )
        if folder:
            terminal.downloader.folder_name = folder
        log("下载器初始化完成")

        print(f"项目目录：{project}")
        print(f"下载根目录：{terminal.parameter.root}")
        print(f"保存文件夹：{folder or terminal.parameter.folder_name}")

        semaphore = asyncio.Semaphore(MAX_CONCURRENCY)

        groups = {"douyin": [], "tiktok": []}
        for url in urls:
            groups["tiktok" if "tiktok.com" in url.lower() else "douyin"].append(url)

        resolved: dict[str, list[str]] = {}
        for platform, platform_urls in groups.items():
            if not platform_urls:
                continue
            links = (
                terminal.links_tiktok if platform == "tiktok" else terminal.links
            )
            ids: list[str] = []
            pending: list[str] = []
            for url in platform_urls:
                # Direct work links already contain the ID; resolving them
                # would download the full HTML page and wait several seconds.
                if detail_id := extract_detail_id(url, platform):
                    ids.append(detail_id)
                else:
                    pending.append(url)

            if pending:

                async def resolve_short_link(url: str) -> list[str]:
                    async with semaphore:
                        try:
                            found = await links.run(url)
                        except Exception:  # noqa: BLE001
                            traceback.print_exc()
                            return []
                        if not found:
                            print(f"无法提取作品 ID：{url}", file=sys.stderr)
                            return []
                        return list(found)

                log(f"解析短链接：{len(pending)} 个")
                for found in await asyncio.gather(
                    *(resolve_short_link(url) for url in pending)
                ):
                    ids.extend(found)

            ids = list(dict.fromkeys(ids))
            if ids:
                resolved[platform] = ids

        if not resolved:
            print("没有可下载的作品 ID", file=sys.stderr)
            return 2

        success = 0
        root, params, logger = terminal.record.run(terminal.parameter)
        async with logger(root, console=terminal.console, **params) as record:
            for platform, ids in resolved.items():
                tiktok = platform == "tiktok"
                processor = DetailTikTok if tiktok else Detail

                async def fetch_detail(detail_id: str):
                    async with semaphore:
                        try:
                            return await terminal.handle_detail_single(
                                processor,
                                None,
                                None,
                                detail_id,
                            )
                        except Exception:  # noqa: BLE001
                            traceback.print_exc()
                            return None

                log(f"获取 {platform} 作品数据：{len(ids)} 个")
                details = await asyncio.gather(*(fetch_detail(i) for i in ids))
                details = [detail for detail in details if detail]
                if not details:
                    print(f"{platform} 作品数据获取失败", file=sys.stderr)
                    continue

                try:
                    data = await terminal.extractor.run(
                        details,
                        record,
                        tiktok=tiktok,
                    )
                    log(f"开始下载 {platform} 作品：{len(data)} 个")
                    await terminal.downloader.run(data, "detail", tiktok=tiktok)
                    success += 1
                except Exception:  # noqa: BLE001 - keep other groups going
                    traceback.print_exc()
                    continue

        if not success:
            return 3
        log("服务端下载完成")
    return 0


def main() -> int:
    args = parse_args()
    project = Path(args.project).expanduser().resolve()
    if not (project / "src").is_dir():
        print(f"无效的项目目录：{project}", file=sys.stderr)
        return 2
    folder = safe_folder_name(args.folder)
    if args.folder and not folder:
        print("无效的文件夹名", file=sys.stderr)
        return 2
    try:
        return asyncio.run(run(project, args.url, folder))
    except Exception:  # noqa: BLE001 - full traceback goes to the job log
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
