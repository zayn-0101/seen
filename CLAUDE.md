# 拾影 Seen · 视频知识笔记

## 项目目标

把 B 站 / 抖音精选 / YouTube 网页课程长视频自动转化为 Obsidian 知识笔记：

1. 定时检测前台浏览器正在播放的视频；
2. 去重后按学科分类：旧学科更新学习手册，新学科新建学习手册；
3. 抓取视频简介/标签/字幕/弹幕/评论，LLM 生成知识总结；
4. 输出到 Obsidian（视频原子笔记 + 学科学习手册 + 课程总览）；
5. 可选：检测到本机 mnemon CLI 时把每条总结写入本地记忆库（默认关闭）。

## 目录约定

```
seen/
├── CLAUDE.md                 本文件：项目规则
├── CLAUDE.local.md           本机环境（不入库，见 .gitignore）
├── README.md                 用户手册
├── docs/
│   ├── contracts.md          模块接口契约（所有实现必须遵守）
│   ├── architecture.md       架构与数据流
│   ├── acceptance.md         验收清单与记录
│   ├── brand/                松鼠品牌规范与预览图
├── server/                   本地服务（HTTP API + SSE + 静态页面）
│   ├── index.js              路由、SSE、静态资源、通知
│   └── llm.js                供应商预设与 OpenAI-compatible 适配
├── web/                      前端（原生 HTML/CSS/JS，无构建）
├── scripts/
│   ├── export-icons.mjs          图标导出
│   ├── install-ffmpeg.mjs        下载 ffmpeg 到 ~/.seen/bin
│   ├── install-launchd.mjs       服务开机自启
│   ├── install-whisper-model.mjs 下载 Whisper 模型
│   ├── install-yt-dlp.mjs        下载 yt-dlp 到 ~/.seen/bin
│   └── uninstall-launchd.mjs
├── seen.command              双击启动服务
├── menubar/                  菜单栏应用（Swift，只调本地服务 HTTP）
└── core/                     视频引擎（包名 seen-core）
    ├── lib/                  index(编排) / source+douyin+bilibili+youtube(平台)
    │                         transcript+session+ytdlp+download(字幕与下载)
    │                         analyze(总结) / render+obsidian+index-note+review(输出)
    │                         config+state+foreground*+notify+mnemon / whisper(本地转写)
    └── test/
```

## 开发规则

- 源码只在工作区修改；**绝不直接改**已安装的依赖副本（node_modules）。
- 零 npm 依赖：只用 Node 内置模块 + 注入的 `ctx`。外部工具按需探测，缺失时 yt-dlp / ffmpeg 自动下载，Whisper 模型与 whisper-cli 由面板引导安装。
- 纯 ESM JavaScript，不引入 TypeScript 构建。
- 所有新增/修改模块必须可被 `node:test` 直接 import。
- 改完必须运行：`cd core && node --test`。
- 菜单栏应用改动后运行：`cd menubar && ./build.sh`。
- 松鼠系列以 `menubar/icon/squirrel/` 母版为准，用 `node scripts/export-icons.mjs` 统一生成应用、菜单栏和网页资源；完整交付包见 `docs/brand/`。
- 图标构建使用新的临时工作目录，保留既有构建备份，不自动删除文件。
- 日志不得记录完整弹幕/评论全文、Cookie、密钥。
- 不硬编码 vault 路径；默认自动检测，允许配置覆盖。
- 不写死绝对路径：可执行文件按「环境变量 → PATH → 常见安装位置」探测；文档和配置里的路径用 `~` 或相对仓库根。
- 不覆盖用户手写内容：学习手册/总览只更新 `<!-- AUTO:START -->` 与 `<!-- AUTO:END -->` 之间。

## 验证命令

```bash
cd core && node --test          # 引擎测试
cd menubar && ./build.sh        # 编译菜单栏应用 → menubar/dist/Seen.app
npm run check                   # 语法检查
node server/index.js            # 独立服务，默认 http://127.0.0.1:4780
```

## 重要事实

- 模型配置在网页「模型」弹窗（24 个预设 + 自定义），优先级：设置 → 环境变量 → 自动探测 Magpie；apiKey 存 `~/.seen/llm.json`（600）。
- macOS 通知分四个节点（开始整理 / 本地转写含预计耗时 / 笔记已生成 / 处理失败），中间步骤只在面板显示；`SEEN_DISABLE_NOTIFY=1` 可关。
- 每次生成笔记后重建「索引.md」（AUTO 区块）；每周回顾由 review.js 生成、obsidian.js 写入，已存在不覆盖。
- B 站与 YouTube 的章节和知识点带 `t=` 时间链接；抖音无章节。
- 菜单栏应用是独立 Swift 客户端，只通过 HTTP 调服务；登录自启优先 SMAppService，不可用时回退 LaunchAgent。
- 远程仓库：`https://github.com/zayn-0101/seen`（公开，默认分支 `main`）。改动完成后记得提交并推送。
- 应用是独立桌面程序，`core/` 是本机引擎，不做网络服务依赖。
- 上游参考：`linner1224/dsh-video-coursemap` 2.0.0（MIT）；保留其 B 站抓取思路，已独立演进为 macOS / Obsidian 方向。
- macOS 前台窗口读取依赖 AppleScript，需要「系统设置 → 隐私与安全性 → 自动化」授权；macOS 27 已移除独立的「辅助功能」分类，诊断要按实际调用能力判断，不能查 UI elements enabled 标志。
- 抖音精选依赖无头 Chrome（解析 SSR `RENDER_DATA`）、ffmpeg、whisper-cli 和本地模型；不保存抖音 Cookie；只取评论/弹幕总数，不抓正文。
- YouTube 走本机 yt-dlp：`-J` 取元数据，人工字幕优先、自动字幕其次，都没有则下载音频本地转写（下载音频必须加 `--extractor-args "youtube:player_client=tv,web_embedded"`，默认 client 常 403）；不读取浏览器 Cookie，不用 YouTube Data API。
- YouTube 自动字幕接口限制严格（实测多为 429），实际常落到本地转写；结果缓存 `~/.seen/cache/youtube/<id>.json`（`youtubeCacheDays`，默认 7 天）。
- 外部工具统一策略：「配置 → PATH → `~/.seen/bin` → 常见路径」，系统已装的优先、不会被覆盖：
  - yt-dlp：GitHub releases 官方二进制（37MB），fetch 失败回退 curl；官方失败按 `SEEN_GH_MIRROR`（默认 ghproxy.net / gh-proxy.com）镜像重试；下载后用官方 `SHA2-256SUMS` 校验，镜像来源校验不通即中止；
  - ffmpeg：ffmpeg-static 静态二进制（45MB），同样官方 → 镜像；
  - Whisper 模型：不静默下载，面板按推荐列出 turbo / small / medium / base，源按 HF_ENDPOINT → huggingface → hf-mirror；
  - whisper-cli：无免安装包，面板按钮代跑 `brew install whisper.cpp`。
