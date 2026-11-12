import AppIntents
import Foundation
#if canImport(WidgetKit)
import WidgetKit
#endif

/// The three things NutriScan can analyse. Matches the API's `scanMode` values.
public enum ScanModeOption: String, AppEnum, CaseIterable, Codable, Identifiable {
    case plate, receipt, menu

    public var id: String { rawValue }

    /// Value sent to POST /api/v1/analyze.
    public var apiValue: String { rawValue.uppercased() }

    public var title: String {
        switch self {
        case .plate: return "Log Meal"
        case .receipt: return "Receipt"
        case .menu: return "Menu"
        }
    }

    public var symbol: String {
        switch self {
        case .plate: return "fork.knife"
        case .receipt: return "receipt"
        case .menu: return "menucard"
        }
    }

    public var blurb: String {
        switch self {
        case .plate: return "Photograph your plate for portions and macros."
        case .receipt: return "Audit a grocery bill and get healthier swaps."
        case .menu: return "Find the 5 best dishes on a restaurant menu."
        }
    }

    public static var typeDisplayRepresentation: TypeDisplayRepresentation = "Scan Type"
    public static var caseDisplayRepresentations: [ScanModeOption: DisplayRepresentation] = [
        .plate: DisplayRepresentation(title: "Meal", image: .init(systemName: "fork.knife")),
        .receipt: DisplayRepresentation(title: "Receipt", image: .init(systemName: "receipt")),
        .menu: DisplayRepresentation(title: "Menu", image: .init(systemName: "menucard")),
    ]
}

extension Notification.Name {
    /// Posted when an intent asks the running app to open a screen.
    public static let nutriScanOpenRoute = Notification.Name("NutriScanOpenRoute")
}

/// Opens the app on the scanner. Used by Shortcuts/Siri, the Action button,
/// the Control Center control and the Quick Scan widget.
public struct OpenScanIntent: AppIntent {
    public static var title: LocalizedStringResource = "Scan with NutriScan"
    public static var description = IntentDescription("Opens NutriScan's camera to scan a meal, receipt or menu.")
    public static var openAppWhenRun: Bool = true

    @Parameter(title: "Scan Type", default: .plate)
    public var mode: ScanModeOption

    public init() {}
    public init(mode: ScanModeOption) { self.mode = mode }

    public static var parameterSummary: some ParameterSummary {
        Summary("Scan a \(\.$mode)")
    }

    @MainActor
    public func perform() async throws -> some IntentResult {
        let route = DeepLink.scan(mode).route
        SharedStore.pendingRoute = route
        NotificationCenter.default.post(name: .nutriScanOpenRoute, object: route)
        return .result()
    }
}

/// Adds (or removes, with a negative number) glasses of water.
/// Runs without opening the app, so it powers the interactive widget buttons.
public struct LogWaterIntent: AppIntent {
    public static var title: LocalizedStringResource = "Log Water"
    public static var description = IntentDescription("Adds glasses of water to today's total in NutriScan.")

    @Parameter(title: "Glasses", default: 1)
    public var glasses: Int

    public init() {}
    public init(glasses: Int) { self.glasses = glasses }

    public static var parameterSummary: some ParameterSummary {
        Summary("Log \(\.$glasses) glass(es) of water")
    }

    public func perform() async throws -> some IntentResult & ReturnsValue<Int> & ProvidesDialog {
        let h = SharedStore.addWater(max(-10, min(10, glasses)))
        let left = max(0, h.goal - h.glasses)
        let text = left == 0
            ? "\(h.glasses) glasses today. Goal reached!"
            : "\(h.glasses) of \(h.goal) glasses today. \(left) to go."
        return .result(value: h.glasses, dialog: IntentDialog(stringLiteral: text))
    }
}

/// Reads today's numbers from the last snapshot. Handy for Siri: "NutriScan summary".
public struct TodaySummaryIntent: AppIntent {
    public static var title: LocalizedStringResource = "Today's Nutrition Summary"
    public static var description = IntentDescription("Tells you today's calories eaten and burned, steps and water.")

    public init() {}

    public func perform() async throws -> some IntentResult & ProvidesDialog {
        let s = SharedStore.loadSnapshot() ?? .empty
        let water = SharedStore.hydration()
        var parts: [String] = []
        if let e = s.eatenKcal { parts.append("\(e) kcal eaten over \(s.mealsLogged) meal\(s.mealsLogged == 1 ? "" : "s")") }
        if let b = s.burnedKcal { parts.append("\(b) kcal burned") }
        if let st = s.steps { parts.append("\(st.formatted()) steps") }
        parts.append("\(water.glasses) of \(water.goal) glasses of water")
        return .result(dialog: IntentDialog(stringLiteral: "Today: " + parts.joined(separator: ", ") + "."))
    }
}
