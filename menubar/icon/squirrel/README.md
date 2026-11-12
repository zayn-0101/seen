# 松鼠母版

此目录保存选定松鼠形象的生产母版。

- `reference-v1.png`：内置 image_gen 绘制的独立透明底定稿参考。
- `squirrel.svg`：彩色透明底母版。
- `squirrel-template.svg`：为菜单栏优化的透明底单色母版。
- `squirrel-white.svg`：同轮廓白色版，供深色背景使用。
- `app-light.svg`、`app-dark.svg`：macOS 应用图标母版。
- `app-square.svg`、`app-maskable.svg`：不透明主屏幕与安全区版本。
- `favicon.svg`：小尺寸网页图标母版。

由根目录 `scripts/export-icons.mjs` 导出各尺寸。所有派生文件从母版生成，不单独手动修改；早期 app-a/b/c 与 status-a/b/c 保留。

参考形象由 image_gen 绘制，正式母版按参考轮廓转换成二次贝塞尔路径，消除杂边并统一平涂色。SVG 不包含嵌入位图。配色：暖橙 `#C84B1C`、奶油 `#FFF0D6`、种子金 `#F6A51A`、眼睛深棕 `#572A17`。
