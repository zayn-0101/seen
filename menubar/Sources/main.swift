import AppKit
import SwiftUI

// 登录自启的脚本化入口（也用于排障）：--autostart status|on|off
if let index = CommandLine.arguments.firstIndex(of: "--autostart") {
    let value = CommandLine.arguments.count > index + 1 ? CommandLine.arguments[index + 1] : "status"
    if value == "status" {
        let state = AutoLaunch.state()
        print((state.enabled ? "enabled" : "disabled") + " · " + state.detail)
        exit(0)
    }
    guard value == "on" || value == "off" else {
        fputs("用法：--autostart status|on|off\n", stderr)
        exit(2)
    }
    do {
        let detail = try AutoLaunch.setEnabled(value == "on")
        print(detail)
        exit(0)
    } catch {
        print("error: " + error.localizedDescription)
        exit(1)
    }
}

// 无人值守自检：打印一次状态 JSON 后退出，不创建菜单栏图标。
if CommandLine.arguments.contains("--self-check") {
    Task {
        let report: [String: Any]
        do {
            let status = try await API.status(timeout: 3)
            report = ["ok": status.ok, "polling": status.polling, "readOnly": status.readOnly,
                      "intervalMs": status.intervalMs, "subjects": status.subjects.map { $0.name }]
        } catch {
            report = ["ok": false, "error": error.localizedDescription]
        }
        do {
            let data = try JSONSerialization.data(withJSONObject: report)
            print(String(decoding: data, as: UTF8.self))
        } catch {
            fputs("无法编码自检结果。\n", stderr)
            exit(1)
        }
        exit(report["ok"] as? Bool == true ? 0 : 1)
    }
    dispatchMain()
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
