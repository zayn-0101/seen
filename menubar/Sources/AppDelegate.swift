import AppKit
import SwiftUI

/// 面板状态与动作。
final class AppModel: ObservableObject {
    @Published var status: ServiceStatus?
    @Published var errorText: String?
    @Published var busy = false
    @Published var note: String?
    @Published var autoStart = AutoLaunch.state()

    var onQuit: (() -> Void)?
    var onStartService: (() -> Void)?

    func refresh() async {
        do {
            let snapshot = try await API.status()
            await MainActor.run {
                self.status = snapshot
                self.errorText = nil
            }
        } catch {
            let text: String
            if let serviceError = error as? ServiceError {
                text = serviceError.errorDescription ?? "无法连接服务"
            } else {
                text = error.localizedDescription
            }
            await MainActor.run {
                self.status = nil
                self.errorText = text
            }
        }
    }

    func togglePolling() {
        guard let current = status, !current.readOnly else { return }
        let next = !current.polling
        Task {
            await MainActor.run { self.busy = true }
            do {
                try await API.setStarted(next)
                await refresh()
                await MainActor.run { self.note = next ? "已开始轮询" : "已暂停轮询" }
            } catch {
                await MainActor.run { self.note = "操作失败：" + error.localizedDescription }
            }
            await MainActor.run { self.busy = false }
        }
    }

    func openPanel() {
        if let url = URL(string: "http://127.0.0.1:4780") {
            NSWorkspace.shared.open(url)
        }
    }

    func openNotes() {
        guard let dir = status?.outputDir, !dir.isEmpty else {
            note = "还没有笔记目录信息，先让服务运行一次"
            return
        }
        NSWorkspace.shared.open(URL(fileURLWithPath: dir))
    }

    func diagnose() {
        Task {
            await MainActor.run { self.busy = true }
            do {
                let checks = try await API.check()
                let lines = checks.map { item -> String in
                    let id = item["id"] as? String ?? "check"
                    let ok = item["ok"] as? Bool ?? false
                    let detail = item["detail"] as? String ?? ""
                    return (ok ? "✅ " : "⚠️ ") + id + "：" + detail
                }
                let text = lines.isEmpty ? "诊断已完成，没有返回检查项。" : lines.joined(separator: "\n")
                await MainActor.run { self.showAlert(title: "Seen 诊断", message: text) }
            } catch {
                await MainActor.run { self.showAlert(title: "诊断失败", message: error.localizedDescription) }
            }
            await MainActor.run { self.busy = false }
        }
    }

    func startService() {
        onStartService?()
    }

    func setAutoStart(_ on: Bool) {
        do {
            let detail = try AutoLaunch.setEnabled(on)
            autoStart = AutoLaunchState(enabled: on, detail: detail)
            note = detail
        } catch {
            autoStart = AutoLaunch.state()
            note = "设置失败：" + error.localizedDescription
        }
    }

    func refreshAutoStart() {
        autoStart = AutoLaunch.state()
    }

    private func showAlert(title: String, message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.alertStyle = .informational
        alert.addButton(withTitle: "好")
        alert.runModal()
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = AppModel()
    let service = ServiceProcess()
    private var statusItem: NSStatusItem!
    private var popover: NSPopover!
    private var timer: Timer?
    private var signalSources: [DispatchSourceSignal] = []

    private func log(_ text: String) {
        let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".seen")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("menubar.log")
        let stamp = ISO8601DateFormatter().string(from: Date())
        let line = "[" + stamp + "] " + text + "\n"
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile()
            handle.write(Data(line.utf8))
            try? handle.close()
        } else {
            try? Data(line.utf8).write(to: url)
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let bundleID = Bundle.main.bundleIdentifier,
           NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).count > 1 {
            log("已有实例在运行，退出本实例")
            NSApp.terminate(nil)
            return
        }

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            let named = NSImage(named: "StatusIcon")
            let image = named ?? NSImage(size: NSSize(width: 18, height: 18))
            image.isTemplate = true
            image.size = NSSize(width: 18, height: 18)
            button.image = image
            button.imagePosition = .imageOnly
            button.toolTip = "Seen · 拾影"
            button.target = self
            button.action = #selector(togglePopover)
            log("菜单栏图标已创建（StatusIcon \(named == nil ? "缺失，用空白占位" : "已加载")），repo=" + service.repoPath)
        }

        popover = NSPopover()
        popover.behavior = .transient
        popover.animates = true
        let host = NSHostingController(rootView: PanelView(model: model))
        host.view.frame = NSRect(x: 0, y: 0, width: 336, height: 380)
        popover.contentViewController = host
        popover.contentSize = NSSize(width: 336, height: 380)

        model.onQuit = { NSApp.terminate(nil) }
        model.onStartService = { [weak self] in self?.ensureService() }

        // 收到 SIGTERM/SIGINT（例如注销、系统关机）时也停掉自己拉起的服务进程
        for sig in [SIGTERM, SIGINT] {
            signal(sig, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
            source.setEventHandler { [weak self] in
                self?.service.stopIfSpawnedByUs()
                NSApp.terminate(nil)
            }
            source.resume()
            signalSources.append(source)
        }

        Task {
            await model.refresh()
            if model.status == nil {
                ensureService()
            } else {
                log("服务已在运行：" + (model.status?.lastTitle ?? "无最近视频"))
            }
        }

        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { await self.model.refresh() }
            self.model.refreshAutoStart()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
        service.stopIfSpawnedByUs()
    }

    @objc private func togglePopover() {
        guard let button = statusItem.button else { return }
        if popover.isShown {
            popover.performClose(nil)
            return
        }
        Task { await model.refresh() }
        model.refreshAutoStart()
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func ensureService() {
        guard model.status == nil else { return }
        _ = service.startIfNeeded()
        Task {
            for _ in 0..<20 {
                try? await Task.sleep(nanoseconds: 500_000_000)
                await model.refresh()
                if model.status != nil { return }
            }
        }
    }
}
