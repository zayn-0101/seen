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
    let sem = DispatchSemaphore(value: 0)
    var line = "{\"ok\":false,\"error\":\"timeout\"}"
    Task {
        do {
            let s = try await API.status(timeout: 3)
            let subjects = s.subjects.map { "\"\($0.name)\"" }.joined(separator: ",")
            line = "{\"ok\":true,\"polling\":\(s.polling),\"readOnly\":\(s.readOnly),\"intervalMs\":\(s.intervalMs),\"subjects\":[\(subjects)]}"
        } catch {
            let text = String(describing: error).replacingOccurrences(of: "\"", with: "'")
            line = "{\"ok\":false,\"error\":\"\(text)\"}"
        }
        sem.signal()
    }
    _ = sem.wait(timeout: .now() + 6)
    print(line)
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
