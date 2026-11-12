# 验收清单

> 实施记录（2026-11-12）。完成后逐项勾选。

## 自动化

- [x] `cd dsh-video-coursemap && node --test`：34 tests / 34 pass / 0 fail
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
- [x] AI 字幕缓存：同一 bvid 第二次抓取命中 `~/.myminer/cache/transcripts`，返回 18,954 字

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
