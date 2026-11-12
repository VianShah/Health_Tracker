import AppIntents

/// Uploads recent Apple Health data. Runs in the background without opening the app.
struct SyncHealthIntent: AppIntent {
    static var title: LocalizedStringResource = "Sync Apple Health"
    static var description = IntentDescription("Sends the last few days of Apple Health data to NutriScan and refreshes widgets.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let model = AppModel.shared
        guard model.session.isSignedIn else {
            return .result(dialog: "Open NutriScan and sign in first.")
        }
        guard model.health.isEnabled else {
            return .result(dialog: "Connect Apple Health in NutriScan first.")
        }
        try await model.health.sync(days: 3)
        if let s = try? await model.api.healthSummary(days: 7) { model.summary = s }
        await model.updateWidgetSnapshot()
        return .result(dialog: "Apple Health synced.")
    }
}

/// Phrases Siri and Spotlight offer automatically — no setup by the user.
struct NutriScanShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OpenScanIntent(),
            phrases: [
                "Scan a meal with \(.applicationName)",
                "Scan with \(.applicationName)",
                "Scan a \(\.$mode) with \(.applicationName)",
            ],
            shortTitle: "Scan",
            systemImageName: "camera.viewfinder")
        AppShortcut(
            intent: LogWaterIntent(),
            phrases: [
                "Log water in \(.applicationName)",
                "Add a glass of water in \(.applicationName)",
            ],
            shortTitle: "Log Water",
            systemImageName: "drop.fill")
        AppShortcut(
            intent: TodaySummaryIntent(),
            phrases: [
                "\(.applicationName) summary",
                "How am I doing in \(.applicationName)",
            ],
            shortTitle: "Today's Summary",
            systemImageName: "chart.pie")
        AppShortcut(
            intent: SyncHealthIntent(),
            phrases: ["Sync \(.applicationName) health"],
            shortTitle: "Sync Health",
            systemImageName: "heart.fill")
    }

    static var shortcutTileColor: ShortcutTileColor = .teal
}
