# myminer · 视频课程知识地图 → Obsidian

## 项目目标

把 B 站 / 抖音精选网页课程长视频自动转化为 Obsidian 知识笔记：

1. 定时检测前台浏览器正在播放的 B站 / 抖音精选视频；
2. 去重后按学科分类：旧学科更新学习手册，新学科新建学习手册；
3. 抓取视频简介/标签/字幕/弹幕/评论，LLM 生成知识总结；
4. 输出到 Obsidian（视频原子笔记 + 学科学习手册 + 课程总览）；
5. 每个视频写一条精简 insight 到 dsh-mnemon 的 default Memory Space。

## 目录约定

```
myminer/
├── CLAUDE.md                 本文件：项目规则
├── README.md                 用户手册（安装、权限、使用、排障）
├── docs/
│   ├── contracts.md          模块接口契约（所有实现必须遵守）
│   ├── architecture.md       架构与数据流
│   ├── acceptance.md         验收清单与记录
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
├── myminer.command          双击启动独立服务
├── package.json             根脚本（npm start / npm test）
└── dsh-video-coursemap/      本地增强版 DSH 插件（包名保持不变）
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
- 改完必须运行：`cd dsh-video-coursemap && node --test`。
- 插件代码改动后必须重启 DSH Desktop 才生效（DSH 对插件模块做缓存）。
- 日志不得记录完整弹幕/评论全文、Cookie、密钥。
- 不硬编码 vault 路径；默认自动检测，允许配置覆盖。
- 不覆盖用户手写内容：学习手册/总览只更新 `<!-- AUTO:START -->` 与 `<!-- AUTO:END -->` 之间。

## 关键路径

| 项 | 路径 |
|---|---|
| Obsidian vault | `~/Documents/Obsidian Vault`（自动检测） |
| 笔记根目录 | `<vault>/课程知识地图` |
| 插件状态/日志 | `~/.dsh/state/dsh-video-coursemap-obsidian/` |
| 抖音缓存 | `~/.myminer/cache/douyin/` |
| Whisper 模型 | `~/.myminer/models/ggml-small.bin` |
| DSH profile | `~/.dsh/profiles/desktop` |
| mnemon CLI | `~/.local/share/fnm/node-versions/v24.15.0/installation/bin/mnemon` |
| Obsidian CLI | `/opt/homebrew/bin/obsidian-cli` |

## 验证命令

```bash
cd dsh-video-coursemap && node --test
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

- 当前默认只运行独立服务；`dsh-video-coursemap` 已从 DSH profile 的 bundles 中移除，不再随 DSH 加载。
- 原版 `dsh-video-coursemap 2.0.0` 仅支持 Windows 前台窗口 + Word 输出；本仓库是其 macOS/Obsidian 增强 fork。
- macOS 前台窗口读取依赖 AppleScript；首次运行需要用户在「系统设置 → 隐私与安全性 → 辅助功能 / 自动化」授权 DeepSeek Harness。
- 抖音精选依赖无头 Chrome（解析 SSR `RENDER_DATA`）、ffmpeg、whisper-cli 和本地模型；不保存抖音 Cookie。
- 抖音当前只取评论/弹幕总数，不抓取正文；笔记会明确标注「暂未抓取」。
- `mnemon remember --store default` 与 dsh-mnemon 的 Mnemon Native provider 共用 `~/.mnemon/data/default/mnemon.db`。
