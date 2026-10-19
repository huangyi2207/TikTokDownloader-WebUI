#!/usr/bin/env python3
"""Download works with the local DouK-Downloader project.

The TikTokDownloader API (port 5555) only extracts data and never saves files,
so Web UI "server download" jobs run here instead. This process uses the
project's own settings (root, folder, naming, cookies, proxy, ...) and its
Downloader, without modifying the server source.

It is started by server.py with the project's virtualenv Python.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
from pathlib import Path


def safe_folder_name(name: str) -> str:
    name = re.sub(r"[\x00-\x1f\x7f]", "", name or "")
    name = re.sub(r'[<>:"/\\|?*]', "_", name)
    return name.strip(" .")[:180]


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
    # The project resolves Volume/ and other relative paths from cwd.
    os.chdir(project)
    sys.path.insert(0, str(project))

    from src.application import TikTokDownloader
    from src.application.main_terminal import TikTok as Terminal

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

        print(f"项目目录：{project}")
        print(f"下载根目录：{terminal.parameter.root}")
        print(f"保存文件夹：{folder or terminal.parameter.folder_name}")

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
            for url in platform_urls:
                print(f"解析链接：{url}")
                try:
                    found = await links.run(url)
                except Exception:  # noqa: BLE001 - keep processing other links
                    import traceback

                    traceback.print_exc()
                    continue
                if not found:
                    print(f"无法提取作品 ID：{url}", file=sys.stderr)
                    continue
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
                print(f"开始下载 {platform} 作品：{len(ids)} 个")
                try:
                    result = await terminal._handle_detail(
                        ids,
                        platform == "tiktok",
                        record,
                    )
                except Exception:  # noqa: BLE001 - keep other groups going
                    import traceback

                    traceback.print_exc()
                    continue
                if result is None:
                    print(f"{platform} 作品数据获取失败", file=sys.stderr)
                else:
                    success += 1
        if not success:
            return 3
        print("服务端下载完成")
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
        import traceback

        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
