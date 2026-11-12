import UIKit
import UserNotifications

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        Task { @MainActor in NotificationManager.shared.registerCategories() }
        return true
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        if response.actionIdentifier == NotificationManager.waterAction {
            SharedStore.addWater(1)
            return
        }
        let route = response.actionIdentifier == NotificationManager.scanAction
            ? DeepLink.scan(.plate).route
            : response.notification.request.content.userInfo["route"] as? String
        if let route {
            await MainActor.run {
                SharedStore.pendingRoute = route
                AppModel.shared.consumePendingRoute()
            }
        }
    }
}
