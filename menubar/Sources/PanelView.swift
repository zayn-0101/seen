import SwiftUI

struct PanelView: View {
    @ObservedObject var model: AppModel

    private let accent = Color(red: 0.06, green: 0.46, blue: 0.43)
    private let amber = Color(red: 0.71, green: 0.33, blue: 0.04)
    private let red = Color(red: 0.71, green: 0.14, blue: 0.09)
    private let green = Color(red: 0.11, green: 0.55, blue: 0.42)

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            header
            if let status = model.status {
                statusCard(status)
            } else {
                offlineCard
            }
            if let note = model.note, !note.isEmpty {
                Text(note)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Divider()
            if model.status == nil {
                filledButton("启动服务", icon: "power") { model.startService() }
            } else {
                filledButton(pollingLabel, icon: model.status?.polling == true ? "pause.fill" : "play.fill") {
                    model.togglePolling()
                }
            }
            HStack(spacing: 8) {
                ghostButton("网页面板", icon: "safari") { model.openPanel() }
                ghostButton("笔记目录", icon: "folder") { model.openNotes() }
            }
            HStack(spacing: 8) {
                ghostButton("运行诊断", icon: "stethoscope") { model.diagnose() }
                ghostButton("刷新", icon: "arrow.clockwise") {
                    Task { await model.refresh() }
                }
            }
            Divider()
            autoStartRow
            Divider()
            HStack {
                Text(model.errorText == nil ? "本地服务 · 127.0.0.1:4780" : "服务未运行")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer()
                Button("退出") { model.onQuit?() }
                    .buttonStyle(.plain)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .frame(width: 336)
    }

    private var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 1) {
                Text("拾影").font(.system(size: 16, weight: .semibold))
                Text("Seen").font(.system(size: 10)).foregroundStyle(.secondary).tracking(1.2)
            }
            Spacer()
            badge
        }
    }

    private var badge: some View {
        HStack(spacing: 5) {
            Circle().fill(badgeColor).frame(width: 7, height: 7)
            Text(badgeText).font(.system(size: 11, weight: .medium))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(badgeColor.opacity(0.12), in: Capsule())
    }

    private var badgeText: String {
        guard model.status != nil else { return "服务未运行" }
        if model.status?.readOnly == true { return "只读" }
        return model.status?.polling == true ? "轮询中" : "已暂停"
    }

    private var badgeColor: Color {
        guard let status = model.status else { return red }
        if status.readOnly { return .gray }
        return status.polling ? green : amber
    }

    private var pollingLabel: String {
        if model.busy { return "处理中…" }
        return model.status?.polling == true ? "暂停轮询" : "开始轮询"
    }

    private func statusCard(_ status: ServiceStatus) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            if let title = status.lastTitle, !title.isEmpty {
                Text(title)
                    .font(.system(size: 12.5))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("还没有处理过视频")
                    .font(.system(size: 12.5))
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 12) {
                Label("\(status.subjects.count) 个学科", systemImage: "books.vertical")
                Label("\(status.intervalMs / 1000) 秒", systemImage: "timer")
            }
            .font(.system(size: 10.5))
            .foregroundStyle(.secondary)
            if let last = status.lastRunAt {
                Text("上次处理 " + relative(last))
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var offlineCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("本地服务没有在运行")
                .font(.system(size: 12.5, weight: .medium))
            Text("点击「启动服务」会在后台运行 node server/index.js，启动后自动刷新状态。")
                .font(.system(size: 10.5))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(red.opacity(0.07), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var autoStartRow: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("登录时自动启动").font(.system(size: 12, weight: .medium))
                Text(model.autoStart.detail)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Toggle("", isOn: Binding(
                get: { model.autoStart.enabled },
                set: { model.setAutoStart($0) }
            ))
            .toggleStyle(.switch)
            .labelsHidden()
        }
    }

    private func filledButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 11, weight: .semibold))
                Text(title).font(.system(size: 12.5, weight: .semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(accent, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .foregroundStyle(.white)
        }
        .buttonStyle(.plain)
        .disabled(model.busy)
        .opacity(model.busy ? 0.6 : 1)
    }

    private func ghostButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 10.5))
                Text(title).font(.system(size: 11.5))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 7)
            .background(Color.primary.opacity(0.055), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .foregroundStyle(.primary)
        }
        .buttonStyle(.plain)
    }

    private func relative(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}
