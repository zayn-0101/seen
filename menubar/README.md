# Seen 菜单栏应用

macOS 菜单栏常驻小应用，作为 Seen 本地服务的控制器。Swift + AppKit，无第三方依赖。

## 构建

```bash
./build.sh              # → dist/Seen.app
./build.sh --install    # 复制到 ~/Applications/Seen.app
```

功能、登录自启、图标替换和排障说明见根目录 [README](../README.md) 的「菜单栏应用（macOS）」章节。

## 结构

- `Sources/main.swift`：入口，CLI 子命令 `--self-check` / `--autostart status|on|off`
- `Sources/AppDelegate.swift`：菜单栏图标、弹出面板、服务进程生命周期
- `Sources/PanelView.swift`：SwiftUI 面板
- `Sources/ServiceClient.swift`：本地服务 HTTP 客户端
- `Sources/AutoLaunch.swift`：登录自启（SMAppService 优先，LaunchAgent 回退）
- `icon/squirrel/`：选定松鼠形象的 SVG 母版；旧 app-a/b/c 与 status-a/b/c 保留。
- `scripts/make-icons.sh`：调用根目录 `scripts/export-icons.mjs` 统一生成应用、菜单栏和网页图标。
- `Resources/BrandIcon*`：弹出面板标题旁的彩色松鼠标识。

完整图标包与使用规范见 [`../docs/brand/`](../docs/brand/README.md)。默认构建将已有的 `dist/Seen.app` 移入独立备份目录，再生成新包。
