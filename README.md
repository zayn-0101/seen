# 视频课程知识地图 · Obsidian 版

把 B 站网页课程视频自动变成 Obsidian 知识笔记，并把每篇总结写入 dsh-mnemon 的记忆库。

## 它会做什么

1. **实时检测**：每 15 秒观察当前前台浏览器；发现新的 B 站视频课程后自动处理。
2. **学科分类**：LLM 判断视频属于哪个学科；已有学科 → 更新该学科的学习手册；新学科 → 新建学习手册。
3. **内容总结**：优先抓取 B 站 AI 字幕/UP 主字幕作为完整讲解文本，再结合简介、标签、弹幕、评论生成核心知识点、讨论焦点和思维导图。没有字幕时会明确标注「内容依据有限」。
4. **保存 Obsidian**：每视频一篇原子笔记 + 每学科一篇学习手册 + 全局课程总览。
5. **写入 mnemon**：每视频写一条精简 insight 到 dsh-mnemon 的 default Memory Space，可在 DSH 对话中召回。

## 首次安装（由实施者/管理员执行）

### 1. 安装本地插件

在项目目录执行：

```bash
node scripts/install-local-plugin.mjs
```

脚本会：

- 备份 `~/.dsh/profiles/desktop/package.json` 与 `pnpm-lock.yaml` 到 `docs/backup/<时间戳>/`；
- 把 `dsh-video-coursemap` 依赖改为本地 `file:` 路径；
- 在 DSH profile 目录执行 `pnpm install`。

### 2. 重启 DSH Desktop

完全退出 DeepSeek Harness（不是最小化），再重新打开。插件模块有缓存，必须重启才生效。

### 3. 授权 macOS 权限（只能由你手动操作）

第一次读取浏览器标签页时，macOS 会弹权限请求；如果没有弹窗或之前点过「不允许」，请手动设置：

1. 打开「系统设置 → 隐私与安全性 → 辅助功能」，点 + 添加并勾选 **DeepSeek Harness**。
2. 打开「系统设置 → 隐私与安全性 → 自动化」，找到 **DeepSeek Harness**，勾选允许控制：
   - Google Chrome（或你使用的浏览器）
   - Safari
   - System Events
3. 完全退出并重新打开 DSH Desktop。

> 说明：macOS 的 AppleScript 必须获得这些权限才能读取「当前浏览器正在看哪个视频」。没有权限时，实时检测不可用，但仍可在 DSH 里用 `course_map_scan` 手动传入视频链接。

### 4. 检查

在 DSH 对话里说：

> 检查视频课程知识地图插件

或直接调用 `course_map_check`。全部为 ✅ 即可使用。

## 日常使用

### 自动模式

1. 保持 DSH Desktop 运行。
2. 在 Chrome/Safari 打开 B 站视频（`https://www.bilibili.com/video/BV...`）。
3. 等 30–60 秒，插件会自动生成笔记。
4. 打开 Obsidian，查看 `课程知识地图` 目录。

同一视频不会重复生成；非课程内容（纯音乐、搞笑、直播、新闻等）会被静默忽略。

### 手动模式

在 DSH 对话中：

> 把这个视频整理成笔记：https://www.bilibili.com/video/BV...

或调用工具：

```json
course_map_scan({ "url": "https://www.bilibili.com/video/BV...", "force": false })
```

`force: true` 会重新生成已处理过的视频（覆盖前会备份旧笔记）。

### 查看状态

> 视频课程插件现在什么状态？

或调用 `course_map_status`。

## Obsidian 目录结构

```
<你的 vault>/
└── 课程知识地图/
    ├── 课程总览.md
    ├── 机器学习/
    │   ├── 机器学习 学习手册.md
    │   ├── 梯度下降详解.md
    │   └── ...
    └── 前端开发/
        ├── 前端开发 学习手册.md
        └── ...
```

- **视频笔记**：每视频一篇，含 frontmatter、核心知识点、弹幕/评论焦点、Mermaid 思维导图、来源统计。
- **学习手册**：学科级知识地图（Mermaid mindmap + 视频链接列表），底部「我的补充」区不会被覆盖。
- **课程总览**：全部学科与视频数量。

## 内容来源与可信度

- **有 AI 字幕/UP 主字幕**：笔记 frontmatter 标记 `contentSource: ai-subtitle` 或 `up-subtitle`，`contentQuality: full`；知识点以字幕为主。
- **没有字幕**：标记 `contentSource: metadata`、`contentQuality: metadata-only`，笔记顶部会出现「内容依据有限」警告；核心知识点只基于简介/标签，弹幕和评论只用于讨论焦点。
- 统计区会显示「抓取 X 条 / 全站 Y 条」，不再把匿名接口拿到的 3 条热评写成视频实际评论数。
- AI 字幕可能包含同音错字，插件会让模型结合上下文纠正，但不保证 100% 准确。

