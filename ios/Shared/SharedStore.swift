import Foundation
#if canImport(WidgetKit)
import WidgetKit
#endif

/// The App Group shared by the app and the widget extension.
/// Its ID comes from Config/Signing.xcconfig (APP_GROUP_ID) through Info.plist,
/// so nothing here needs editing when you change the bundle ID prefix.
enum AppGroup {
    static var id: String {
        (Bundle.main.object(forInfoDictionaryKey: "NutriScanAppGroupID") as? String) ?? ""
    }

    /// True when the App Group entitlement was granted at signing time.
    static var isAvailable: Bool {
        !id.isEmpty && FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id) != nil
    }

    /// Falls back to the app's own defaults so the app keeps working even if
    /// the App Group could not be provisioned (widgets then show placeholders).
    static var defaults: UserDefaults {
        if isAvailable, let d = UserDefaults(suiteName: id) { return d }
        return .standard
    }
}

/// What the widgets show. The app writes it after every refresh/sync.
struct WidgetSnapshot: Codable, Equatable {
    struct LastScan: Codable, Equatable {
        var mode: String          // PLATE / RECEIPT / MENU
        var score: Double         // 0–10
        var title: String
        var date: Date
    }

    struct DayValue: Codable, Equatable, Hashable {
        var date: Date
        var value: Double
    }

    var updatedAt: Date
    var firstName: String?
    var steps: Int?
    var stepGoal: Int
    var burnedKcal: Int?
    var eatenKcal: Int?
    var proteinG: Int?
    var mealsLogged: Int
    var lastScan: LastScan?
    var insight: String?
    var weekSteps: [DayValue]

    var netKcal: Int? {
        guard let e = eatenKcal, let b = burnedKcal else { return nil }
        return e - b
    }

    var stepProgress: Double {
        guard let s = steps, stepGoal > 0 else { return 0 }
        return min(1, Double(s) / Double(stepGoal))
    }

    static let placeholder = WidgetSnapshot(
        updatedAt: .now, firstName: "Alex", steps: 6_420, stepGoal: 8_000,
        burnedKcal: 1_980, eatenKcal: 1_450, proteinG: 62, mealsLogged: 3,
        lastScan: .init(mode: "PLATE", score: 7.8, title: "Dal, rice & salad", date: .now.addingTimeInterval(-3600)),
        insight: "You're 18% above your usual steps today.",
        weekSteps: (0..<7).map { i in
            .init(date: Calendar.current.date(byAdding: .day, value: i - 6, to: .now)!, value: Double([5200, 7400, 8100, 4300, 9050, 6900, 6420][i]))
        })

    static let empty = WidgetSnapshot(
        updatedAt: .distantPast, firstName: nil, steps: nil, stepGoal: 8_000, burnedKcal: nil,
        eatenKcal: nil, proteinG: nil, mealsLogged: 0, lastScan: nil, insight: nil, weekSteps: [])
}

/// Water tracking lives entirely on the device so the interactive widget
/// can update it without a network call.
struct Hydration: Codable, Equatable {
    var day: String     // yyyy-MM-dd (local)
    var glasses: Int
    var goal: Int

    var progress: Double { goal > 0 ? min(1, Double(glasses) / Double(goal)) : 0 }
}

enum SharedStore {
    private static let snapshotKey = "widget.snapshot.v1"
    private static let hydrationKey = "hydration.v1"
    private static let waterGoalKey = "hydration.goal"
    private static let stepGoalKey = "steps.goal"
    private static let pendingRouteKey = "pending.route"

    private static var d: UserDefaults { AppGroup.defaults }

    static func dayKey(_ date: Date = .now) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    // MARK: Snapshot

    static func loadSnapshot() -> WidgetSnapshot? {
        guard let data = d.data(forKey: snapshotKey) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    static func save(_ snapshot: WidgetSnapshot) {
        if let data = try? JSONEncoder().encode(snapshot) { d.set(data, forKey: snapshotKey) }
        reloadWidgets()
    }

    static func clearSnapshot() {
        d.removeObject(forKey: snapshotKey)
        reloadWidgets()
    }

    // MARK: Goals

    static var waterGoal: Int {
        get { let v = d.integer(forKey: waterGoalKey); return v > 0 ? v : 8 }
        set { d.set(max(1, min(30, newValue)), forKey: waterGoalKey); reloadWidgets() }
    }

    static var stepGoal: Int {
        get { let v = d.integer(forKey: stepGoalKey); return v > 0 ? v : 8_000 }
        set { d.set(max(500, min(100_000, newValue)), forKey: stepGoalKey); reloadWidgets() }
    }

    // MARK: Hydration

    static func hydration(on date: Date = .now) -> Hydration {
        let today = dayKey(date)
        if let data = d.data(forKey: hydrationKey),
           var h = try? JSONDecoder().decode(Hydration.self, from: data), h.day == today {
            h.goal = waterGoal
            return h
        }
        return Hydration(day: today, glasses: 0, goal: waterGoal)
    }

    @discardableResult
    static func addWater(_ glasses: Int) -> Hydration {
        var h = hydration()
        h.glasses = max(0, min(40, h.glasses + glasses))
        if let data = try? JSONEncoder().encode(h) { d.set(data, forKey: hydrationKey) }
        reloadWidgets()
        return h
    }

    // MARK: Routing (widget/control/shortcut → app)

    /// A screen the app should open the next time it becomes active,
    /// e.g. "scan/plate". Set by intents that open the app.
    static var pendingRoute: String? {
        get { d.string(forKey: pendingRouteKey) }
        set { if let v = newValue { d.set(v, forKey: pendingRouteKey) } else { d.removeObject(forKey: pendingRouteKey) } }
    }

    static func reloadWidgets() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }
}
