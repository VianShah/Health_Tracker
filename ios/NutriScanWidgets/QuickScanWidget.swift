import AppIntents
import SwiftUI
import WidgetKit

struct QuickScanWidget: Widget {
    let kind = "NutriScanQuickScan"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NutriProvider()) { entry in
            QuickScanView(entry: entry)
        }
        .configurationDisplayName("Quick Scan")
        .description("Jump straight to the camera for a meal, receipt or menu.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct QuickScanView: View {
    @Environment(\.widgetFamily) private var family
    var entry: NutriEntry

    var body: some View {
        Group {
            if family == .systemMedium {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Image(systemName: "leaf.fill").foregroundStyle(WTheme.brand)
                        Text("Scan").font(.caption.weight(.bold))
                        Spacer()
                        if let last = entry.snapshot.lastScan {
                            Text("Last: \(String(format: "%.1f", last.score))").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    HStack(spacing: 8) {
                        ForEach(ScanModeOption.allCases) { mode in
                            Link(destination: DeepLink.scan(mode).url) {
                                VStack(spacing: 6) {
                                    Image(systemName: mode.symbol).font(.title2)
                                    Text(mode.title).font(.caption2.weight(.semibold))
                                }
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                                .background(WTheme.brand.opacity(0.14), in: RoundedRectangle(cornerRadius: 14))
                                .foregroundStyle(WTheme.brand)
                            }
                        }
                    }
                }
            } else {
                VStack(spacing: 6) {
                    ForEach(ScanModeOption.allCases) { mode in
                        // Small widgets ignore Link; an intent button routes correctly.
                        Button(intent: OpenScanIntent(mode: mode)) {
                            HStack {
                                Image(systemName: mode.symbol).frame(width: 20)
                                Text(mode.title).font(.caption.weight(.semibold))
                                Spacer()
                            }
                            .padding(.horizontal, 10)
                            .frame(maxHeight: .infinity)
                            .background(WTheme.brand.opacity(0.14), in: RoundedRectangle(cornerRadius: 10))
                            .foregroundStyle(WTheme.brand)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .containerBackground(for: .widget) { Color(.systemBackground) }
    }
}
