import SwiftUI
import WidgetKit

@main
struct NutriScanWidgetsBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        HydrationWidget()
        QuickScanWidget()
        if #available(iOS 18.0, *) {
            ScanMealControl()
            LogWaterControl()
        }
    }
}
