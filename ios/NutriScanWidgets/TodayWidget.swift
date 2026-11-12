import AppIntents
import Charts
import SwiftUI
import WidgetKit

struct TodayWidget: Widget {
    let kind = "NutriScanToday"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NutriProvider()) { entry in
            TodayWidgetView(entry: entry)
                .widgetURL(DeepLink.today.url)
        }
        .configurationDisplayName("Today")
        .description("Calories eaten vs burned, steps and your last scan.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge,
                            .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct TodayWidgetView: View {
    @Environment(\.widgetFamily) private var family
    var entry: NutriEntry
    private var s: WidgetSnapshot { entry.snapshot }

    var body: some View {
        Group {
            switch family {
            case .accessoryCircular: circular
            case .accessoryRectangular: rectangular
            case .accessoryInline: inline
            case .systemMedium: entry.hasData ? AnyView(medium) : AnyView(SignedOutView())
            case .systemLarge: entry.hasData ? AnyView(large) : AnyView(SignedOutView())
            default: entry.hasData ? AnyView(small) : AnyView(SignedOutView())
            }
        }
        .containerBackground(for: .widget) {
            if family == .accessoryCircular { AccessoryWidgetBackground() } else { Color(.systemBackground) }
        }
    }

    // MARK: Lock Screen

    private var circular: some View {
        Gauge(value: s.stepProgress) {
            Image(systemName: "figure.walk")
        } currentValueLabel: {
            Text(s.steps.map { $0 >= 1000 ? String(format: "%.1fk", Double($0) / 1000) : "\($0)" } ?? "—")
        }
        .gaugeStyle(.accessoryCircular)
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            Label("NutriScan", systemImage: "leaf.fill").font(.caption2.weight(.semibold)).widgetAccentable()
            Text("\(s.eatenKcal.widgetText) in · \(s.burnedKcal.widgetText) out")
                .font(.caption).monospacedDigit()
            HStack(spacing: 4) {
                Image(systemName: "figure.walk")
                Text(s.steps.widgetText).monospacedDigit()
                if let last = s.lastScan {
                    Text("· score \(String(format: "%.1f", last.score))")
                }
            }
            .font(.caption2)
        }
    }

    private var inline: some View {
        Text("\(s.eatenKcal.widgetText) kcal · \(s.steps.widgetText) steps")
    }

    // MARK: Home Screen

    private var header: some View {
        HStack(spacing: 4) {
            Image(systemName: "leaf.fill").foregroundStyle(WTheme.brand)
            Text("Today").font(.caption.weight(.bold))
            Spacer()
            if s.mealsLogged > 0 {
                Text("\(s.mealsLogged) meal\(s.mealsLogged == 1 ? "" : "s")").font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    private var energyRing: some View {
        let ratio = (s.burnedKcal ?? 0) > 0 ? Double(s.eatenKcal ?? 0) / Double(s.burnedKcal!) : 0
        return RingView(progress: ratio, color: WTheme.eaten, lineWidth: 8) {
            VStack(spacing: 0) {
                Text(s.eatenKcal.widgetText).font(.system(.headline, design: .rounded).weight(.bold)).monospacedDigit()
                    .minimumScaleFactor(0.6)
                Text("kcal in").font(.system(size: 9)).foregroundStyle(.secondary)
            }
        }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            HStack {
                energyRing.frame(width: 70, height: 70)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Image(systemName: "flame.fill").foregroundStyle(WTheme.burned)
                    Text("\(s.burnedKcal.widgetText) burned").monospacedDigit()
                }
                HStack(spacing: 4) {
                    Image(systemName: "figure.walk").foregroundStyle(WTheme.steps)
                    Text("\(s.steps.widgetText) steps").monospacedDigit()
                }
            }
            .font(.caption2)
        }
    }

    private var stats: some View {
        VStack(alignment: .leading, spacing: 6) {
            stat("flame.fill", WTheme.burned, "Burned", "\(s.burnedKcal.widgetText) kcal")
            stat("figure.walk", WTheme.steps, "Steps", s.steps.widgetText)
            stat("bolt.fill", .purple, "Protein", s.proteinG.map { "\($0) g" } ?? "—")
            stat("drop.fill", WTheme.water, "Water", "\(entry.hydration.glasses)/\(entry.hydration.goal)")
        }
    }

    private func stat(_ symbol: String, _ color: Color, _ title: String, _ value: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).foregroundStyle(color).frame(width: 14)
            Text(title).foregroundStyle(.secondary)
            Spacer(minLength: 4)
            Text(value).fontWeight(.semibold).monospacedDigit()
        }
        .font(.caption)
    }

    private var medium: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            HStack(spacing: 14) {
                energyRing.frame(width: 84, height: 84)
                stats
            }
            if let last = s.lastScan { lastScanRow(last) }
        }
    }

    private func lastScanRow(_ last: WidgetSnapshot.LastScan) -> some View {
        HStack(spacing: 6) {
            Text(String(format: "%.1f", last.score))
                .font(.caption2.weight(.bold)).foregroundStyle(.white)
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(WTheme.score(last.score), in: Capsule())
            Text(last.title).font(.caption2).lineLimit(1)
            Spacer(minLength: 0)
            Text(last.date, style: .relative).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
        }
    }

    private var large: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            HStack(spacing: 14) {
                energyRing.frame(width: 96, height: 96)
                stats
            }
            if !s.weekSteps.isEmpty {
                Text("Steps this week").font(.caption.weight(.semibold))
                Chart(s.weekSteps, id: \.date) { d in
                    BarMark(x: .value("Day", d.date, unit: .day), y: .value("Steps", d.value))
                        .foregroundStyle(d.value >= Double(s.stepGoal) ? WTheme.steps : WTheme.steps.opacity(0.45))
                        .cornerRadius(2)
                }
                .chartXAxis { AxisMarks(values: .stride(by: .day)) { _ in AxisValueLabel(format: .dateTime.weekday(.narrow)) } }
                .chartYAxis(.hidden)
                .frame(maxHeight: 70)
            }
            if let insight = s.insight {
                Label(insight, systemImage: "lightbulb.fill").font(.caption).lineLimit(2)
            }
            Spacer(minLength: 0)
            if let last = s.lastScan { lastScanRow(last) }
            HStack {
                Button(intent: LogWaterIntent(glasses: 1)) {
                    Label("Water", systemImage: "drop.fill").font(.caption.weight(.semibold))
                }
                .tint(WTheme.water)
                Spacer()
                Link(destination: DeepLink.scan(.plate).url) {
                    Label("Scan meal", systemImage: "camera.fill")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(WTheme.brand, in: Capsule())
                        .foregroundStyle(.white)
                }
            }
        }
    }
}
