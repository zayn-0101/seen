# 架构与数据流

## 数据流

```
[定时器 15s]
  → observeForeground()
      → lsappinfo 取前台 App
      → 支持浏览器：osascript 读取 active tab {title, url}
      → 失败：System Events 窗口标题
      → 再失败：返回错误（course_map_check 提示授权）
  → cleanTitle + extractBvid
  → 去重（state.seen，bvid 优先）
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

## 状态文件

`~/.dsh/state/dsh-video-coursemap-obsidian/state.json`

- `seen`：去重表，key 为 `bvid:BV...` 或 `title:归一化标题`
- `subjects`：学科 → { createdAt, updatedAt, videos[] }
- `failures`：失败计数与冷却
- `stats`：processed / skipped / failed / lastMnemon
- `lastForeground`：最近一次前台检测结果（供 status/check 展示）

## Obsidian 文件

```
<vault>/课程知识地图/
├── 课程总览.md
└── <学科>/
    ├── <学科> 学习手册.md
    └── <视频标题>.md
```

- 视频笔记：frontmatter + 一句话简介 + 核心知识点 + 弹幕评论焦点 + Mermaid mindmap + 来源统计。
- 学科学习手册：AUTO 区（学科总览 mindmap + 视频链接列表）+ 用户「我的补充」区。
- 课程总览：AUTO 区（学科 mindmap + 学科列表）。
- 写入采用 tmp + rename 原子替换；学习手册/总览只替换 `<!-- AUTO:START -->` 与 `<!-- AUTO:END -->` 之间。

## mnemon 集成

- 使用 `mnemon remember --store default` 写入 dsh-mnemon 的 default Memory Space。
- 内容为精简版（标题/学科/摘要/前 5 条知识点/笔记路径/B站链接），≤800 字。
- dsh-mnemon 的 Mnemon Native provider 调用同一 CLI 与 `~/.mnemon/data/default/mnemon.db`，因此可在 DSH 对话中通过 `mnemon_recall` 检索。
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
| index.js | 插件入口、轮询、编排、工具注册 |
