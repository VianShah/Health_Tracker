import SwiftUI
import WidgetKit
#if canImport(NutriScanShared)
import NutriScanShared
#endif

@main
struct NutriScanWidgetsBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        HydrationWidget()
        QuickScanWidget()
        #if !XTOOL
        // Controls run App Intents, which need metadata only Xcode generates.
        if #available(iOS 18.0, *) {
            ScanMealControl()
            LogWaterControl()
        }
        #endif
    }
}
