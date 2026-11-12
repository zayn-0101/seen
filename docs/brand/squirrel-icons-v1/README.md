# 拾影 Seen · 松鼠图标 v1

选定造型：卷尾、抬头、抱着一粒种子。

## 使用

- macos/Seen.icns：当前默认应用图标；Seen-Dark.icns 为可选深色版，不会自动切换 Finder 图标。两个 iconset 各包含十个标准 macOS 表示。
- svg/：8 份可编辑的纯路径矢量母版，可任意放大。
- png/app-light、png/app-dark：16、32、64、128、256、512、1024px 应用图标。
- png/logo：32、64、128、256、512、1024px 透明彩色标识。
- template/black、template/white：16、18、20、24、32、36、48、54、64px 透明单色轮廓。macOS 使用黑色模板并设置 isTemplate=true，由系统着色。
- web/：SVG favicon、含 16/32/48/64px 的 ICO、PNG favicon、180px Apple Touch、192/512px 主屏幕图标、512px maskable 图标和 Web Manifest。
- squirrel-icons-preview.png：整套资源预览。

主屏幕与 maskable 图标背景不透明；macOS 图标保留透明外边距；模板图标只有透明度与单色像素。网页静态资源部署在根路径时，可直接使用 web/site.webmanifest；若部署在子路径下须调整图标路径。

## 母版与生成

image_gen 独立绘制定稿后，按原轮廓转换为纯路径 SVG，清理边缘噪点并统一四个平涂色块。正式尺寸从同一份 SVG 导出。生成参考与提示词位于项目 menubar/icon/squirrel/reference-v1.png 和 docs/brand/prompts-v1.json。

在项目根目录运行 node scripts/export-icons.mjs 可重新导出。需要本机已有的 rsvg-convert、ImageMagick、iconutil、ditto。不会删除旧文件。
