import Foundation
import ServiceManagement

struct AutoLaunchState {
    var enabled = false
    var detail = "未启用"
}

/// 登录自启：优先系统登录项 API，回退 LaunchAgent。
/// 两种机制都指向当前 app bundle，开/关时互相清理。
enum AutoLaunch {
    static let label = "com.seen.menubar"

    static var plistURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents/com.seen.menubar.plist")
    }

    static var appPath: String { Bundle.main.bundlePath }

    static func state() -> AutoLaunchState {
        if #available(macOS 13.0, *) {
            switch SMAppService.mainApp.status {
            case .enabled:
                return AutoLaunchState(enabled: true, detail: "已通过登录项启用")
            case .requiresApproval:
                return AutoLaunchState(enabled: true, detail: "等待系统允许：系统设置 → 通用 → 登录项")
            case .notRegistered, .notFound:
                break
            @unknown default:
                break
            }
        }
        if FileManager.default.fileExists(atPath: plistURL.path) {
            return AutoLaunchState(enabled: true, detail: "已通过 LaunchAgent 启用")
        }
        return AutoLaunchState(enabled: false, detail: "未启用")
    }

    /// 返回设置后的说明文字；失败抛错。
    @discardableResult
    static func setEnabled(_ on: Bool) throws -> String {
        if on {
            if #available(macOS 13.0, *) {
                do {
                    try SMAppService.mainApp.register()
                    let status = SMAppService.mainApp.status
                    if status == .enabled {
                        removeAgent()
                        return "已通过登录项启用"
                    }
                    if status == .requiresApproval {
                        removeAgent()
                        return "已注册，等待系统允许：系统设置 → 通用 → 登录项"
                    }
                } catch {
                    // 不在 /Applications 等情况下回退 LaunchAgent
                }
            }
            try writeAgent()
            return "已通过 LaunchAgent 启用"
        } else {
            if #available(macOS 13.0, *) {
                try? SMAppService.mainApp.unregister()
            }
            removeAgent()
            return "已关闭"
        }
    }

    static func writeAgent() throws {
        let dir = plistURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dict: [String: Any] = [
            "Label": label,
            "ProgramArguments": ["/usr/bin/open", "-a", appPath],
            "RunAtLoad": true,
            "LimitLoadToSessionType": "Aqua",
        ]
        let data = try PropertyListSerialization.data(fromPropertyList: dict, format: .xml, options: 0)
        try data.write(to: plistURL)
        _ = launchctl(["bootstrap", "gui/\(getuid())", plistURL.path])
    }

    static func removeAgent() {
        _ = launchctl(["bootout", "gui/\(getuid())/\(label)"])
        try? FileManager.default.removeItem(at: plistURL)
    }

    @discardableResult
    static func launchctl(_ args: [String]) -> Int32 {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = args
        process.standardOutput = Pipe()
        process.standardError = Pipe()
        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus
        } catch {
            return -1
        }
    }
}
