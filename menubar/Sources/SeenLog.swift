import Foundation

/// 菜单栏应用的文件日志：写 ~/.seen/menubar.log。
/// 通知权限、SSE 连接这类系统行为没有 UI 可看，必须留下证据。
enum SeenLog {
    private static let queue = DispatchQueue(label: "com.zayn0101.seen.log")

    static func write(_ text: String) {
        queue.async {
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
    }
}
