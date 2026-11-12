import Foundation
import UserNotifications
#if canImport(NutriScanShared)
import NutriScanShared
#endif

/// Local reminders (no push server needed — works with a free Apple ID).
@MainActor
final class NotificationManager: ObservableObject {
    static let shared = NotificationManager()

    struct Reminder: Codable, Identifiable, Equatable {
        var id: String
        var title: String
        var hour: Int
        var minute: Int
        var enabled: Bool
    }

    private static let mealKey = "reminders.meals.v1"
    private static let waterKey = "reminders.water.v1"

    @Published var mealReminders: [Reminder] {
        didSet { persist(); Task { await reschedule() } }
    }
    @Published var waterReminders: Bool {
        didSet { UserDefaults.standard.set(waterReminders, forKey: Self.waterKey); Task { await reschedule() } }
    }
    @Published private(set) var authorized = false

    private init() {
        if let d = UserDefaults.standard.data(forKey: Self.mealKey),
           let r = try? JSONDecoder().decode([Reminder].self, from: d) {
            mealReminders = r
        } else {
            mealReminders = [
                .init(id: "breakfast", title: "Breakfast", hour: 8, minute: 30, enabled: false),
                .init(id: "lunch", title: "Lunch", hour: 13, minute: 15, enabled: false),
                .init(id: "snack", title: "Evening snack", hour: 17, minute: 0, enabled: false),
                .init(id: "dinner", title: "Dinner", hour: 20, minute: 15, enabled: false),
            ]
        }
        waterReminders = UserDefaults.standard.bool(forKey: Self.waterKey)
    }

    private func persist() {
        if let d = try? JSONEncoder().encode(mealReminders) { UserDefaults.standard.set(d, forKey: Self.mealKey) }
    }

    func refreshAuthorization() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorized = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
    }

    @discardableResult
    func requestAuthorization() async -> Bool {
        let ok = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        authorized = ok
        if ok { registerCategories() }
        return ok
    }

    static let scanAction = "SCAN_NOW"
    static let waterAction = "LOG_WATER"

    func registerCategories() {
        let scan = UNNotificationAction(identifier: Self.scanAction, title: "Scan meal", options: [.foreground])
        let water = UNNotificationAction(identifier: Self.waterAction, title: "+1 glass", options: [])
        UNUserNotificationCenter.current().setNotificationCategories([
            UNNotificationCategory(identifier: "MEAL", actions: [scan], intentIdentifiers: []),
            UNNotificationCategory(identifier: "WATER", actions: [water], intentIdentifiers: []),
        ])
    }

    func reschedule() async {
        let center = UNUserNotificationCenter.current()
        center.removeAllPendingNotificationRequests()
        let anyOn = waterReminders || mealReminders.contains(where: \.enabled)
        guard anyOn else { return }
        if !authorized { guard await requestAuthorization() else { return } }

        for r in mealReminders where r.enabled {
            let content = UNMutableNotificationContent()
            content.title = "Time to log \(r.title.lowercased())"
            content.body = "Snap your plate and NutriScan will check it against your goals."
            content.sound = .default
            content.categoryIdentifier = "MEAL"
            content.userInfo = ["route": DeepLink.scan(.plate).route]
            let trigger = UNCalendarNotificationTrigger(dateMatching: DateComponents(hour: r.hour, minute: r.minute), repeats: true)
            try? await center.add(UNNotificationRequest(identifier: "meal.\(r.id)", content: content, trigger: trigger))
        }

        if waterReminders {
            for hour in stride(from: 10, through: 20, by: 2) {
                let content = UNMutableNotificationContent()
                content.title = "Water check"
                content.body = "Had a glass recently? Tap +1 to log it."
                content.sound = .default
                content.categoryIdentifier = "WATER"
                content.userInfo = ["route": DeepLink.today.route]
                let trigger = UNCalendarNotificationTrigger(dateMatching: DateComponents(hour: hour, minute: 0), repeats: true)
                try? await center.add(UNNotificationRequest(identifier: "water.\(hour)", content: content, trigger: trigger))
            }
        }
    }
}
