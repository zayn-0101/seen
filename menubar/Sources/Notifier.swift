import Foundation
import UserNotifications

/// 菜单栏应用自己的系统通知。
/// 服务端通过 SSE 发来 notification 事件，由这里用 UNUserNotificationCenter 投递，
/// 不再借用 osascript（macOS 27 会以匿名身份拒绝 osascript 通知）。
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifier()

    private var authorized = false
    private var requested = false
    private var pending: [(title: String, subtitle: String, body: String)] = []

    private static func statusText(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "notDetermined"
        case .denied: return "denied"
        case .authorized: return "authorized"
        case .provisional: return "provisional"
        case .ephemeral: return "ephemeral"
        @unknown default: return "unknown(\(status.rawValue))"
        }
    }

    /// 申请通知权限；只在第一次调用时触发系统弹窗。
    func requestAuthorization(_ completion: @escaping (Bool) -> Void) {
        if requested {
            completion(authorized)
            return
        }
        requested = true
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        SeenLog.write("通知权限：开始检查")
        center.getNotificationSettings { [weak self] settings in
            DispatchQueue.main.async {
                SeenLog.write("通知权限当前状态：" + Self.statusText(settings.authorizationStatus))
                switch settings.authorizationStatus {
                case .authorized, .provisional, .ephemeral:
                    self?.authorized = true
                    self?.flushPending()
                    completion(true)
                case .denied:
                    SeenLog.write("通知权限已被系统拒绝：请到 系统设置 → 通知 → Seen 手动打开")
                    completion(false)
                case .notDetermined:
                    self?.requestAuthorizationFromSystem(center: center, completion: completion)
                @unknown default:
                    SeenLog.write("通知权限状态未知")
                    completion(false)
                }
            }
        }
    }

    private func requestAuthorizationFromSystem(center: UNUserNotificationCenter, completion: @escaping (Bool) -> Void) {
        SeenLog.write("通知权限：请求系统授权弹窗")
        center.requestAuthorization(options: [.alert, .sound]) { [weak self] granted, error in
            DispatchQueue.main.async {
                self?.authorized = granted
                if let error {
                    SeenLog.write("通知权限申请失败：" + error.localizedDescription)
                } else {
                    SeenLog.write("通知权限申请结果：granted=" + (granted ? "true" : "false"))
                }
                if granted { self?.flushPending() }
                completion(granted)
            }
        }
    }

    func prepare() {
        requestAuthorization { _ in }
    }

    func notify(title: String, subtitle: String = "", body: String) {
        let item = (title: title, subtitle: subtitle, body: body)
        DispatchQueue.main.async {
            if self.authorized {
                self.deliver(item)
            } else if self.requested {
                // 用户还没点权限弹窗时先暂存，授权后补发。
                self.pending.append(item)
                if self.pending.count > 8 { self.pending.removeFirst() }
                SeenLog.write("通知暂存（未授权）：" + title)
            } else {
                SeenLog.write("通知丢弃（尚未请求权限）：" + title)
            }
        }
    }

    private func flushPending() {
        let items = pending
        pending.removeAll()
        for item in items { deliver(item) }
    }

    private func deliver(_ item: (title: String, subtitle: String, body: String)) {
        let content = UNMutableNotificationContent()
        content.title = item.title
        if !item.subtitle.isEmpty { content.subtitle = item.subtitle }
        content.body = item.body
        content.sound = .default
        let request = UNNotificationRequest(
            identifier: "seen-" + UUID().uuidString,
            content: content,
            trigger: nil
        )
        SeenLog.write("通知投递：" + item.title + " / " + item.body)
        UNUserNotificationCenter.current().add(request) { error in
            if let error {
                SeenLog.write("通知投递失败：" + error.localizedDescription)
            } else {
                SeenLog.write("通知投递成功：" + item.title)
            }
        }
    }

    // 应用在前台时也显示横幅并播放声音。
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        SeenLog.write("通知前台展示：" + notification.request.content.title)
        completionHandler([.banner, .sound, .list])
    }
}
