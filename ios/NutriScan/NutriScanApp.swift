import SwiftUI

@main
struct NutriScanApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = AppModel.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .environmentObject(model.session)
                .environmentObject(model.health)
                .environmentObject(model.profile)
                .environmentObject(NotificationManager.shared)
                .tint(Theme.brand)
                .onOpenURL { url in
                    if let link = DeepLink(url: url) { model.handle(link) }
                }
                .task { await model.bootstrap() }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                model.consumePendingRoute()
                Task { await model.refreshAll() }
            case .background:
                model.scheduleBackgroundRefresh()
            default: break
            }
        }
        .backgroundTask(.appRefresh(AppModel.backgroundTaskID)) {
            await AppModel.shared.backgroundRefresh()
        }
    }
}
