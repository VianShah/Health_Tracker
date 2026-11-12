import Foundation
#if canImport(WidgetKit)
import WidgetKit
#endif

/// The App Group shared by the app and the widget extension.
///
/// Its ID is always "group." + the host app's bundle ID. That works for both
/// build paths without editing code:
///   - Xcode:  bundle ID = BUNDLE_ID_PREFIX, group = group.BUNDLE_ID_PREFIX
///   - xtool:  bundle ID = XTL-ABCD.<bundleID>, group = group.XTL-ABCD.<bundleID>
///             (xtool adds the same XTL- prefix to both when signing)
public enum AppGroup {
    /// Bundle ID of the containing app, also when running inside the widget extension.
    static var hostAppBundleID: String {
        let id = Bundle.main.bundleIdentifier ?? ""
        guard Bundle.main.bundleURL.pathExtension == "appex" else { return id }
        return id.split(separator: ".").dropLast().joined(separator: ".")
    }

    public static var id: String { "group." + hostAppBundleID }

    /// True when the App Group entitlement was granted at signing time.
    public static var isAvailable: Bool {
        !hostAppBundleID.isEmpty && FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id) != nil
    }

    /// Falls back to the app's own defaults so the app keeps working even if
    /// the App Group could not be provisioned (widgets then show placeholders).
    public static var defaults: UserDefaults {
        if isAvailable, let d = UserDefaults(suiteName: id) { return d }
        return .standard
    }
}

/// What the widgets show. The app writes it after every refresh/sync.
public struct WidgetSnapshot: Codable, Equatable {
    public struct LastScan: Codable, Equatable {
        public var mode: String          // PLATE / RECEIPT / MENU
        public var score: Double         // 0–10
        public var title: String
        public var date: Date

        public init(mode: String, score: Double, title: String, date: Date) {
            self.mode = mode; self.score = score; self.title = title; self.date = date
        }
    }

    public struct DayValue: Codable, Equatable, Hashable {
        public var date: Date
        public var value: Double

        public init(date: Date, value: Double) { self.date = date; self.value = value }
    }

    public var updatedAt: Date
    public var firstName: String?
    public var steps: Int?
    public var stepGoal: Int
    public var burnedKcal: Int?
    public var eatenKcal: Int?
    public var proteinG: Int?
    public var mealsLogged: Int
    public var lastScan: LastScan?
    public var insight: String?
    public var weekSteps: [DayValue]

    public init(updatedAt: Date, firstName: String?, steps: Int?, stepGoal: Int, burnedKcal: Int?,
                eatenKcal: Int?, proteinG: Int?, mealsLogged: Int, lastScan: LastScan?,
                insight: String?, weekSteps: [DayValue]) {
        self.updatedAt = updatedAt; self.firstName = firstName; self.steps = steps; self.stepGoal = stepGoal
        self.burnedKcal = burnedKcal; self.eatenKcal = eatenKcal; self.proteinG = proteinG
        self.mealsLogged = mealsLogged; self.lastScan = lastScan; self.insight = insight; self.weekSteps = weekSteps
    }

    public var netKcal: Int? {
        guard let e = eatenKcal, let b = burnedKcal else { return nil }
        return e - b
    }

    public var stepProgress: Double {
        guard let s = steps, stepGoal > 0 else { return 0 }
        return min(1, Double(s) / Double(stepGoal))
    }

    public static let placeholder = WidgetSnapshot(
        updatedAt: .now, firstName: "Alex", steps: 6_420, stepGoal: 8_000,
        burnedKcal: 1_980, eatenKcal: 1_450, proteinG: 62, mealsLogged: 3,
        lastScan: .init(mode: "PLATE", score: 7.8, title: "Dal, rice & salad", date: .now.addingTimeInterval(-3600)),
        insight: "You're 18% above your usual steps today.",
        weekSteps: (0..<7).map { i in
            .init(date: Calendar.current.date(byAdding: .day, value: i - 6, to: .now)!, value: Double([5200, 7400, 8100, 4300, 9050, 6900, 6420][i]))
        })

    public static let empty = WidgetSnapshot(
        updatedAt: .distantPast, firstName: nil, steps: nil, stepGoal: 8_000, burnedKcal: nil,
        eatenKcal: nil, proteinG: nil, mealsLogged: 0, lastScan: nil, insight: nil, weekSteps: [])
}

/// Water tracking lives entirely on the device so the interactive widget
/// can update it without a network call.
public struct Hydration: Codable, Equatable {
    public var day: String     // yyyy-MM-dd (local)
    public var glasses: Int
    public var goal: Int

    public init(day: String, glasses: Int, goal: Int) { self.day = day; self.glasses = glasses; self.goal = goal }

    public var progress: Double { goal > 0 ? min(1, Double(glasses) / Double(goal)) : 0 }
}

public enum SharedStore {
    private static let snapshotKey = "widget.snapshot.v1"
    private static let hydrationKey = "hydration.v1"
    private static let waterGoalKey = "hydration.goal"
    private static let stepGoalKey = "steps.goal"
    private static let pendingRouteKey = "pending.route"

    private static var d: UserDefaults { AppGroup.defaults }

    public static func dayKey(_ date: Date = .now) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    // MARK: Snapshot

    public static func loadSnapshot() -> WidgetSnapshot? {
        guard let data = d.data(forKey: snapshotKey) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    public static func save(_ snapshot: WidgetSnapshot) {
        if let data = try? JSONEncoder().encode(snapshot) { d.set(data, forKey: snapshotKey) }
        reloadWidgets()
    }

    public static func clearSnapshot() {
        d.removeObject(forKey: snapshotKey)
        reloadWidgets()
    }

    // MARK: Goals

    public static var waterGoal: Int {
        get { let v = d.integer(forKey: waterGoalKey); return v > 0 ? v : 8 }
        set { d.set(max(1, min(30, newValue)), forKey: waterGoalKey); reloadWidgets() }
    }

    public static var stepGoal: Int {
        get { let v = d.integer(forKey: stepGoalKey); return v > 0 ? v : 8_000 }
        set { d.set(max(500, min(100_000, newValue)), forKey: stepGoalKey); reloadWidgets() }
    }

    // MARK: Hydration

    public static func hydration(on date: Date = .now) -> Hydration {
        let today = dayKey(date)
        if let data = d.data(forKey: hydrationKey),
           var h = try? JSONDecoder().decode(Hydration.self, from: data), h.day == today {
            h.goal = waterGoal
            return h
        }
        return Hydration(day: today, glasses: 0, goal: waterGoal)
    }

    @discardableResult
    public static func addWater(_ glasses: Int) -> Hydration {
        var h = hydration()
        h.glasses = max(0, min(40, h.glasses + glasses))
        if let data = try? JSONEncoder().encode(h) { d.set(data, forKey: hydrationKey) }
        reloadWidgets()
        return h
    }

    // MARK: Routing (widget/control/shortcut → app)

    /// A screen the app should open the next time it becomes active,
    /// e.g. "scan/plate". Set by intents that open the app.
    public static var pendingRoute: String? {
        get { d.string(forKey: pendingRouteKey) }
        set { if let v = newValue { d.set(v, forKey: pendingRouteKey) } else { d.removeObject(forKey: pendingRouteKey) } }
    }

    public static func reloadWidgets() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }
}
