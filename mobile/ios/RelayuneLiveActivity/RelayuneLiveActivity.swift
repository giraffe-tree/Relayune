import ActivityKit
import SwiftUI
import WidgetKit

@main
struct RelayuneLiveActivityBundle: WidgetBundle {
    var body: some Widget { RelayuneLiveActivity() }
}

struct RelayuneLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RelayTaskAttributes.self) { context in
            RelayTaskCard(state: context.state, stale: context.isStale)
                .padding(18)
                .activityBackgroundTint(RelayPalette.night)
                .activitySystemActionForegroundColor(RelayPalette.mint)
                .widgetURL(taskURL(context.attributes.sessionId))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 7) {
                        EclipseMark(color: tint(context), size: 18)
                        Text(context.state.provider)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(RelayPalette.secondary)
                    }.padding(.top, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    TaskClock(state: context.state, stale: context.isStale, compact: true)
                        .foregroundStyle(tint(context)).padding(.top, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 9) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(label(context))
                                .font(.system(size: 22, weight: .semibold, design: .rounded))
                                .foregroundStyle(tint(context))
                                .lineLimit(1).minimumScaleFactor(0.65)
                            Spacer(minLength: 8)
                            Image(systemName: symbol(context.state, stale: context.isStale))
                                .foregroundStyle(tint(context))
                        }
                        Text(context.state.title)
                            .font(.subheadline).lineLimit(1)
                            .foregroundStyle(RelayPalette.secondary)
                        HStack {
                            StatusTrace(color: tint(context))
                            Spacer()
                            Text(context.state.actionLabel)
                                .font(.caption.weight(.semibold))
                            Image(systemName: "arrow.up.right").font(.caption2.weight(.bold))
                        }.foregroundStyle(tint(context))
                    }.padding(.top, 8).padding(.bottom, 4)
                }
            } compactLeading: {
                EclipseMark(color: tint(context), size: 20)
            } compactTrailing: {
                if context.state.state == "running" && !context.isStale && context.state.startKnown {
                    TaskClock(state: context.state, stale: false, compact: true)
                        .frame(width: 48).foregroundStyle(tint(context))
                } else {
                    Image(systemName: symbol(context.state, stale: context.isStale))
                        .foregroundStyle(tint(context))
                        .accessibilityLabel(label(context))
                }
            } minimal: {
                Image(systemName: symbol(context.state, stale: context.isStale))
                    .foregroundStyle(tint(context))
                    .accessibilityLabel(label(context))
            }
            .widgetURL(taskURL(context.attributes.sessionId))
            .keylineTint(tint(context))
        }
    }

    private func label(_ context: ActivityViewContext<RelayTaskAttributes>) -> String {
        context.isStale && context.state.finishedAt == nil
            ? context.state.staleLabel : context.state.statusLabel
    }
    private func tint(_ context: ActivityViewContext<RelayTaskAttributes>) -> Color {
        taskTint(context.state, stale: context.isStale)
    }
}

private enum RelayPalette {
    static let night = Color(red: 0.043, green: 0.071, blue: 0.11)
    static let moon = Color(red: 0.965, green: 0.973, blue: 0.957)
    static let mint = Color(red: 0.412, green: 0.882, blue: 0.824)
    static let amber = Color(red: 0.97, green: 0.79, blue: 0.51)
    static let secondary = Color(red: 0.65, green: 0.71, blue: 0.74)
}

private func taskTint(_ state: RelayTaskAttributes.ContentState, stale: Bool) -> Color {
    if stale && state.finishedAt == nil || state.state == "stale" { return RelayPalette.secondary }
    switch state.state {
    case "approval", "question", "failed": return RelayPalette.amber
    case "stopped": return RelayPalette.secondary
    default: return RelayPalette.mint
    }
}

