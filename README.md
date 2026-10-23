# TikTokDownloader Web UI

面向 [JoeanAmier/TikTokDownloader](https://github.com/JoeanAmier/TikTokDownloader) **API 模式**的本地可视化 Web 界面。

本目录是独立的配套工具，前端不需要原 API 服务开启 CORS。

- 前端：原生 HTML / CSS / JavaScript，无构建、无 CDN、可离线使用
- 后端：Python 标准库，**无第三方依赖**
- 自带反向代理、媒体防盗链代理、流式下载与服务端下载工作进程
- 附带的 `TikTokDownloader/`（来自 [huangyi2207/TikTokDownloader](https://github.com/huangyi2207/TikTokDownloader)）已包含「全局配置」保存修复（原版 API 的 `POST /settings` 只改内存、不写 `settings.json`，且普通字段实际未生效）；详见下方 [全局配置](#全局配置)。

***

## 功能

| 模块      | 说明                                                                                  |
| ------- | ----------------------------------------------------------------------------------- |
| 作品解析    | 分享文案 / 短链接 / 作品链接 / 作品 ID，自动识别抖音与 TikTok；视频播放、图集画廊、服务端 / 浏览器下载                      |
| 账号作品    | 采集发布页 / 喜欢页，支持日期范围、分页与游标                                                            |
| 合集作品    | 通过合集 ID 或合集内作品 ID 获取列表                                                              |
| 直播解析    | 获取直播间信息与 FLV / HLS 拉流地址                                                             |
| 评论采集    | 一级评论、回复、评论图片与表情                                                                     |
| 搜索发现    | 综合 / 视频 / 用户 / 直播搜索（仅抖音）                                                            |
| 服务端下载   | 单个 / 批量由本机 TikTokDownloader 下载到全局配置的 `root`；账号作品使用 `UID{uid}_{nickname}_发布作品` 专属文件夹 |
| 服务端任务   | 查看运行中 / 已完成 / 失败任务、保存目录、耗时，并可在线查看任务日志                                               |
| 浏览器批量下载 | 结果列表按作品勾选批量下载；图集 / 实况自动包含全部文件                                                       |
| 全局配置    | 读取并更新服务端 `settings.json`，只提交发生变化的字段                                                 |
| 其他      | 令牌管理、API 连接状态、深浅主题、最近解析记录、JSON 查看 / 导出                                              |

***

## 环境要求

1. **Python 3.12 或更高版本**：TikTokDownloader 要求 Python ≥ 3.12；Web UI 自身只使用标准库（3.10+ 即可），两者共用一个解释器最省事。
2. **TikTokDownloader 与 Web UI 在同一台机器上**，且 TikTokDownloader 以 **Web API 模式** 运行（默认地址 `http://127.0.0.1:5555`）。
   - 可访问 <http://127.0.0.1:5555/docs> 或 <http://127.0.0.1:5555/redoc> 确认 API 正常。
   - TikTokDownloader 参考文档 [TikTokDownloader#快速入门](https://github.com/JoeanAmier/TikTokDownloader#%E5%BF%AB%E9%80%9F%E5%85%A5%E9%97%A8)
3. 现代浏览器（Chrome / Edge / Firefox 等）。

按下方 [快速开始](#快速开始) 从零克隆、安装、启动即可跑通全流程。

***

## 目录结构

```text
TikTokDownloader-WebUI/
├── server.py             # 本地静态服务器 + API 反向代理 + 媒体下载代理
├── server_download.py    # 服务端下载工作进程（调用本机 DouK 项目）
├── start_webui.bat       # Windows 启动脚本
├── logs/                 # 服务端下载日志（运行时创建）
├── README.md
├── static/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
└── TikTokDownloader/     # 克隆的同级项目（默认路径，可省略改用 --project）
    ├── main.py
    ├── requirements.txt
    ├── .venv/            # 按「快速开始」第 2 步创建
    └── src/
```

***

## 快速开始

按顺序执行以下 5 步即可从零跑起来。Windows 用 PowerShell / Git Bash，Linux / macOS 用终端，命令基本一致（仅虚拟环境路径不同）。

### 第 1 步：克隆 Web UI 与 TikTokDownloader

```bash
git clone https://github.com/huangyi2207/TikTokDownloader-WebUI
cd TikTokDownloader-WebUI
git clone https://github.com/huangyi2207/TikTokDownloader
```

`TikTokDownloader` 需要克隆在 Web UI 根目录下、并保持目录名不变，Web UI 默认就从 `./TikTokDownloader` 调用它。完成后目录应如下：

```text
TikTokDownloader-WebUI/
├── server.py
├── server_download.py
├── start_webui.bat
├── static/
├── README.md
└── TikTokDownloader/        # 上一步克隆的 TikTokDownloader
    ├── main.py
    ├── requirements.txt
    └── src/
```

> 想放到其他位置也可以，启动 Web UI 时用 `--project <路径>` 或环境变量 `DOUK_PROJECT` 指定，详见 [配置参数](#配置参数)。

### 第 2 步：安装 TikTokDownloader 依赖

TikTokDownloader 需要 Python **3.12+**。虚拟环境必须建在 `TikTokDownloader/.venv` —— Web UI 的「服务端下载」会用它启动下载进程，缺失时会提示“未找到 TikTokDownloader 项目或其 .venv”。

Windows：

```bat
cd TikTokDownloader
python -m venv .venv
.venv\Scripts\python.exe -m pip install -U pip
.venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..
```

Linux / macOS：

```bash
cd TikTokDownloader
python3 -m venv .venv
.venv/bin/python -m pip install -U pip
.venv/bin/python -m pip install -r requirements.txt
cd ..
```

> 已安装 [uv](https://github.com/astral-sh/uv) 时，也可在 `TikTokDownloader` 目录执行 `uv sync`，同样会在该目录生成 `.venv`。
> 下载缓慢可换国内镜像（如 `-i https://pypi.tuna.tsinghua.edu.cn/simple`）；若镜像报 `No matching distribution found`，改用官方源 `-i https://pypi.org/simple` 重试。

### 第 3 步：以 Web API 模式启动 TikTokDownloader

```bat
cd TikTokDownloader
.venv\Scripts\python.exe main.py
```

Linux / macOS 把最后一行换成 `.venv/bin/python main.py`。

首次启动会要求选择语言并输入 `YES` 确认免责声明，之后在功能菜单中选择 **「Web API 模式」**（列表第 7 项）。出现以下提示即启动成功：

```text
访问 http://127.0.0.1:5555/docs 或者 http://127.0.0.1:5555/redoc 可以查阅 API 模式说明文档！
```

首次运行会在 `TikTokDownloader/Volume/` 下生成 `settings.json`，Cookie、下载目录等配置都在这里维护。**这个终端窗口需要保持运行**，不要关闭（后续可用 `Ctrl+C` 退出）。

### 第 4 步：启动 Web UI

另开一个终端，回到项目根目录：

```bash
cd ..                 # 若上一个终端仍停在 TikTokDownloader 目录
python server.py      # 或 python3 server.py
```

Windows 也可以在资源管理器中双击 `start_webui.bat`。Web UI 只用标准库，无需再安装依赖。

若 TikTokDownloader 不在默认路径：

```bash
python server.py --project "/path/to/TikTokDownloader"
```

### 第 5 步：打开页面

浏览器访问：

```text
http://127.0.0.1:18080
```

页面左下角显示 **API 已连接** 即表示前端与 API 都正常，可以开始解析作品。

> 使用「服务端下载」前，请确认全局配置中的 `download` 已启用（默认启用），否则按钮会提示并拒绝提交。

***

## 使用说明

### 作品解析

1. 在输入框粘贴任意一种内容：
   - 抖音 / TikTok 分享文案（含短链接）
   - 作品链接，例如 `https://www.douyin.com/video/...`
   - 作品 ID（纯数字）
2. 点击 **解析作品**。短链接会先自动展开为完整链接。
3. 结果页可以：
   - 播放视频 / 浏览图集
   - **服务端下载**（保存到全局配置的 `root` 目录）或 **浏览器下载**视频、音乐、封面
   - 查看 / 导出原始 JSON
   - 图集或实况可逐个下载或 **浏览器下载全部**
4. **高级选项** 中可以临时填写 Cookie、请求代理，适用于接口报错或需要登录数据的场景。

### 下载方式

结果页包含两类下载按钮：

- **服务端下载**
  - Web UI 会在本机启动 `server_download.py` 工作进程，调用 TikTokDownloader 项目自身的下载器，按全局配置的 `root`、文件夹 / 命名规则、Cookie、代理、音乐 / 封面等设置保存文件。
  - 工作进程只导入项目模块并调用其现有下载逻辑，不会改动 TikTokDownloader 的源码。
  - 账号作品的批量下载会保存到 `root/UID{uid}_{nickname}_发布作品`（喜欢页为 `_喜欢作品`）。
  - 链接中已包含作品 ID 时不再额外请求页面解析；短链接与作品详情按 4 路并发获取。
  - 工作进程默认跳过上游元数据请求之间的人为随机延时（平均约 6 秒，文件下载本身不受影响）。若担心触发平台风控，可在启动 Web UI 前设置环境变量 `DOUK_KEEP_DELAY=1` 恢复上游限速。
  - 日志每行前的 `[ x.xs]` 为该阶段耗时，可用于定位慢在初始化、解析还是下载。
  - TikTokDownloader 的 API 模式只提取数据、不会下载文件，因此服务端下载要求 Web UI 与 TikTokDownloader 项目位于同一台机器。
  - 默认项目路径为 `./TikTokDownloader`，可通过 `python server.py --project <路径>` 或环境变量 `DOUK_PROJECT` 修改。
  - 全局配置中的 `download` 必须为启用状态，否则按钮会提示并拒绝提交。
  - 下载日志保存在 `logs/server-download-*.log`，失败时页面会提示日志路径。
  - 提交后可在左侧 **服务端任务** 查看运行状态、保存目录、耗时，并点击 **日志** 在线查看。
- **浏览器下载**
  - 由浏览器逐个下载文件，保存位置由浏览器决定（通常为系统“下载”文件夹），不受 `root` 影响。

### 账号作品

- 填写 `sec_uid`，或直接粘贴抖音账号主页链接（会自动提取）。
- 选择 **发布作品 / 喜欢作品**。
- 可设置最大页数、每页数量、起始游标、最早 / 最晚发布日期。
- 喜欢页通常需要登录 Cookie 才能获取完整数据。
- TikTok 主页链接不含 secUid，请手动填写以 `MS4wLjAB` 开头的 secUid。

### 合集作品

- 填写合集 ID / 合集链接，或填写合集内任意作品 ID / 作品链接（二选一，合集 ID 优先级更高）。
- 可设置游标和每页数量。
- TikTok 合集接口只接受 `mix_id`。

### 直播解析

- 抖音：填写 `web_rid` 或直播链接（如 `https://live.douyin.com/<web_rid>`）。
- TikTok：填写直播间 `room_id`。
- 结果会展示直播间信息、观看人数、封面以及 FLV / HLS 拉流地址，可复制或直接打开。

### 评论采集

- 仅支持抖音。
- 填写作品 ID 或作品链接。
- 可设置页数、每页数量、游标、每条评论的回复数量，并可选择是否同时采集回复。
- 登录 Cookie 能提高评论获取的完整度。

### 搜索发现

- 仅支持抖音，提供 **综合 / 视频 / 用户 / 直播** 四种搜索。
- 支持排序、发布时间、视频时长、搜索范围、内容形式、粉丝数量、认证类型等筛选条件。
- 用户搜索结果可直接点击 **采集作品** 跳转到账号采集。

### 批量下载

有两条路径：

1. **账号 / 合集 / 搜索结果**：结果摘要栏右侧 → **批量下载**
   - 按作品勾选（支持全选 / 全不选）
   - 视频按 1 个文件计；图集、实况包含其全部图片 / 视频文件
   - **浏览器下载所选** 逐个触发浏览器下载
   - **服务端下载所选** 由本机 TikTokDownloader 下载；账号作品会使用 `UID{uid}_{nickname}_发布作品` 专属文件夹
2. **图集 / 实况详情页**：点击 **浏览器下载全部 N 张图片 / N 个文件**

> 浏览器批量下载固定写入浏览器下载目录；需要保存到 `root` 目录时请使用 **服务端下载**。

> 首次批量下载时，浏览器会询问是否允许下载多个文件，请选择 **允许**。
> 若下载被拦截，可点击地址栏右侧的下载图标放行后重试。

### 全局配置

- 页面加载时会读取服务端 `/settings`，保存时 **只提交发生变化的字段**。
- 保存会同时更新 API 运行时内存与 `TikTokDownloader/Volume/settings.json`，重启 API 后仍然生效。
- Cookie、浏览器信息等敏感数据仅在本机浏览器与本地 API 之间传输。
- `timeout`、`live_qualities`、抖音 / TikTok 平台开关现已随 `/settings` 回显。
- 浏览器信息仍不回显实际值；留空 / 保持 `{}` 不会修改服务端已有配置。
- 当前服务端把 `owner_url_tiktok` 固定为 `null`（该功能未生效），设置页以只读方式展示，不会提交该字段。
- 修改前建议先点击 **导出** 备份当前配置。
- 保存后前端会重新读取 `/settings` 并以服务端实际值为准渲染；若 API 尚未重启到修复版本，会提示「服务端未应用以下配置」。
- 修复涉及的文件：`src/application/main_server.py`、`src/config/parameter.py`、`src/models/settings.py`。使用其他位置的 TikTokDownloader 时，请同步这些修改后重启 API 服务。

### API 令牌

- 项目默认不需要令牌。
- 如果服务端在 `src/custom/function.py` 的 `is_valid_token()` 中启用了令牌校验：
  1. 点击右上角 **令牌**
  2. 填入请求头 `token` 的值
  3. 点击 **测试连接** 验证后保存
- 令牌只保存在浏览器 `localStorage` 中。

***

## 配置参数

```text
python3 server.py [--host 127.0.0.1] [--port 18080] [--api http://127.0.0.1:5555]
```

| 参数       | 默认值                     | 说明                        |
| -------- | ----------------------- | ------------------------- |
| `--host` | `127.0.0.1`             | Web UI 监听地址。默认仅本机可访问      |
| `--port` | `18080`                 | Web UI 端口，被占用时换一个即可       |
| `--api`  | `http://127.0.0.1:5555` | TikTokDownloader API 服务地址 |

也支持环境变量：`DOUK_WEB_HOST`、`DOUK_WEB_PORT`、`DOUK_API`。

示例：

```bash
# Linux / macOS：换端口，并连接远程 API
python3 server.py --port 8080 --api http://192.168.1.10:5555

# 通过环境变量
DOUK_WEB_PORT=8080 DOUK_API=http://127.0.0.1:5555 python3 server.py

# Windows
start_webui.bat --port 8080
```

***

## 工作原理

```text
浏览器 ──同源请求──> Web UI (18080) ──反向代理──> TikTokDownloader API (5555)
                        ├── /media           媒体预览代理（补 Referer、转发 Range）
                        ├── /download        远程文件流式下载（附件保存）
                        └── /server-download 启动本机 DouK 下载进程（写入 root）
```

| 路径                                   | 作用                                                |
| ------------------------------------ | ------------------------------------------------- |
| `/api/*`                             | 反向代理到 API 服务，并转发 `token` 请求头                      |
| `/docs`、`/redoc`、`/openapi.json`     | 307 重定向到 API 服务的对应文档                              |
| `/media?url=...`                     | 视频 / 图片预览代理，解决抖音 / TikTok CDN 防盗链与 Range 播放       |
| `/download?url=...&name=...`         | 流式下载远程媒体，强制以附件保存                                  |
| `/server-download`                   | `POST` 作品链接，启动本机 TikTokDownloader 下载进程并保存到 `root` |
| `/server-download/jobs`              | 列出服务端下载任务及运行状态                                    |
| `/server-download/status?job_id=...` | 查询单个任务状态                                          |
| `/server-download/log?job_id=...`    | 读取任务日志末尾内容                                        |
| `/webui-config.json`                 | 前端读取当前 API 地址与文档链接                                |

- 访问本地 API 时始终绕过系统代理；远程媒体下载遵循系统代理设置。
- 图片与视频预览必须经过 `/media`，直连 CDN 可能出现黑屏或破图。

***

## 常见问题

**页面左下角显示“API 未连接”**

- 确认 TikTokDownloader 正在以 API 模式运行，端口为 5555。
- 访问 <http://127.0.0.1:5555/docs> 是否正常。
- API 不在本机或端口不同：启动 UI 时加 `--api http://host:port`。

**端口 18080 被占用**

```bash
python3 server.py --port 8081        # Linux / macOS
start_webui.bat --port 8081          # Windows
```

**视频无法播放 / 图片破图**

- 确认 UI 服务已重启到最新版本，并强制刷新页面（`Ctrl+F5`）。
- 预览统一走 `/media` 代理；若仍失败，可能是源文件过期或视频编码为浏览器不支持的 H.265，此时下载后可本地播放。

**批量下载只下载了第一个文件**

- 浏览器拦截了后续下载。点击地址栏右侧的下载图标，允许本站下载多个文件后重试。

**服务端下载提示“未找到 TikTokDownloader 项目”**

- Web UI 启动时通过 `--project` 或环境变量 `DOUK_PROJECT` 定位项目目录，路径下需存在 `src` 和 `.venv`。
- `.venv` 缺失：按 [快速开始](#快速开始) 第 2 步在 `TikTokDownloader` 目录创建虚拟环境并安装依赖；不要建在 Web UI 根目录。
- 服务端下载需要在 Web UI 所在机器上运行 TikTokDownloader 项目；仅启动 5555 端口的 API 模式无法让 API 自己下载文件。

**服务端下载失败**

- 打开 `logs/server-download-*.log` 查看具体错误。
- 确认全局配置中的 `download` 已启用，且 Cookie / 代理可用。
- 服务端下载会启动独立的 TikTokDownloader 进程，请避免同一作品重复点击。

**服务端任务列表为空 / 看不到任务**

- 任务列表保存在 Web UI 进程内存中，重启 `server.py` 后会清空；日志文件仍保留在 `logs/` 目录。
- 确认 Web UI 已重启到最新版本（需要 `server.py` 支持 `/server-download/jobs`）。

**保存设置后没有生效 / 提示“服务端未应用以下配置”**

- 需要重启 API 服务，使其加载本项目附带的修复（`src/application/main_server.py`、`src/config/parameter.py`、`src/models/settings.py`）。
- 确认 5555 端口运行的是本目录下的 `TikTokDownloader`；若使用其他副本，请同步上述文件后重启。
- 保存后页面会重新读取 `/settings` 并以服务端实际值为准；被服务端校验拒绝的值（如无效代理、无效目录）会列在该提示中。
- 若返回 403，请先配置令牌。
- 浏览器信息仍不在 `/settings` 中回显；保持 `{}` 不会修改服务端已有配置。
- 服务端设置接口会重新创建网络客户端，保存后短暂等待即可。

**搜索 / 评论没有数据**

- 这两个接口仅支持抖音。
- 部分数据需要登录 Cookie；可在高级选项中临时填写，或在全局配置中更新 Cookie。

**TikTok 直播返回 500**

- 5.8.stable 的 TikTok 直播接口存在 `room_id` 字段缺失问题，属于服务端已知问题；可关注上游版本更新。

***

## 安全提示

- UI 默认只监听 `127.0.0.1`，请勿直接暴露到公网。
- 如需远程访问，推荐使用 SSH 端口转发：
  ```bash
  ssh -L 18080:127.0.0.1:18080 user@server
  ```
- 如果必须修改 `--host` 对外监听，请自行增加 HTTPS、访问认证和防火墙限制。
- 设置页会显示 Cookie 等敏感信息；不要把截图或导出的配置 JSON 分享给他人。
- `/download` 会代理任意 http(s) 地址；`/server-download` 会在本机启动下载进程。不要将本服务暴露给不受信任的用户。

***

## 免责声明

1. 本项目是个人学习、技术交流与研究用途的第三方配套工具，与 TikTok、抖音、字节跳动及 TikTokDownloader 上游作者无任何隶属、合作或背书关系。
2. 使用本工具下载、保存或传播任何内容前，请确保你拥有合法权利，并遵守目标平台的用户协议、版权声明及相关法律法规。请勿将本工具用于商业用途、批量抓取、侵犯隐私或任何违法用途。
3. 下载的视频、图片、音乐、文本等内容的版权归原作者或平台所有；请勿未经授权转载、二次分发或用于商业目的。
4. 使用本工具可能需要配置你自己的 Cookie / 账号凭据。请妥善保管这些敏感信息，不要分享给他人或上传到公共平台。
5. 本工具依赖第三方 API 与页面结构，可能随时因平台变更而失效；作者不对其可用性、准确性或完整性作任何保证。
6. 因使用或无法使用本工具而导致的账号封禁、数据丢失、法律纠纷或其他任何损失，均由使用者自行承担，作者不承担任何责任。
7. 本项目按「现状」（AS IS）提供，不提供任何明示或暗示的担保。使用前请自行评估风险。

**如果你不同意上述条款，请立即停止使用本工具。**
