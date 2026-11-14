# 架构与数据流

## 数据流

```
[定时器 15s]
  → observeForeground()
      → lsappinfo 取前台 App
      → 支持浏览器：osascript 读取 active tab {title, url}
      → 失败：System Events 窗口标题
      → 再失败：返回错误（诊断会提示缺少「自动化」权限）
  → cleanTitle + extractBvid / extractDouyinId / extractYoutubeId
  → 去重（state.seen：bvid 优先，其次 <source>:<videoId>）
  → 稳定计数（stablePolls=2）
  → processTitle()
      → session.getBilibiliCookieHeader()（yt-dlp 临时读取浏览器 Cookie，不落盘）
      → fetchContent()：
          → URL/BV 直取 view（title/desc/tags/pages/cid/subtitle）
          → 无 URL 时 searchVideo(title) + 相似度 ≥0.5
          → fetchPlayerInfo()：AI 字幕列表 + view_points 章节
          → 并发抓弹幕（≤150）与评论（登录态最多 100，默认 50）
      → transcript.fetchTranscript()：AI 字幕 / UP 主字幕 / yt-dlp SRT 兜底
      → classify()：LLM JSON → {isCourse, subject, title, keywords}
      → 非课程：markSeen，静默
      → summarize()：LLM JSON → {summary, keyPoints, discussion, mnemonSummary}
      → renderVideoNote()
      → writeVideoNote()（原子写；冲突处理）
      → updateSubjectManual()（只更新 AUTO 区）
      → updateOverview()
      → rememberVideo()（mnemon CLI，失败降级）
      → state 保存
```

## 多平台来源

当前支持三类来源：

- **B站**：`bilibili.js` 使用公开接口 + 登录态评论；AI 字幕通过 yt-dlp 读取 Chrome Cookie。
- **抖音精选**：`douyin.js` 用无头 Chrome 打开 `douyin.com/jingxuan?modal_id=...`，读取 SSR 的 `RENDER_DATA` 获取标题/作者/标签/统计/视频直链；ffmpeg 抽音频；本地 `whisper-cli` 转写。结果缓存到 `~/.seen/cache/douyin`。
- **YouTube**：`youtube.js` 用本机 yt-dlp `-J` 取元数据（标题/频道/时长/简介/章节/字幕轨道），逐级降级取文本：

  1. 人工字幕：`--write-subs --sub-langs <精确键>`（只请求一条轨道，避免触发 YouTube 429）；
  2. 自动字幕：`--write-auto-subs --sub-langs <精确键>`（实测常被限制，失败即降级）；
  3. 音频兜底：`-f bestaudio` 下载后 ffmpeg 转 16kHz 单声道，本地 `whisper-cli` 转写（中文 `-l zh`、外文 `-l auto`，音频下载需 `--extractor-args "youtube:player_client=tv,web_embedded"`，默认 client 常 403）；
  4. 全都失败：仅元数据，笔记标注「内容依据有限」。

  结果缓存到 `~/.seen/cache/youtube`（`youtubeCacheDays`，默认 7 天）。

`source.js` 负责识别平台和视频 ID；`state.seenKey()` 用 `bvid:`、`douyin:<id>` 或 `youtube:<id>` 去重。抖音只取页面评论/弹幕总数、YouTube 不抓评论，两者的笔记都会明确标注「暂未抓取」。

## 独立运行模式

`server/index.js` 把同一套引擎核心包成一个本地服务：

```
浏览器 http://127.0.0.1:4780
  ├─ GET  /api/status     状态、前台、历史、LLM 健康
  ├─ GET  /api/events     SSE：foreground / detected / fetching /
  │                       content / classified / transcript /
  │                       summarizing / summarized / saved / error
  ├─ POST /api/config     启动/暂停轮询、修改轮询间隔
  ├─ POST /api/scan       手动扫描 URL / BV / YouTube 链接
  └─ POST /api/check      前台权限、Obsidian、mnemon、B站、YouTube、LLM 诊断
```

