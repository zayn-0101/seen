# 拾影 Seen · 视频知识笔记

## 项目目标

把 B 站 / 抖音精选网页课程长视频自动转化为 Obsidian 知识笔记：

1. 定时检测前台浏览器正在播放的 B站 / 抖音精选视频；
2. 去重后按学科分类：旧学科更新学习手册，新学科新建学习手册；
3. 抓取视频简介/标签/字幕/弹幕/评论，LLM 生成知识总结；
4. 输出到 Obsidian（视频原子笔记 + 学科学习手册 + 课程总览）；
5. 每个视频写一条精简 insight 到 dsh-mnemon 的 default Memory Space。

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
│   └── rollback.md           回滚 DSH 依赖的步骤
├── server/                   独立本地服务（不依赖 DSH）
│   ├── index.js              HTTP API + SSE + 静态页面
│   └── llm.js                Magpie / OpenAI-compatible LLM 适配
├── web/                      前端页面（原生 HTML/CSS/JS）
│   ├── index.html
│   ├── app.js
│   └── style.css
├── scripts/
│   ├── install-local-plugin.mjs
│   ├── rollback-local-plugin.mjs
│   ├── install-launchd.mjs
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
    ├── cordis.patch.yml
    ├── README.md
    ├── lib/                  source.js / douyin.js / bilibili.js / analyze.js
    └── test/
```

## 开发规则

- 源码只在工作区修改；**绝不直接改** `~/.dsh/profiles/desktop/node_modules`。
- 插件零运行时依赖：只用 Node 内置模块 + DSH 注入的 `ctx.llm` / `ctx.tools`。
- 纯 ESM JavaScript，不引入 TypeScript 构建。
- 所有新增/修改模块必须可被 `node:test` 直接 import。
- 改完必须运行：`cd core && node --test`。
- 菜单栏应用改动后运行：`cd menubar && ./build.sh`。
- 松鼠系列以 `menubar/icon/squirrel/` 母版为准，使用 `node scripts/export-icons.mjs` 统一生成应用、菜单栏和网页资源；规范与完整交付包见 `docs/brand/`。
- 图标构建使用新的临时工作目录，保留既有构建备份，不自动删除文件。
- docs/icon-concepts/ 与 docs/brand/squirrel-icons-v1* 是本地草稿/生成物，已加入 .gitignore，不入库。
- 插件代码改动后必须重启 DSH Desktop 才生效（DSH 对插件模块做缓存）。
- 日志不得记录完整弹幕/评论全文、Cookie、密钥。
- 不硬编码 vault 路径；默认自动检测，允许配置覆盖。
- 不写死绝对路径：可执行文件按「环境变量 → PATH → 常见安装位置」探测；文档和配置里的路径用 `~` 或相对仓库根。
- 不覆盖用户手写内容：学习手册/总览只更新 `<!-- AUTO:START -->` 与 `<!-- AUTO:END -->` 之间。

## 关键路径

| 项 | 路径 |
|---|---|
| Obsidian vault | `~/Documents/Obsidian Vault`（自动检测） |
| 笔记根目录 | `<vault>/课程知识地图` |
| 插件状态/日志 | `~/.dsh/state/seen/` |
| 抖音缓存 | `~/.seen/cache/douyin/` |
| Whisper 模型 | `~/.seen/models/ggml-small.bin` |
| DSH profile | `~/.dsh/profiles/desktop` |
| mnemon CLI | `mnemon`（在 PATH 中，可用 `which mnemon` 确认） |
| Obsidian CLI | `obsidian-cli`（在 PATH 中） |
| 菜单栏应用日志 | `~/.seen/menubar.log` |

## 验证命令

```bash
cd core && node --test
cd menubar && ./build.sh               # 编译菜单栏应用 → menubar/dist/Seen.app
node scripts/install-local-plugin.mjs   # 安装到 DSH profile（会先备份）
node server/index.js                    # 独立服务，默认 http://127.0.0.1:4780
node scripts/install-whisper-model.mjs  # 安装抖音转写模型（约 465MB）
obsidian-cli list --vault "Obsidian Vault" "课程知识地图"
mnemon recall "视频课程"
```

## 插件工具

- `course_map_status`：查看运行状态、学科、最近错误。
- `course_map_scan`：手动扫描（可传 `title` / `url` / `force`）。
- `course_map_check`：诊断前台权限、vault、mnemon、B站接口、模型。

## 重要事实

- 菜单栏应用（`menubar/`）是独立 Swift 客户端，只通过 HTTP 调本地服务，不改变服务行为；登录自启由 app 内开关管理，优先 SMAppService，不可用时回退 LaunchAgent。
- 远程仓库：`https://github.com/zayn-0101/seen`（公开，默认分支 `main`）。改动完成后记得提交并推送。
- 当前默认只运行独立服务；`seen-core` 已从 DSH profile 的 bundles 中移除，不再随 DSH 加载。
- 原版 `dsh-video-coursemap 2.0.0` 仅支持 Windows 前台窗口 + Word 输出；本仓库是其 macOS/Obsidian 增强 fork。
- macOS 前台窗口读取依赖 AppleScript；首次运行需要用户在「系统设置 → 隐私与安全性 → 辅助功能 / 自动化」授权 DeepSeek Harness。
- 抖音精选依赖无头 Chrome（解析 SSR `RENDER_DATA`）、ffmpeg、whisper-cli 和本地模型；不保存抖音 Cookie。
- 抖音当前只取评论/弹幕总数，不抓取正文；笔记会明确标注「暂未抓取」。
- `mnemon remember --store default` 与 dsh-mnemon 的 Mnemon Native provider 共用 `~/.mnemon/data/default/mnemon.db`。
