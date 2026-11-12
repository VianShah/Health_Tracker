import AppIntents
import SwiftUI
import WidgetKit
#if canImport(NutriScanShared)
import NutriScanShared
#endif

/// Control Center / Lock Screen / Action button controls (iOS 18+).

@available(iOS 18.0, *)
struct ScanMealControl: ControlWidget {
    static let kind = "NutriScanScanMealControl"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenScanIntent(mode: .plate)) {
                Label("Scan Meal", systemImage: "camera.viewfinder")
            }
        }
        .displayName("Scan Meal")
        .description("Open NutriScan's camera to log a meal.")
    }
}

@available(iOS 18.0, *)
struct LogWaterControl: ControlWidget {
    static let kind = "NutriScanLogWaterControl"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: LogWaterIntent(glasses: 1)) {
                Label("Log Water", systemImage: "drop.fill")
            }
        }
        .displayName("Log Water")
        .description("Add a glass of water to today's total.")
    }
}
