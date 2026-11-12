import Foundation
import SwiftUI
import BackgroundTasks

enum AppTab: Hashable { case today, scan, history, insights, settings }

/// Holds app-wide state and coordinates refreshes, routing and the widget snapshot.
@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()

    let session: SessionStore
    let api: APIClient
    let health: HealthSync
    let profile: ProfileStore

    @Published var clientConfig: ClientConfig?
    @Published var summary: HealthSummary?
    @Published var history: [ScanResult] = []
    @Published var habits: ShoppingHabits?
    @Published var isRefreshing = false
    @Published var lastError: String?

    @Published var selectedTab: AppTab = .today
    /// Set to open the scanner preset to a mode (from a widget, control, shortcut or notification).
    @Published var requestedScanMode: ScanModeOption?

    static var backgroundTaskID: String { (Bundle.main.bundleIdentifier ?? "nutriscan") + ".refresh" }

    private init() {
        session = SessionStore()
        api = APIClient(session: session)
        health = HealthSync(api: api)
        profile = ProfileStore()

        NotificationCenter.default.addObserver(forName: .nutriScanOpenRoute, object: nil, queue: .main) { note in
            guard let route = note.object as? String else { return }
            Task { @MainActor in AppModel.shared.consumePendingRoute(fallback: route) }
        }
    }

    // MARK: - Lifecycle

    func bootstrap() async {
        if clientConfig == nil { clientConfig = try? await api.clientConfig() }
        guard session.isSignedIn else { return }
        if let me = try? await api.me(), let account = me.account { session.updateAccount(account) }
        await refreshAll()
    }

    func refreshAll() async {
        guard session.isSignedIn, !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        if health.isEnabled { try? await health.sync(days: 3) }

        async let s = try? api.healthSummary(days: 7)
        async let h = try? api.history()
        async let sh = try? api.shoppingHabits()
        let (summary, history, habits) = await (s, h, sh)

        if let summary { self.summary = summary }
        if let history { self.history = history; lastError = nil } else if self.history.isEmpty {
            lastError = "Couldn't load your data. Pull to retry."
        }
        if let habits { self.habits = habits }
        await updateWidgetSnapshot()
    }

    /// Called from the scene's background app-refresh task.
    func backgroundRefresh() async {
        scheduleBackgroundRefresh()
        guard session.isSignedIn else { return }
        if health.isEnabled { try? await health.sync(days: 2) }
        if let s = try? await api.healthSummary(days: 7) { summary = s }
        await updateWidgetSnapshot()
    }

    func scheduleBackgroundRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: Self.backgroundTaskID)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    func didFinishScan(_ result: ScanResult) {
        history.removeAll { $0.id == result.id }
        history.insert(result, at: 0)
        Task {
            // The server saves in the background right after responding.
            try? await Task.sleep(for: .seconds(2))
            if let s = try? await api.healthSummary(days: 7) { summary = s }
            if result.scanMode == .receipt, let h = try? await api.shoppingHabits() { habits = h }
            await updateWidgetSnapshot()
        }
    }

    func signOut() async {
        await health.disconnect()
        health.reset()
        await api.signOut()
        profile.clearBN()
        summary = nil
        history = []
        habits = nil
        selectedTab = .today
        SharedStore.clearSnapshot()
    }

    // MARK: - Routing

    func handle(_ link: DeepLink) {
        switch link {
        case .scan(let mode):
            selectedTab = .scan
            requestedScanMode = mode
        case .today: selectedTab = .today
        case .history: selectedTab = .history
        case .insights: selectedTab = .insights
        case .settings: selectedTab = .settings
        }
    }

    func consumePendingRoute(fallback: String? = nil) {
        let route = SharedStore.pendingRoute ?? fallback
        SharedStore.pendingRoute = nil
        if let route, let link = DeepLink(route: route) { handle(link) }
    }

    // MARK: - Widgets

    func updateWidgetSnapshot() async {
        guard session.isSignedIn else { return }
        let today = summary?.today
        let todayKey = APIDate.dayKey(.now)
        let isToday = today?.date == todayKey

        var steps = isToday ? today?.health?.steps.map { Int($0) } : nil
        if health.isEnabled, let local = await HealthKitManager.shared.todaySteps() {
            steps = max(steps ?? 0, Int(local))
        }

        // Prefer server totals; fall back to today's scans in history.
        let todaysMeals = history.filter { $0.scanMode == .plate && Calendar.current.isDateInToday($0.date) }
        let localEaten = todaysMeals.reduce(0.0) { $0 + $1.computedMacros.kcal }
        let localProtein = todaysMeals.reduce(0.0) { $0 + ($1.computedMacros.protein ?? 0) }
        let eaten = isToday ? today?.eaten : nil

        let last = history.first.map {
            WidgetSnapshot.LastScan(mode: $0.mode, score: $0.healthScore, title: $0.title, date: $0.date)
        }

        let week: [WidgetSnapshot.DayValue] = (summary?.days ?? []).compactMap { d in
            guard let s = d.health?.steps else { return nil }
            return .init(date: d.day, value: s)
        }

        let snapshot = WidgetSnapshot(
            updatedAt: .now,
            firstName: session.session?.firstName,
            steps: steps,
            stepGoal: SharedStore.stepGoal,
            burnedKcal: isToday ? today?.burnedKcal.map { Int($0) } : nil,
            eatenKcal: eaten.map { Int($0.kcal) } ?? (todaysMeals.isEmpty ? nil : Int(localEaten)),
            proteinG: eaten.map { Int($0.protein) } ?? (todaysMeals.isEmpty ? nil : Int(localProtein)),
            mealsLogged: eaten?.meals ?? todaysMeals.count,
            lastScan: last,
            insight: summary?.insights.first?.text,
            weekSteps: week)
        SharedStore.save(snapshot)
    }
}
