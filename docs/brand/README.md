# 松鼠图标规范

用户于 2026-11-12 选定松鼠方案：简洁、灵动，保留卷尾、抬头和抱种子的姿态。

## 目录约定

- `README.md`：本规范与导出、使用说明。
- `prompts-v1.json`：定稿使用的 image_gen 提示词及参考图路径。
- `squirrel-*-preview-v1.png`：整套图标预览，仅供展示。
- `squirrel-icons-v1/`：完整交付包；目录内部的 README 说明各类资源。
- `squirrel-icons-v1.zip`：同名目录的便携交付包。
- `validation-v1.md`：本轮尺寸、格式、网页加载与应用构建的验证记录。
- `visual-upgrade-plan-v1.md`：网页与菜单栏整体视觉升级方案，供实施前确认。
- `visual-upgrade-prompts-v1.md`：两张视觉示意图的生成提示词。
- `squirrel-ui-light-preview-v1.png`、`squirrel-ui-dark-preview-v1.png`：视觉升级的浅色和深色示意图，包含虚构示例内容，不是运行截图。
- `visual-upgrade-plan-v2.md`、`visual-upgrade-prompts-v2.md`：较现代的第二版方案与示意图提示词。
- `squirrel-ui-modern-*-preview-v2.png`：第二版网页浅色、深色及菜单栏示意图，包含虚构示例内容，不是运行截图。
- `squirrel-ui-modern-*-preview-v3.png`：补充英文名 Seen 后的网页和菜单栏示意图。
- `visual-upgrade-prompts-v3.md`：英文名修订所用的图像编辑提示词。

（各版预览示意图体积较大，仅本地保留，已加入 .gitignore，不入库。）

生产母版放在 `menubar/icon/squirrel/`；网页资源导出到 `web/icons/`，菜单栏资源导出到 `menubar/Resources/`。

## 设计原则

- 以选定的橙色松鼠为主形象：大卷尾、抬头、小眼睛、怀中的金色种子。
- 主图标、透明品牌标识、菜单栏轮廓使用同一套造型。
- 小尺寸图标简化五官和爪子，保持尾巴与身体之间的留白。
- 主图标提供浅色和深色背景；菜单栏为透明底模板，由 macOS 自动适配外观。
- 应用图标不放文字，不绑定当前中文名或英文名。

## 版本与清理

交付按版本编号保存。旧探索稿保留，生产资源由导出脚本更新。临时构建使用独立目录，删除文件须先获得用户同意。

## 导出

```bash
node scripts/export-icons.mjs
cd menubar && ./build.sh
```

导出脚本只依赖本机已有的 Node.js、rsvg-convert、ImageMagick、iconutil 和 macOS 自带的 ditto，不添加运行时依赖。

## 交付范围

`squirrel-icons-v1.zip` 包含 8 份纯路径 SVG 母版、浅色/深色应用 PNG、浅色/深色 ICNS 及完整 iconset、透明彩色标识、黑白模板、网页 favicon 与主屏幕资源。所有派生图标从同一份 SVG 导出。

深色 ICNS 为独立可选文件；当前应用的 Finder 图标使用浅色版。菜单栏模板由 macOS 自动着色；SVG favicon 自身支持系统浅色与深色外观。网页 Web Manifest 使用根路径，部署到子目录时需要调整路径。

参考图由内置 image_gen 绘制；生产母版将参考轮廓转换为平滑 SVG 路径，清理透明边缘并统一色块。原图与提示词一并保留。

[设计提示词](prompts-v1.json) · [验证记录](validation-v1.md) · [完整交付包](squirrel-icons-v1.zip)