> 隐私说明：`useBrowserCookies: true` 时，插件只在抓取字幕/评论时通过 `yt-dlp` 临时读取 Chrome 的 B 站 Cookie，Cookie 文件写入系统临时目录并在调用后立即删除，不写入日志、不写入 Obsidian、不写入配置。

## 配置

默认自动检测 Obsidian vault（`~/Library/Application Support/obsidian/obsidian.json`）。如需修改，在 `~/.dsh/profiles/desktop/cordis.patch.yml` 中添加顶层覆盖（不要写 `insert`）：

```yaml
- id: dsh-video-coursemap
  name: dsh-video-coursemap
  config:
    pollIntervalMs: 15000
    stablePolls: 2
    noteRoot: 课程知识地图
    vaultPath: ~/Documents/Obsidian Vault
    fetchTranscript: true
    useBrowserCookies: true
    cookieBrowser: chrome
    commentLimit: 50
    enableMnemon: true
    mnemonStore: default
    openInObsidian: false
```

| 配置 | 默认 | 说明 |
|---|---|---|
| `enabled` | true | 总开关 |
| `pollIntervalMs` | 15000 | 轮询间隔（毫秒） |
| `stablePolls` | 2 | 连续 N 次同一新标题才处理 |
| `vaultPath` | 自动 | Obsidian vault 绝对路径 |
| `noteRoot` | 课程知识地图 | vault 下的笔记根目录 |
| `stateDir` | ~/.dsh/state/... | 状态与日志目录 |
| `provider` / `model` | null | 跟随 DSH 默认模型 |
| `maxTokens` | 4096 | 总结最大 token |
| `fetchContent` | true | 是否抓取 B 站内容 |
| `fetchTranscript` | true | 是否抓取 AI/UP 主字幕作为完整讲解文本 |
| `useBrowserCookies` | true | 是否允许 yt-dlp 临时读取浏览器 B 站 Cookie（用于 AI 字幕和评论分页） |
| `cookieBrowser` | chrome | 从哪个浏览器读取 Cookie（chrome/safari/edge） |
| `transcriptLangs` | ai-zh, zh-Hans… | 字幕语言优先级 |
| `commentLimit` | 50 | 最多抓取多少条高赞评论（最大 100） |
| `ytDlpBin` | 自动 | yt-dlp 路径（默认自动探测） |
| `enableMnemon` | true | 是否写 mnemon |
| `mnemonBin` | 自动 | mnemon CLI 路径 |
| `mnemonStore` | default | Memory Space id |
| `openInObsidian` | false | 生成后是否用 obsidian-cli 打开笔记 |

## 文件与日志

| 内容 | 位置 |
|---|---|
| 插件状态 | `~/.dsh/state/dsh-video-coursemap-obsidian/state.json` |
| 运行日志 | `~/.dsh/state/dsh-video-coursemap-obsidian/poll.log` |
| DSH profile | `~/.dsh/profiles/desktop` |

## 排障

### 打开视频一直没有笔记

按顺序检查：

1. 运行 `course_map_check`：
   - `foreground` ❌ → 没有 macOS 权限，按上文授权并重启 DSH。
   - `vault` ❌ → Obsidian vault 路径不对，检查配置。
   - `mnemon` ❌ → 只是记忆写入失败，笔记仍应生成。
   - `bilibili` ❌ → 网络/B站风控，稍后重试。
2. 看 `poll.log` 最后几行。
3. 确认浏览器地址栏是 `https://www.bilibili.com/video/BV...`，不是首页/搜索页/直播/番剧。

### 笔记生成了但学科不对

学科由 LLM 判断。可以手动修改视频笔记 frontmatter 的 `subject`，并把笔记移动到对应学科目录；插件不会自动纠正已生成的笔记。

### 重复视频

插件按 bvid（优先）或归一化标题去重。若同一视频换标题，可能生成新笔记；可手动删除多余笔记（Obsidian 中操作）。

### Word 输出没了

本版本专注 Obsidian Markdown，不再生成 Word。原版 Word 功能已停用。

## 回滚

```bash
node scripts/rollback-local-plugin.mjs
```

恢复最近一次备份的 profile 配置并 `pnpm install`，然后重启 DSH Desktop。Obsidian 笔记不会被删除。

## 技术说明

- 本插件是 `linner1224/dsh-video-coursemap` 2.0.0 的 fork（MIT），保留原 B 站抓取算法与工具名。
- macOS 前台检测使用 `lsappinfo` + AppleScript；Windows 保留原 PowerShell 实现。
- 所有数据本地处理：Obsidian 笔记在本地 vault，mnemon 数据在 `~/.mnemon`。
- 不读取浏览器 Cookie、不登录 B 站、不下载视频。
