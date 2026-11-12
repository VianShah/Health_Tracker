import Foundation

/// URLs the widgets, notifications and controls use to open a screen:
///   nutriscan://scan?mode=plate|receipt|menu
///   nutriscan://today   nutriscan://history   nutriscan://insights   nutriscan://settings
///   nutriscan://water?add=1   (adds a glass, then shows Today — widget fallback when
///                              App Intents buttons aren't available, e.g. xtool builds)
public enum DeepLink: Equatable {
    case scan(ScanModeOption)
    case addWater(Int)
    case today
    case history
    case insights
    case settings

    public static let scheme = "nutriscan"

    public var url: URL {
        switch self {
        case .scan(let mode): return URL(string: "\(Self.scheme)://scan?mode=\(mode.rawValue)")!
        case .today: return URL(string: "\(Self.scheme)://today")!
        case .history: return URL(string: "\(Self.scheme)://history")!
        case .insights: return URL(string: "\(Self.scheme)://insights")!
        case .settings: return URL(string: "\(Self.scheme)://settings")!
        case .addWater(let n): return URL(string: "\(Self.scheme)://water?add=\(n)")!
        }
    }

    /// Compact form stored in `SharedStore.pendingRoute`.
    public var route: String {
        if case .scan(let mode) = self { return "scan/\(mode.rawValue)" }
        if case .addWater(let n) = self { return "water/\(n)" }
        return url.host ?? "today"
    }

    public init?(url: URL) {
        guard url.scheme == Self.scheme else { return nil }
        switch url.host {
        case "scan":
            let mode = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "mode" })?.value
            self = .scan(ScanModeOption(rawValue: mode ?? "") ?? .plate)
        case "today": self = .today
        case "history": self = .history
        case "insights": self = .insights
        case "settings": self = .settings
        case "water":
            let add = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "add" })?.value
            self = .addWater(Int(add ?? "1") ?? 1)
        default: return nil
        }
    }

    public init?(route: String) {
        let parts = route.split(separator: "/").map(String.init)
        guard let first = parts.first else { return nil }
        if first == "scan" {
            self = .scan(ScanModeOption(rawValue: parts.dropFirst().first ?? "") ?? .plate)
        } else if first == "water" {
            self = .addWater(Int(parts.dropFirst().first ?? "1") ?? 1)
        } else if let url = URL(string: "\(Self.scheme)://\(first)"), let link = DeepLink(url: url) {
            self = link
        } else {
            return nil
        }
    }
}
