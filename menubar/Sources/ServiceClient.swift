import Foundation

/// 本地服务的只读快照（只解析面板需要的字段）。
struct ServiceStatus {
    var polling = false
    var readOnly = false
    var ok = false
    var intervalMs = 15000
    var lastTitle: String?
    var lastRunAt: Date?
    var outputDir: String?
    var vaultPath: String?
    var noteRoot: String?
    var subjects: [(name: String, videos: Int)] = []
}

enum ServiceError: LocalizedError {
    case unreachable(String)
    case badResponse(String)

    var errorDescription: String? {
        switch self {
        case .unreachable(let detail): return "服务无法连接：" + detail
        case .badResponse(let detail): return "服务返回异常：" + detail
        }
    }
}

enum API {
    static let base = URL(string: "http://127.0.0.1:4780")!

    private static func request(path: String, method: String, body: Data?) -> URLRequest {
        var req = URLRequest(url: base.appendingPathComponent(path))
        req.httpMethod = method
        req.timeoutInterval = 1.5
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return req
    }

    static func status(timeout: TimeInterval = 1.5) async throws -> ServiceStatus {
        var req = request(path: "/api/status", method: "GET", body: nil)
        req.timeoutInterval = timeout
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                throw ServiceError.badResponse("HTTP \(String(describing: (response as? HTTPURLResponse)?.statusCode))")
            }
            return parse(data)
        } catch let error as ServiceError {
            throw error
        } catch {
            throw ServiceError.unreachable(error.localizedDescription)
        }
    }

    static func setStarted(_ started: Bool) async throws {
        var req = request(path: "/api/config", method: "POST", body: try JSONSerialization.data(withJSONObject: ["started": started]))
        req.timeoutInterval = 5
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw ServiceError.badResponse(text)
        }
    }

    static func review() async throws -> [String: Any] {
        var req = request(path: "/api/review", method: "POST", body: Data("{}".utf8))
        req.timeoutInterval = 30
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw ServiceError.badResponse("生成回顾失败")
        }
        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    static func check() async throws -> [[String: Any]] {
        var req = request(path: "/api/check", method: "POST", body: Data("{}".utf8))
        req.timeoutInterval = 30
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw ServiceError.badResponse("诊断请求失败")
        }
        let object = try JSONSerialization.jsonObject(with: data)
        if let dict = object as? [String: Any], let checks = dict["checks"] as? [[String: Any]] {
            return checks
        }
        if let arr = object as? [[String: Any]] { return arr }
        return []
    }

    private static func parse(_ data: Data) -> ServiceStatus {
        var result = ServiceStatus()
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let status = root["status"] as? [String: Any] else { return result }
        result.ok = status["ok"] as? Bool ?? false
        result.polling = status["polling"] as? Bool ?? false
        result.readOnly = status["readOnly"] as? Bool ?? false
        result.intervalMs = status["pollIntervalMs"] as? Int ?? 15000
        result.outputDir = status["outputDir"] as? String
        result.vaultPath = status["vaultPath"] as? String
        result.noteRoot = status["noteRoot"] as? String
        result.lastTitle = status["lastTitle"] as? String
        if let ms = status["lastRunAt"] as? Double, ms > 0 {
            result.lastRunAt = Date(timeIntervalSince1970: ms / 1000)
        }
        if let subjects = status["subjects"] as? [[String: Any]] {
            result.subjects = subjects.compactMap { item in
                guard let name = item["subject"] as? String, let count = item["videos"] as? Int else { return nil }
                return (name, count)
            }
        }
        return result
    }
}

/// 管理 Seen 本地服务进程：只在端口无响应时由菜单栏 app 拉起。
final class ServiceProcess {
    private var process: Process?
    private(set) var spawnedByUs = false

    var repoPath: String {
        if let override = ProcessInfo.processInfo.environment["SEEN_REPO_PATH"], !override.isEmpty {
            return override
        }
        if let path = Bundle.main.object(forInfoDictionaryKey: "SeenRepoPath") as? String, !path.isEmpty, path != "__REPO_PATH__" {
            return path
        }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Code/seen").path
    }

    var isRunning: Bool { process?.isRunning ?? false }

    func startIfNeeded() -> Bool {
        guard process == nil else { return false }
        let repo = repoPath
        guard FileManager.default.fileExists(atPath: repo + "/server/index.js") else { return false }

        let logDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".seen")
        try? FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)
        let logURL = logDir.appendingPathComponent("server.log")

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/zsh")
        proc.arguments = ["-lc", "cd \"\(repo)\" && exec node server/index.js --no-open"]
        let out = FileHandle(forWritingAtPath: logURL.path) ?? {
            FileManager.default.createFile(atPath: logURL.path, contents: nil)
            return FileHandle(forWritingAtPath: logURL.path)
        }()
        if let out {
            _ = try? out.seekToEnd()
            proc.standardOutput = out
            proc.standardError = out
        }
        do {
            try proc.run()
            process = proc
            spawnedByUs = true
            return true
        } catch {
            return false
        }
    }

    func stopIfSpawnedByUs() {
        guard spawnedByUs, let process, process.isRunning else { return }
        process.terminate()
        spawnedByUs = false
    }
}
