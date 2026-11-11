# dsh-video-coursemap · Obsidian 版

DSH 插件：实时检测 B 站网页课程视频 → 学科分类 → 抓取简介/字幕/弹幕/评论 → LLM 知识总结 → 输出 Obsidian 笔记（视频笔记 + 学科学习手册 + 课程总览）+ 写入 dsh-mnemon。

## 安装

```bash
node scripts/install-local-plugin.mjs
```

然后重启 DSH Desktop，并在系统设置中授予 DeepSeek Harness 辅助功能/自动化权限。

## 工具

- `course_map_status` — 运行状态
- `course_map_scan` — 手动扫描（title/url/force）
- `course_map_check` — 权限与组件诊断

## 开发

```bash
cd dsh-video-coursemap
node --test
```

模块接口见 `../docs/contracts.md`。
