import SwiftUI
import WidgetKit
#if canImport(NutriScanShared)
import NutriScanShared
#endif

struct NutriEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
    let hydration: Hydration
    /// False until the app has written a snapshot (not signed in / never opened).
    let hasData: Bool
}

/// All widgets read the snapshot the app saves in the App Group.
struct NutriProvider: TimelineProvider {
    func placeholder(in context: Context) -> NutriEntry {
        NutriEntry(date: .now, snapshot: .placeholder, hydration: Hydration(day: "", glasses: 5, goal: 8), hasData: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (NutriEntry) -> Void) {
        completion(context.isPreview && SharedStore.loadSnapshot() == nil ? placeholder(in: context) : entry(at: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NutriEntry>) -> Void) {
        let now = Date.now
        var entries = [entry(at: now)]
        // At midnight, roll over to an empty day (water resets, meals clear).
        if let midnight = Calendar.current.nextDate(after: now, matching: DateComponents(hour: 0, minute: 0), matchingPolicy: .nextTime) {
            entries.append(entry(at: midnight.addingTimeInterval(5)))
        }
        // The app pushes reloads on changes; this is only a safety net.
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(30 * 60))))
    }

    private func entry(at date: Date) -> NutriEntry {
        let stored = SharedStore.loadSnapshot()
        var snap = stored ?? .empty
        if !Calendar.current.isDate(snap.updatedAt, inSameDayAs: date) {
            // Yesterday's numbers shouldn't show as today's.
            snap.steps = nil
            snap.eatenKcal = nil
            snap.burnedKcal = nil
            snap.proteinG = nil
            snap.mealsLogged = 0
            snap.insight = nil
        }
        snap.stepGoal = SharedStore.stepGoal
        return NutriEntry(date: date, snapshot: snap, hydration: SharedStore.hydration(on: date), hasData: stored != nil)
    }
}

enum WTheme {
    static let brand = Color(red: 0.082, green: 0.718, blue: 0.616) // #15B79D (no asset catalog needed for xtool)
    static let eaten = Color(red: 0.98, green: 0.52, blue: 0.20)
    static let burned = Color(red: 0.20, green: 0.55, blue: 0.95)
    static let steps = Color(red: 0.08, green: 0.72, blue: 0.48)
    static let water = Color(red: 0.16, green: 0.66, blue: 0.96)

    static func score(_ s: Double) -> Color {
        s >= 7 ? Color(red: 0.08, green: 0.72, blue: 0.48) : s >= 4.5 ? Color(red: 0.96, green: 0.65, blue: 0.14) : Color(red: 0.91, green: 0.30, blue: 0.24)
    }
}

extension Optional where Wrapped == Int {
    var widgetText: String { self.map { $0.formatted() } ?? "—" }
}

/// Ring with a label in the middle.
struct RingView<Center: View>: View {
    var progress: Double
    var color: Color
    var lineWidth: CGFloat = 7
    @ViewBuilder var center: () -> Center

    var body: some View {
        ZStack {
            Circle().stroke(color.opacity(0.2), lineWidth: lineWidth)
            Circle().trim(from: 0, to: max(0.001, min(1, progress)))
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            center()
        }
    }
}

struct SignedOutView: View {
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "leaf.circle.fill").font(.title).foregroundStyle(WTheme.brand)
            Text("Open NutriScan to get started").font(.caption).multilineTextAlignment(.center).foregroundStyle(.secondary)
        }
    }
}
