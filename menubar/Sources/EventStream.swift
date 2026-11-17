import Foundation

/// 订阅本地服务的 SSE，把服务端事件转给菜单栏应用。
/// 这样服务端可以继续用 Node 处理业务，通知由应用自己的 bundle 身份投递。
final class EventStream: NSObject, URLSessionDataDelegate {
    static let shared = EventStream()

    private var session: URLSession!
    private var task: URLSessionDataTask?
    private var buffer = Data()
    private var stopped = true
    private var reconnectWork: DispatchWorkItem?

    var onEvent: (([String: Any]) -> Void)?

    override init() {
        super.init()
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 60 * 60 * 24
        config.timeoutIntervalForResource = 60 * 60 * 24
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    func start() {
        stopped = false
        connect()
    }

    func stop() {
        stopped = true
        reconnectWork?.cancel()
        task?.cancel()
        task = nil
    }

    private func connect() {
        guard !stopped else { return }
        guard let url = URL(string: "http://127.0.0.1:4780/api/events") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 60 * 60 * 24
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        buffer.removeAll(keepingCapacity: true)
        task = session.dataTask(with: request)
        task?.resume()
    }

    private func scheduleReconnect() {
        guard !stopped else { return }
        reconnectWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.connect()
        }
        reconnectWork = work
        DispatchQueue.global().asyncAfter(deadline: .now() + 3, execute: work)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        buffer.append(data)
        let separator = Data("\n\n".utf8)
        while let range = buffer.range(of: separator) {
            let chunk = buffer.subdata(in: buffer.startIndex..<range.lowerBound)
            buffer.removeSubrange(buffer.startIndex..<range.upperBound)
            guard let text = String(data: chunk, encoding: .utf8) else { continue }
            for line in text.split(separator: "\n", omittingEmptySubsequences: true) where line.hasPrefix("data:") {
                let json = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                guard let data = json.data(using: .utf8),
                      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                DispatchQueue.main.async { [weak self] in
                    self?.onEvent?(object)
                }
            }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard !stopped else { return }
        scheduleReconnect()
    }
}
