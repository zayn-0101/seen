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
- `icon/`：图标 SVG 源文件；`scripts/make-icons.sh` 生成 PNG / ICNS