- `server/index.js` 构造一个最小的 Cordis Context（`llm` / `tools` / `effect`），调用引擎的 `apply()`，拿回控制器 API（start/stop/setPollInterval/scan/onEvent）。
- `server/llm.js` 把本机 Magpie 网关（`http://127.0.0.1:3425/v1`）适配成流式接口，也支持任意 OpenAI-compatible 服务。
- 多个 Seen 实例共用同一状态目录与 `instance.lock`：后启动的为只读，停掉占用者后可接管。
- `web/` 是原生 HTML/CSS/JS 单页，SSE 实时更新；没有构建步骤、没有前端框架。
- AI 字幕缓存写入 `~/.seen/cache/transcripts/<bvid>.json`，默认保留 7 天；`force` 扫描会跳过缓存。
- 开机自启用 `scripts/install-launchd.mjs`；双击 `seen.command` 可临时启动。

## 状态文件

`~/.seen/state/state.json`

- `seen`：去重表，key 为 `bvid:BV...` 或 `title:归一化标题`
- `subjects`：学科 → { createdAt, updatedAt, videos[] }
- `failures`：失败计数与冷却
- `stats`：processed / skipped / failed / lastMnemon
- `lastForeground`：最近一次前台检测结果（供 status/check 展示）

## Obsidian 文件

```
<vault>/课程知识地图/
├── 课程总览.md
├── 索引.md                  # 全部视频索引表（AUTO 区块维护）
├── 每周回顾/<年>-W<周>.md   # 每周回顾，已存在不覆盖
└── <学科>/
    ├── <学科> 学习手册.md
    └── <视频标题>.md
```

- 视频笔记：frontmatter + 一句话简介 + 核心知识点 + 弹幕评论焦点 + Mermaid mindmap + 来源统计。
- 学科学习手册：AUTO 区（学科总览 mindmap + 视频链接列表）+ 用户「我的补充」区。
- 课程总览：AUTO 区（学科 mindmap + 学科列表）。
- 写入采用 tmp + rename 原子替换；学习手册/总览只替换 `<!-- AUTO:START -->` 与 `<!-- AUTO:END -->` 之间。

## 模型服务

优先级：用户保存的设置（`~/.seen/llm.json`）→ 环境变量 → 自动探测本机 Magpie → 未配置。

- 设置由网页「模型」弹窗写入，支持 24 个 OpenAI 兼容供应商预设与自定义 baseURL；
- 启动时 resolveLlmConfig() 决定来源，运行时保存设置通过 updateConfig() 热更新，无需重启；
- apiKey 只存在本机文件（权限 600），接口回显脱敏，日志不记录。

## mnemon 集成（可选，默认关闭）

- 设置页开关跟随探测：检测到 mnemon CLI 才启用，缺失时禁用；
- 使用 `mnemon remember --store default` 写入本地 mnemon 记忆库。
- 内容为精简版（标题/学科/摘要/前 5 条知识点/笔记路径/B站链接），≤800 字。
- 其它使用 mnemon 的工具调用同一 CLI 与 `~/.mnemon/data/default/mnemon.db`，可以检索到同一批记录。
- 写入失败不影响 Obsidian 笔记生成。

## 模块边界

| 模块 | 职责 |
|---|---|
| config.js | 默认配置、vault 自动检测、文件名清洗 |
| state.js | 状态读写、去重、失败冷却 |
| foreground*.js | 跨平台前台窗口读取 |
| bilibili.js | URL/bvid 解析与 B 站内容抓取 |
| analyze.js | LLM 提示词、JSON 解析、分类/总结 |
| render.js | 三类 Markdown 渲染、Mermaid 转义 |
| obsidian.js | vault 路径、原子写、AUTO 区、冲突处理 |
| mnemon.js | CLI 探测与 remember 调用 |
| index.js | 引擎入口、轮询、编排、内部工具注册 |
