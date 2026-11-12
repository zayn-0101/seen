# 验收清单

> 实施记录（2026-11-12）。完成后逐项勾选。

## 自动化

- [x] `cd core && node --test`：38 tests / 38 pass / 0 fail
- [x] 所有 lib 文件 `node --check` 通过
- [x] `scripts/install-local-plugin.mjs` 执行成功，profile 依赖指向本地路径
- [x] 安装副本版本：`2.2.0-obsidian.1`（已同步，需重启 DSH 生效）
- [x] 重启 DSH Desktop 后插件加载（无 duplicate loader entry 报错）
- [x] 实际自动检测：2026-11-12 08:57 检测到 Chrome 中的 B 站视频，08:58 生成笔记

## 本地集成测试（mock LLM + 真实 B 站接口）

- [x] `course_map_scan({ url: "https://www.bilibili.com/video/BV..." })` 生成视频笔记
- [x] 生成学科学习手册 + 课程总览
- [x] 同 bvid 第二次扫描返回 `skipped: true`，不重复生成
- [x] 先按标题扫描、再按 URL 扫描，第二次正确按 bvid 去重
- [x] 视频笔记 frontmatter 含 title/subject/source/bvid/url/author/created/updated/tags
- [x] 学习手册含 `<!-- AUTO:START -->` 与「我的补充」区
- [x] mnemon 临时数据目录写入 + `mnemon recall` 可召回
- [x] AI 字幕抓取：通过 yt-dlp + Chrome Cookie 获取 `ai-zh`，该视频字幕 18,954 字
- [x] 登录态评论：抓取 50 条，`view.stat.reply` 显示全站 12,518 条
- [x] 章节：从 `player/v2` 的 `view_points` 提取 6 个章节
- [x] 长字幕分块压缩：18,954 字字幕经过分块摘要后再生成最终总结
- [x] AI 字幕缓存：同一 bvid 第二次抓取命中 `~/.seen/cache/transcripts`，返回 18,954 字

## 抖音精选

- [x] 识别 `https://www.douyin.com/jingxuan?modal_id=...` 与 `/video/<id>` 链接
- [x] 无头 Chrome 读取 SSR `RENDER_DATA`：标题、作者、标签、播放地址、评论/弹幕总数
- [x] ffmpeg 抽取音频，本地 whisper.cpp `ggml-small` 转写（48 分钟视频约 14,099 字）
- [x] 真实抖音长视频生成笔记：`source: douyin`、`videoId`、`contentSource: whisper`
- [x] 抖音视频笔记包含核心知识点、来源统计、Obsidian 链接
- [x] 字幕/转写缓存命中，第二次扫描不重复下载/转写
- [x] `course_map_check` 新增 douyin-chrome / douyin-ffmpeg / douyin-whisper 检查，全部通过
- [ ] 抖音评论/弹幕正文尚未抓取，仅显示总数（下一步）
- [ ] 抖音标题/音频路径在不同视频上的稳定性待更多样本验证

## 独立服务与前端

- [x] `node server/index.js` 启动，默认 `http://127.0.0.1:4780`
- [x] `GET /api/status` 返回状态、前台、历史、LLM 健康
- [x] `POST /api/config` 可启动/暂停轮询、修改轮询间隔（测试 20 秒）
- [x] `GET /api/events` SSE 初始 snapshot 与实时事件正常
- [x] `POST /api/scan` 通过独立服务 + 真实 Magpie LLM + 真实 B 站视频生成笔记（约 3 分钟，含 18,954 字 AI 字幕分块总结）
- [x] 前端页面在 Chrome 加载，无 console 错误；启动/暂停按钮可切换
- [x] 前端页面布局、固定高度滚动、历史总结回显正常
- [x] 界面截图：[docs/ui-preview.jpg](ui-preview.jpg)
- [x] 处理阶段显示实时计时（`已处理 00:45` 样式）
- [x] favicon 已补齐，页面无 404 console 错误
- [x] DSH 插件已从 profile bundles 移除（备份：`docs/backup/disable-dsh-plugin-20261112-134141/`）
- [x] DSH 运行中启动独立服务时为 `readOnly: true`，不会抢占轮询
- [ ] `scripts/install-launchd.mjs` 未实际安装（避免修改系统登录项，待用户确认）
- [ ] 独立服务与 DSH 插件的新控制器代码需重启 DSH 后验证

## DSH 内（重启后）

- [x] `course_map_check` 全部 ✅（platform / foreground / vault / state / mnemon / bilibili / llm）
- [x] `course_map_status` 显示 vault、学科、mnemon 状态
- [x] 自动检测生成笔记（无需 `course_map_scan` 手动触发）

## Obsidian

- [x] `obsidian-cli list --vault "Obsidian Vault" "课程知识地图"` 能看到学科目录与笔记
- [x] 视频笔记 frontmatter 正确
- [x] 学科学习手册链接到视频笔记
- [x] 课程总览列出学科与视频数
- [ ] Mermaid mindmap 正常渲染（需在 Obsidian 中肉眼确认）

## 行为

- [ ] 重复停留同一视频 2 分钟：无新增笔记、无 LLM 调用
- [ ] 同学科第二个视频：学习手册视频数 +1
- [ ] 新学科视频：新学科目录与学习手册生成
- [x] 前台非浏览器：无动作（当前前台为 DSH，未触发处理）
- [x] mnemon：`mnemon recall "视频课程"` 能查到记录
- [ ] 无 mnemon CLI 时笔记仍生成（降级）— 代码路径已实现，待实际拔除 CLI 验证
