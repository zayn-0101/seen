# 拾影 Seen · 视频知识笔记

## 项目目标

把 B 站 / 抖音精选 / YouTube 网页课程长视频自动转化为 Obsidian 知识笔记：

1. 定时检测前台浏览器正在播放的 B站 / 抖音精选 / YouTube 视频；
2. 去重后按学科分类：旧学科更新学习手册，新学科新建学习手册；
3. 抓取视频简介/标签/字幕/弹幕/评论，LLM 生成知识总结；
4. 输出到 Obsidian（视频原子笔记 + 学科学习手册 + 课程总览）；
5. 可选：检测到本机 mnemon CLI 时把每条总结写入本地记忆库（默认关闭，设置页开关）；

## 目录约定

```
seen/
├── CLAUDE.md                 本文件：项目规则
├── README.md                 用户手册（安装、权限、使用、排障）
├── docs/
│   ├── contracts.md          模块接口契约（所有实现必须遵守）
│   ├── architecture.md       架构与数据流
│   ├── acceptance.md         验收清单与记录
│   ├── icon-concepts/        图标探索稿（本地保留，不入库）
│   ├── brand/                松鼠品牌规范与预览（完整交付包本地生成，不入库）
├── server/                   本地服务（HTTP API + SSE + 静态页面）
│   ├── index.js              HTTP API + SSE + 静态页面
│   └── llm.js                Magpie / OpenAI-compatible LLM 适配
├── web/                      前端页面（原生 HTML/CSS/JS）
│   ├── index.html
│   ├── app.js
│   └── style.css
├── scripts/
│   ├── export-icons.mjs          图标导出（母版 → 各平台资源）
│   ├── install-launchd.mjs       服务开机自启
│   ├── install-whisper-model.mjs 下载本地 Whisper 模型
│   ├── install-yt-dlp.mjs        下载 yt-dlp 到 ~/.seen/bin
│   └── uninstall-launchd.mjs
├── seen.command             双击启动独立服务
├── menubar/                  菜单栏应用（Swift，只调本地服务 HTTP）
│   ├── Sources/              main / AppDelegate / PanelView / ServiceClient / AutoLaunch
│   ├── icon/squirrel/        松鼠图标母版（应用/菜单栏/网页资源都从这里导出）
│   ├── Resources/            Info.plist 与生成的图标
│   ├── scripts/make-icons.sh SVG → PNG/ICNS
│   └── build.sh              编译打包 menubar/dist/Seen.app
├── package.json             根脚本（npm start / npm test）
└── core/                      Seen 视频引擎（包名 seen-core）
    ├── package.json
    ├── README.md
    ├── lib/                  index(编排) / source+douyin+bilibili+youtube(平台) / transcript+session+ytdlp(字幕)
    │                         analyze(总结) / render+obsidian+index-note+review(输出) / config+state+foreground*+notify+mnemon
    │                         whisper(本地语音转写，抖音与 YouTube 无字幕时共用)
    └── test/
```

## 开发规则

- 源码只在工作区修改；**绝不直接改**已安装的依赖副本（node_modules）。
- 零运行时依赖：只用 Node 内置模块 + 注入的 `ctx`（standalone 服务自己构造）。
- 纯 ESM JavaScript，不引入 TypeScript 构建。
- 所有新增/修改模块必须可被 `node:test` 直接 import。
- 改完必须运行：`cd core && node --test`。
- 菜单栏应用改动后运行：`cd menubar && ./build.sh`。
- 松鼠系列以 `menubar/icon/squirrel/` 母版为准，使用 `node scripts/export-icons.mjs` 统一生成应用、菜单栏和网页资源；规范与完整交付包见 `docs/brand/`。
- 图标构建使用新的临时工作目录，保留既有构建备份，不自动删除文件。
- docs/icon-concepts/ 与 docs/brand/squirrel-icons-v1* 是本地草稿/生成物，已加入 .gitignore，不入库。
- 日志不得记录完整弹幕/评论全文、Cookie、密钥。
- 不硬编码 vault 路径；默认自动检测，允许配置覆盖。
- 不写死绝对路径：可执行文件按「环境变量 → PATH → 常见安装位置」探测；文档和配置里的路径用 `~` 或相对仓库根。
- 不覆盖用户手写内容：学习手册/总览只更新 `<!-- AUTO:START -->` 与 `<!-- AUTO:END -->` 之间。

## 关键路径