private func symbol(_ state: RelayTaskAttributes.ContentState, stale: Bool) -> String {
    if stale && state.finishedAt == nil || state.state == "stale" { return "arrow.triangle.2.circlepath" }
    switch state.state {
    case "approval": return "hand.raised.fill"
    case "question": return "questionmark.bubble.fill"
    case "completed": return "checkmark.circle.fill"
    case "failed": return "exclamationmark.circle.fill"
    case "stopped": return "stop.circle"
    default: return "moonphase.waning.crescent"
    }
}

private func taskURL(_ session: String) -> URL? {
    var components = URLComponents()
    components.scheme = "relayune"
    components.host = "task"
    components.queryItems = [URLQueryItem(name: "session", value: session)]
    return components.url
}

private struct EclipseMark: View {
    var color: Color
    var size: CGFloat
    var body: some View {
        ZStack {
            Circle().stroke(color.opacity(0.25), lineWidth: 1)
            Image(systemName: "moonphase.waning.crescent")
                .font(.system(size: size * 0.8)).foregroundStyle(color)
        }.frame(width: size, height: size).accessibilityHidden(true)
    }
}

private struct StatusTrace: View {
    var color: Color
    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 5, height: 5)
            Capsule().fill(color.opacity(0.25)).frame(width: 42, height: 1)
            Circle().stroke(color.opacity(0.4), lineWidth: 1).frame(width: 5, height: 5)
        }.accessibilityHidden(true)
    }
}

private struct TaskClock: View {
    var state: RelayTaskAttributes.ContentState
    var stale: Bool
    var compact = false
    var body: some View {
        Group {
            if !state.startKnown {
                Text(state.updatedAt, style: .time)
            } else if let finish = state.finishedAt {
                Text(duration(max(0, finish.timeIntervalSince(state.startedAt))))
            } else if stale || state.state == "stale" {
                Text(state.updatedAt, style: .time)
            } else {
                Text(timerInterval: state.startedAt...max(state.startedAt, state.staleAt), countsDown: false)
            }
        }
        .font(.system(size: compact ? 13 : 26, weight: .medium, design: .rounded))
        .monospacedDigit().lineLimit(1).minimumScaleFactor(0.65)
        .multilineTextAlignment(.trailing)
    }
    private func duration(_ seconds: TimeInterval) -> String {
        let total = Int(seconds)
        return total >= 3600
            ? String(format: "%d:%02d:%02d", total / 3600, total / 60 % 60, total % 60)
            : String(format: "%d:%02d", total / 60, total % 60)
    }
}

private struct RelayTaskCard: View {
    var state: RelayTaskAttributes.ContentState
    var stale: Bool
    private var isStale: Bool { (stale || state.state == "stale") && state.finishedAt == nil }
    private var tint: Color { taskTint(state, stale: stale) }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 7) {
                EclipseMark(color: tint, size: 19)
                Text("Relayune").font(.caption.weight(.semibold))
                Text("·").foregroundStyle(RelayPalette.secondary)
                Text(state.provider).font(.caption)
                Spacer()
                Image(systemName: symbol(state, stale: stale)).foregroundStyle(tint)
            }.foregroundStyle(RelayPalette.secondary)
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(isStale ? state.staleLabel : state.statusLabel)
                        .font(.system(size: 23, weight: .semibold, design: .rounded))
                        .foregroundStyle(RelayPalette.moon)
                        .lineLimit(1).minimumScaleFactor(0.65)
                    Text(state.title).font(.system(size: 13))
                        .foregroundStyle(RelayPalette.secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 4) {
                    TaskClock(state: state, stale: isStale)
                        .frame(maxWidth: 112).foregroundStyle(tint)
                    Text(isStale || !state.startKnown ? state.updatedLabel : state.elapsedLabel)
                        .font(.system(size: 10)).foregroundStyle(RelayPalette.secondary)
                        .lineLimit(1)
                }
            }
            HStack {
                StatusTrace(color: tint)
                Spacer()
                HStack(spacing: 5) {
                    Text(state.actionLabel).font(.system(size: 12, weight: .semibold))
                    Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .bold))
                }.foregroundStyle(tint)
            }
        }
    }
}
