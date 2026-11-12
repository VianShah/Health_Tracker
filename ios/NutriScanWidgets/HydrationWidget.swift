import AppIntents
import SwiftUI
import WidgetKit

/// Interactive (iOS 17+): the + / − buttons run LogWaterIntent in place.
struct HydrationWidget: Widget {
    let kind = "NutriScanWater"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NutriProvider()) { entry in
            HydrationWidgetView(entry: entry)
        }
        .configurationDisplayName("Water")
        .description("Tap + to log a glass without opening the app.")
        .supportedFamilies([.systemSmall, .accessoryCircular])
    }
}

struct HydrationWidgetView: View {
    @Environment(\.widgetFamily) private var family
    var entry: NutriEntry
    private var h: Hydration { entry.hydration }

    var body: some View {
        Group {
            if family == .accessoryCircular {
                Gauge(value: h.progress) {
                    Image(systemName: "drop.fill")
                } currentValueLabel: {
                    Text("\(h.glasses)")
                }
                .gaugeStyle(.accessoryCircular)
            } else {
                VStack(spacing: 8) {
                    HStack {
                        Image(systemName: "drop.fill").foregroundStyle(WTheme.water)
                        Text("Water").font(.caption.weight(.bold))
                        Spacer()
                    }
                    RingView(progress: h.progress, color: WTheme.water, lineWidth: 8) {
                        VStack(spacing: 0) {
                            Text("\(h.glasses)").font(.system(.title2, design: .rounded).weight(.bold))
                                .contentTransition(.numericText())
                            Text("of \(h.goal)").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    .frame(width: 70, height: 70)
                    HStack {
                        Button(intent: LogWaterIntent(glasses: -1)) {
                            Image(systemName: "minus").frame(maxWidth: .infinity)
                        }
                        .disabled(h.glasses == 0)
                        Button(intent: LogWaterIntent(glasses: 1)) {
                            Image(systemName: "plus").frame(maxWidth: .infinity)
                        }
                        .tint(WTheme.water)
                    }
                    .font(.caption.weight(.bold))
                }
            }
        }
        .containerBackground(for: .widget) {
            if family == .accessoryCircular { AccessoryWidgetBackground() } else { Color(.systemBackground) }
        }
    }
}