| 项 | 路径 |
|---|---|
| Obsidian vault | `~/Documents/Obsidian Vault`（自动检测） |
| 笔记根目录 | `<vault>/课程知识地图` |
| 状态/日志 | `~/.seen/state/` |
| 抖音缓存 | `~/.seen/cache/douyin/` |
| YouTube 缓存 | `~/.seen/cache/youtube/` |
| yt-dlp（自动安装的兜底副本） | `~/.seen/bin/yt-dlp` |
| Whisper 模型 | `~/.seen/models/ggml-small.bin` |
| mnemon CLI | `mnemon`（在 PATH 中，可用 `which mnemon` 确认） |
| Obsidian CLI | `obsidian-cli`（在 PATH 中） |
| 菜单栏应用日志 | `~/.seen/menubar.log` |

## 验证命令

```bash
cd core && node --test
cd menubar && ./build.sh               # 编译菜单栏应用 → menubar/dist/Seen.app
node server/index.js                    # 独立服务，默认 http://127.0.0.1:4780
node scripts/install-whisper-model.mjs  # 安装本地转写模型（抖音 / YouTube 无字幕时，约 465MB）
node scripts/install-yt-dlp.mjs         # 下载 yt-dlp 到 ~/.seen/bin（服务首次需要时也会自动下载）
obsidian-cli list --vault "Obsidian Vault" "课程知识地图"
mnemon recall "视频课程"
```


## 重要事实

- 模型配置在网页「模型」弹窗（24 个预设 + 自定义），优先级：设置 → 环境变量 → 自动探测 Magpie；apiKey 存 ~/.seen/llm.json（600）。
- 视频处理完成后通过 macOS 通知提醒（SEEN_DISABLE_NOTIFY=1 可关）；每周回顾由 review.js 生成、obsidian.js 写入，已存在不覆盖；B站与 YouTube 的章节和知识点带 t= 时间链接。
- 每次生成笔记后重建课程知识地图/索引.md（AUTO 区块）；每周回顾写入 每周回顾/，已存在不覆盖。
- 菜单栏应用（`menubar/`）是独立 Swift 客户端，只通过 HTTP 调本地服务，不改变服务行为；登录自启由 app 内开关管理，优先 SMAppService，不可用时回退 LaunchAgent。
- 远程仓库：`https://github.com/zayn-0101/seen`（公开，默认分支 `main`）。改动完成后记得提交并推送。
- 应用是独立桌面程序，`core/` 是本机引擎，不做网络服务依赖。
- 上游参考：`linner1224/dsh-video-coursemap` 2.0.0（MIT，Windows 前台窗口 + Word 输出）；本项目保留其 B 站抓取思路，已独立演进为 macOS/Obsidian 方向。
- macOS 前台窗口读取依赖 AppleScript；首次运行在「系统设置 → 隐私与安全性 → 自动化」里允许运行服务的程序（菜单栏应用 Seen.app 或终端）控制 System Events 与浏览器。macOS 27 已移除独立的「辅助功能」分类，诊断要按实际调用能力判断，不能查 UI elements enabled 标志。
- 抖音精选依赖无头 Chrome（解析 SSR `RENDER_DATA`）、ffmpeg、whisper-cli 和本地模型；不保存抖音 Cookie。
- 抖音当前只取评论/弹幕总数，不抓取正文；笔记会明确标注「暂未抓取」。
- YouTube 走本机 yt-dlp：`-J` 取元数据，人工字幕优先、自动字幕其次，都没有则下载音频用 whisper.cpp 本地转写（下载音频必须加 `--extractor-args "youtube:player_client=tv,web_embedded"`，默认 client 常 403）；不读取浏览器 Cookie，也不用 YouTube Data API。
- YouTube 自动字幕接口限制严格（实测多为 429），实际经常落到本地转写，耗时 1–3 分钟；不抓评论（YouTube 也无弹幕）；结果缓存 `~/.seen/cache/youtube/<id>.json`，有效期 youtubeCacheDays（默认 7 天）。
- yt-dlp 查找顺序：配置 `ytdlpBin` → PATH → `~/.seen/bin/yt-dlp` → 常见路径；都没有时，首次需要（YouTube 解析或 B 站 AI 字幕）会从 GitHub releases 自动下载到 `~/.seen/bin` 并校验 `--version`，下载走 Node fetch、失败回退系统 curl。系统里已装的优先，不会被覆盖。
- `mnemon remember --store default` 写入 `~/.mnemon/data/default/mnemon.db`；其它使用 mnemon 的工具读的是同一份数据。
