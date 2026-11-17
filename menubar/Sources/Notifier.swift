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

    /// 申请通知权限；只在第一次调用时触发系统弹窗。
    func requestAuthorization(_ completion: @escaping (Bool) -> Void) {
        if requested {
            completion(authorized)
            return
        }
        requested = true
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound]) { [weak self] granted, error in
            DispatchQueue.main.async {
                self?.authorized = granted
                if let error {
                    NSLog("Seen 通知权限申请失败：\(error.localizedDescription)")
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
        UNUserNotificationCenter.current().add(request) { error in
            if let error {
                NSLog("Seen 通知投递失败：\(error.localizedDescription)")
            }
        }
    }

    // 应用在前台时也显示横幅并播放声音。
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .list])
    }
}
