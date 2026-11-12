# 验收清单

> 实施记录（2026-11-12）。完成后逐项勾选。

## 自动化

- [x] `cd dsh-video-coursemap && node --test`：27 tests / 27 pass / 0 fail
- [x] 所有 lib 文件 `node --check` 通过
- [x] `scripts/install-local-plugin.mjs` 执行成功，profile 依赖指向本地路径
- [x] 安装副本版本：`2.1.0-obsidian.1`
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
