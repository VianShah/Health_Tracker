import Foundation

/// URLs the widgets, notifications and controls use to open a screen:
///   nutriscan://scan?mode=plate|receipt|menu
///   nutriscan://today   nutriscan://history   nutriscan://insights   nutriscan://settings
enum DeepLink: Equatable {
    case scan(ScanModeOption)
    case today
    case history
    case insights
    case settings

    static let scheme = "nutriscan"

    var url: URL {
        switch self {
        case .scan(let mode): return URL(string: "\(Self.scheme)://scan?mode=\(mode.rawValue)")!
        case .today: return URL(string: "\(Self.scheme)://today")!
        case .history: return URL(string: "\(Self.scheme)://history")!
        case .insights: return URL(string: "\(Self.scheme)://insights")!
        case .settings: return URL(string: "\(Self.scheme)://settings")!
        }
    }

    /// Compact form stored in `SharedStore.pendingRoute`.
    var route: String {
        if case .scan(let mode) = self { return "scan/\(mode.rawValue)" }
        return url.host ?? "today"
    }

    init?(url: URL) {
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
        default: return nil
        }
    }

    init?(route: String) {
        let parts = route.split(separator: "/").map(String.init)
        guard let first = parts.first else { return nil }
        if first == "scan" {
            self = .scan(ScanModeOption(rawValue: parts.dropFirst().first ?? "") ?? .plate)
        } else if let url = URL(string: "\(Self.scheme)://\(first)"), let link = DeepLink(url: url) {
            self = link
        } else {
            return nil
        }
    }
}
