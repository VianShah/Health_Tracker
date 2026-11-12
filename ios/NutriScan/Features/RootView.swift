import SwiftUI
#if canImport(NutriScanShared)
import NutriScanShared
#endif

struct RootView: View {
    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var session: SessionStore

    var body: some View {
        Group {
            if session.isSignedIn {
                MainTabView()
            } else {
                OnboardingView()
            }
        }
        .animation(.default, value: session.isSignedIn)
    }
}

struct MainTabView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        TabView(selection: $model.selectedTab) {
            TodayView()
                .tabItem { Label("Today", systemImage: "sun.max") }
                .tag(AppTab.today)
            ScanView()
                .tabItem { Label("Scan", systemImage: "camera.viewfinder") }
                .tag(AppTab.scan)
            HistoryView()
                .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }
                .tag(AppTab.history)
            InsightsView()
                .tabItem { Label("Insights", systemImage: "chart.bar.xaxis") }
                .tag(AppTab.insights)
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(AppTab.settings)
        }
    }
}
