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

  依赖的外部工具由 `ytdlp.js` / `whisper.js` 统一解析：配置 → PATH → `~/.seen/bin`（或 `~/.seen/models`）→ 常见路径，系统里已装的始终优先。缺失时 yt-dlp、ffmpeg 自动下载（GitHub 失败走镜像，yt-dlp 校验 SHA256），Whisper 模型由面板列选项让用户选，whisper-cli 由面板按钮代跑 brew；只有 Chrome 需要用户自行安装。

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
<vault>/视频笔记/            # 根目录，SEEN_NOTE_ROOT 可改名
├── 总览.md                 # 学科维度（AUTO 区块维护）
├── 视频索引.md             # 全部视频索引表（AUTO 区块维护）
├── 概念索引.md             # 概念 → 出现过的笔记（AUTO 区块维护）
├── 标签索引.md             # 标签 → 出现过的笔记（AUTO 区块维护）
├── 笔记/<学科>/<视频标题>.md
├── 手册/<学科>.md
├── 概念/<概念名>.md        # 出现 ≥2 篇才建
├── 主题/<主题名>.md        # 出现 ≥3 篇才建
├── 字幕/<笔记名>.md        # 原始字幕/转写存档，不参与索引
├── 回顾/<年>-W<周>.md      # 每周回顾，已存在不覆盖
└── _备份/                  # 重写前的 .bak 与迁移副本
```

- 视频笔记：frontmatter（含 contentType / quality / format 4）+ 摘要问答 + 类型模板 + 知识点时间戳 + 核心概念 + 原话/术语/资源 + 来源统计（不抓封面、不画思维导图）。
- 学科学习手册：AUTO 区（mindmap + 学习路径 + 视频链接 + 核心概念 + 术语表 + 常见对比 + 待解问题）+ 用户「我的补充」区。
- 总览：AUTO 区（学科 mindmap + 学科列表 + 最近更新 + 知识库概况）；`flat` 布局下学科手册与笔记同级，`structured` 布局下分到 `笔记/` 与 `手册/`。
- 概念页/主题页：按出现篇数阈值自动建页，只维护 AUTO 区；主题页的相关概念只链接真实存在的概念页。
- 写入采用 tmp + rename 原子替换；学习手册/总览只替换 `<!-- AUTO:START -->` 与 `<!-- AUTO:END -->` 之间。
- 所有 vault 读写都是异步的，并经过 `runVaultTask`：权限守卫 → 串行队列 → 10 秒超时熔断。macOS 的 TCC 没授权「文稿文件夹」时，同步 `open` 会让内核一直挂着，整个事件循环（含 HTTP）跟着卡死——所以权限探测放在子进程里做（`probeVaultAccess`），主进程只读结果。

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
| analyze.js | LLM 提示词、JSON 解析、分类/总结、发布前润色、无章节视频的时间轴切段 |
| note-content.js | 内容类型（8 类）、类型模板字段与上限、要点时间戳、原话/术语/资源归一、质量分 |
| review-schedule.js | 间隔复习调度：1/3/7/16/35 天阶梯、到期队列与统计 |
| tags.js | 三层标签归一（学科/主题/类型/概念）、主题词表与包含合并 |
| concept.js | 概念归一、跨笔记关联打分、概念索引 |
| paths.js | 两种目录布局、笔记/手册/字幕/概念页/主题页相对路径、状态路径重映射 |
| render.js | 三类 Markdown 渲染、类型模板区块与时间链接、复习卡片、Mermaid 转义 |
| vault-access.js | 笔记库权限探针（子进程）、熔断守卫、串行队列、超时保护 |
| obsidian.js | vault 路径、原子写、AUTO 区、冲突处理；全部 async 并经 runVaultTask 过守卫 |
| index-note.js | 视频索引 / 概念索引 / 标签索引的正文生成 |
| transcript-note.js | 字幕存档的渲染与还原（type: transcript，不参与索引） |
| topic-pages.js | 概念页（≥2 篇）与主题综述（≥3 篇）的聚合与渲染 |
| rebuild.js | 按 state 全量重建索引、概念页、主题页、手册与总览 |
| vault-search.js | 笔记库全文搜索（文件名加权 + 正文命中 + 命中来源）、markdown 文件枚举 |
| note-check.js | 笔记结构 / 标签 / 章节时间轴 / 双链的纯函数断言（离线自检与模型回放回归） |
| note-clean.js | 旧笔记清理（去掉 format 2 时代的封面字段与封面图） |
| mnemon.js | CLI 探测与 remember 调用 |
| index.js | 引擎入口、轮询、编排、内部工具注册 |
