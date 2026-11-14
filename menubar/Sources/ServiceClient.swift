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
    var llmConfigured = true
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
        if let llm = root["llm"] as? [String: Any] {
            result.llmConfigured = llm["configured"] as? Bool ?? true
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

    /// 打包版的内置资源目录（Contents/Resources/app）；开发版返回 nil。
    var bundledResourcePath: String? {
        guard let res = Bundle.main.resourceURL else { return nil }
        let dir = res.appendingPathComponent("app").path
        guard FileManager.default.fileExists(atPath: dir + "/server/index.js") else { return nil }
        return dir
    }

    var repoPath: String {
        if let override = ProcessInfo.processInfo.environment["SEEN_REPO_PATH"], !override.isEmpty {
            return override
        }
        // 打包版优先用 app 内自带的代码，不依赖仓库位置。
        if let bundled = bundledResourcePath { return bundled }
        if let path = Bundle.main.object(forInfoDictionaryKey: "SeenRepoPath") as? String, !path.isEmpty, path != "__REPO_PATH__" {
            return path
        }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Code/seen").path
    }

    /// 当前机器 CPU 架构对应的运行时后缀（arm64 / x64）。
    private var runtimeArchSuffix: String {
        var info = utsname()
        uname(&info)
        let machine = withUnsafePointer(to: &info.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
        }
        return machine == "arm64" ? "arm64" : "x64"
    }

    /// 优先用 app 内置的 Node 运行时（按架构挑）；开发版回退到 PATH 里的 node。
    var nodeBinary: String {
        if let res = Bundle.main.resourceURL {
            let runtimeDir = res.appendingPathComponent("runtime")
            let candidates = [
                runtimeDir.appendingPathComponent("node-\(runtimeArchSuffix)").path,
                runtimeDir.appendingPathComponent("node").path,
            ]
            for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate) {
                return candidate
            }
        }
        return "node"
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
        proc.arguments = ["-lc", "cd \"\(repo)\" && exec \"\(nodeBinary)\" server/index.js --no-open"]
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
