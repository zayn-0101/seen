# 松鼠图标 v1 验证记录

日期：2026-11-12。

## 交付文件

- ZIP 共 83 个文件，其中 PNG 67 份（含预览），SVG 11 份（含 8 份母版与网页/预览副本）。
- 所有 PNG 签名、尺寸与文件名标注一致。
- 两个 ICNS 均包含完整表示及 1024px `ic10` 图像，容器长度有效。
- ICO 包含 16、32、48、64px 四种尺寸。
- 主屏幕及 maskable PNG 为不透明 RGB；应用与透明标识 PNG 保留 alpha。
- 菜单栏 18/36px 模板尺寸正确，非透明像素 RGB 为全黑，alpha 覆盖 0–255；运行时代码保持 `isTemplate = true`。
- Maskable 图形在中心 80% 安全圆内。
- 生产 SVG 为路径矢量，不包含嵌入位图、远程图片或脚本。
- ZIP 解压完整性检查通过。

## 网页

- 通过 Playwright 访问本机运行中的页面，浅色/深色均成功加载 42 × 42px 松鼠标识。
- 页面已引用 SVG/ICO favicon、Apple Touch 和 Web Manifest；对应静态资源均返回 200。
- 两种外观截图保存在本目录的 `squirrel-web-light-preview-v1.png` 与 `squirrel-web-dark-preview-v1.png`。
- 使用当前源码的真实静态资源函数，在独立临时 HTTP 服务中验证 PNG、ICO、SVG、Web Manifest 的 Content-Type，全部正确。
- 现有运行中的服务未重启，仍沿用启动时的 MIME 表；新 MIME 映射将在下次启动服务时载入。SVG 页面标识已实时生效。

## 构建与现有测试

- `cd core && node --test`：38 项通过，0 失败。
- `cd menubar && ./build.sh`：成功生成 `menubar/dist/Seen.app`，旧工作区构建已移入备份目录。
- `codesign --verify --deep --strict menubar/dist/Seen.app`：通过。
- `menubar/dist/Seen.app/Contents/MacOS/Seen --self-check`：`ok: true`。
- JavaScript、Shell 语法检查与 `git diff --check`：通过。

本轮未安装或替换用户 Applications 中的应用。菜单栏以生成的模板资源和现有 AppKit 模板配置验证，未启动第二个应用实例做实机菜单栏替换。
