import SwiftUI

struct PanelView: View {
    @ObservedObject var model: AppModel
    @Environment(\.colorScheme) private var colorScheme

    private let accent = Color(red: 200.0 / 255.0, green: 75.0 / 255.0, blue: 28.0 / 255.0)
    private var isDark: Bool { colorScheme == .dark }
    private var background: Color { isDark ? Color(red: 0.075, green: 0.12, blue: 0.09) : Color(red: 0.979, green: 0.98, blue: 0.964) }
    private var surface: Color { isDark ? Color(red: 0.13, green: 0.19, blue: 0.15) : Color(red: 0.943, green: 0.953, blue: 0.925) }
    private var secondary: Color { isDark ? Color(red: 0.74, green: 0.82, blue: 0.75) : Color(red: 0.35, green: 0.42, blue: 0.37) }
    private var green: Color { isDark ? Color(red: 0.70, green: 0.88, blue: 0.72) : Color(red: 0.21, green: 0.43, blue: 0.28) }
    private var amber: Color { isDark ? Color(red: 0.96, green: 0.79, blue: 0.54) : Color(red: 0.53, green: 0.32, blue: 0.04) }
    private var red: Color { isDark ? Color(red: 1, green: 0.68, blue: 0.62) : Color(red: 0.63, green: 0.17, blue: 0.14) }
    private var rule: Color { isDark ? Color.white.opacity(0.14) : Color.black.opacity(0.09) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            divider.padding(.vertical, 15)

            if let status = model.status {
                statusCard(status)
                if !status.llmConfigured {
                    unconfiguredBanner.padding(.top, 10)
                }
            } else {
                offlineCard
            }

            if let note = model.note, !note.isEmpty {
                statusNote(note)
                    .padding(.top, 10)
            }

            if model.status == nil {
                primaryButton("启动服务", icon: "power") { model.startService() }
                    .padding(.top, 15)
            } else {
                primaryButton(pollingLabel, icon: model.status?.polling == true ? "pause.fill" : "play.fill") {
                    model.togglePolling()
                }
                .padding(.top, 15)
            }

            divider.padding(.vertical, 15)
            quickActions
            divider.padding(.vertical, 15)
            autoStartRow
            divider.padding(.vertical, 13)
            footer
        }
        .padding(18)
        .frame(width: 336)
        .fixedSize(horizontal: false, vertical: true)
        .background(background)
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image("BrandIcon")
                .resizable()
                .scaledToFit()
                .frame(width: 38, height: 38)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("拾影").font(.system(size: 17, weight: .bold))
                Text("Seen").font(.system(size: 10, weight: .medium)).foregroundStyle(secondary).tracking(0.8)
            }
            Spacer(minLength: 8)
            badge
        }
    }

    private var badge: some View {
        HStack(spacing: 6) {
            Circle().fill(badgeColor).frame(width: 6, height: 6)
            Text(badgeText).font(.system(size: 10.5, weight: .medium))
        }
        .foregroundStyle(badgeColor)
        .padding(.horizontal, 9)
        .padding(.vertical, 6)
        .background(badgeColor.opacity(isDark ? 0.16 : 0.1), in: Capsule())
        .accessibilityElement(children: .combine)
    }

    private var badgeText: String {
        guard model.status != nil else { return "服务未运行" }
        if model.status?.readOnly == true { return "只读" }
        return model.status?.polling == true ? "轮询中" : "已暂停"
    }

    private var badgeColor: Color {
        guard let status = model.status else { return red }
        if status.readOnly { return secondary }
        return status.polling ? green : amber
    }

    private var pollingLabel: String {
        if model.busy { return "处理中…" }
        if model.status?.readOnly == true { return "另一个实例运行中" }
        return model.status?.polling == true ? "暂停轮询" : "开始轮询"
    }

    private func statusCard(_ status: ServiceStatus) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 7) {
                RoundedRectangle(cornerRadius: 1.5).fill(accent).frame(width: 3, height: 13)
                Text("最近处理").font(.system(size: 11, weight: .semibold))
                Spacer()
                if let last = status.lastRunAt {
                    Text(relative(last)).font(.system(size: 10)).foregroundStyle(secondary)
                }
            }
            if let title = status.lastTitle, !title.isEmpty {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .help(title)
            } else {
                Text("还没有处理过视频")
                    .font(.system(size: 12))
                    .foregroundStyle(secondary)
            }
            HStack(spacing: 12) {
                Label("\(status.subjects.count) 个学科", systemImage: "books.vertical")
                Label("\(status.intervalMs / 1000) 秒", systemImage: "clock")
            }
            .font(.system(size: 10.5))
            .foregroundStyle(secondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(surface, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
    }

    private var unconfiguredBanner: some View {
        Button(action: { model.openSettings() }) {
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 11))
                Text("尚未配置模型，点此设置").font(.system(size: 11.5, weight: .medium))
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
            .foregroundStyle(amber)
            .padding(.vertical, 8)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(amber.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var offlineCard: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("本地服务没有在运行")
                .font(.system(size: 12.5, weight: .semibold))
            Text("启动服务后，拾影会在后台继续整理视频。")
                .font(.system(size: 11))
                .foregroundStyle(secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(red.opacity(0.09), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
    }

    @ViewBuilder
    private func statusNote(_ note: String) -> some View {
        let text = Text(note).font(.system(size: 11)).foregroundStyle(secondary)
        if note.count > 120 {
            ScrollView {
                text.frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(height: 90)
        } else {
            text.fixedSize(horizontal: false, vertical: true)
        }
    }

    private var quickActions: some View {
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                actionButton("网页面板", icon: "rectangle.on.rectangle") { model.openPanel() }
                actionButton("笔记目录", icon: "folder") { model.openNotes() }
                actionButton("本周回顾", icon: "calendar") { model.weeklyReview() }
            }
            HStack(spacing: 6) {
                actionButton("运行诊断", icon: "stethoscope") { model.diagnose() }
                actionButton("设置", icon: "gearshape") { model.openSettings() }
            }
        }
    }

    private var autoStartRow: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                Text("登录时自动启动").font(.system(size: 11.5, weight: .medium))
                Text(model.autoStart.detail)
                    .font(.system(size: 10))
                    .foregroundStyle(secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 6)
            Toggle("登录时自动启动", isOn: Binding(
                get: { model.autoStart.enabled },
                set: { model.setAutoStart($0) }
            ))
            .toggleStyle(.switch)
            .tint(accent)
            .labelsHidden()
        }
    }

    private var footer: some View {
        HStack {
            HStack(spacing: 6) {
                Circle().fill(model.status == nil ? red : green).frame(width: 5, height: 5)
                Text(model.status == nil ? "服务未运行" : "本地服务")
            }
            .font(.system(size: 10))
            .foregroundStyle(secondary)
            Spacer()
            Button("退出") { model.onQuit?() }
                .buttonStyle(.plain)
                .font(.system(size: 10.5, weight: .medium))
                .foregroundStyle(secondary)
        }
    }

    private var divider: some View { Rectangle().fill(rule).frame(height: 1) }

    private func primaryButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        let disabled = model.busy || model.status?.readOnly == true
        return Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: icon).font(.system(size: 11, weight: .semibold)).foregroundColor(.white)
                Text(title).font(.system(size: 12.5, weight: .semibold)).foregroundColor(.white)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(accent, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .opacity(disabled ? 0.55 : 1)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }

    private func actionButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 10.5, weight: .medium))
                Text(title).font(.system(size: 11, weight: .medium)).lineLimit(1)
            }
            .frame(maxWidth: .infinity, minHeight: 35)
            .background(surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
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
