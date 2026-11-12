import Foundation
#if canImport(NutriScanShared)
import NutriScanShared
#endif

/// Values baked in from Config/Signing.xcconfig, plus the server URL override
/// a user can set in Settings without rebuilding.
enum AppConfig {
    private static func info(_ key: String) -> String? {
        guard let v = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let t = v.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty || t.contains("$(") ? nil : t
    }

    private static let serverOverrideKey = "server.baseURL"

    static var bundledBaseURL: String { info("NutriScanAPIBaseURL") ?? "http://localhost:3002" }

    /// Root of the API, without a trailing slash (e.g. https://host).
    static var baseURLString: String {
        get { UserDefaults.standard.string(forKey: serverOverrideKey) ?? bundledBaseURL }
        set {
            let t = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
                .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            if t.isEmpty || t == bundledBaseURL { UserDefaults.standard.removeObject(forKey: serverOverrideKey) }
            else { UserDefaults.standard.set(t, forKey: serverOverrideKey) }
        }
    }

    static var apiRoot: URL {
        let base = baseURLString.hasSuffix("/") ? String(baseURLString.dropLast()) : baseURLString
        return URL(string: base + "/api/v1") ?? URL(string: "http://localhost:3002/api/v1")!
    }

    static var googleClientID: String? {
        guard let id = info("NutriScanGoogleClientID"), id.hasSuffix(".apps.googleusercontent.com") else { return nil }
        return id
    }

    static var googleRedirectScheme: String? {
        guard let s = info("NutriScanGoogleReversedClientID"), !s.hasSuffix(".unset") else { return nil }
        return s
    }

    static var isGoogleConfigured: Bool { googleClientID != nil && googleRedirectScheme != nil }

    static var appVersion: String {
        let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let b = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return "\(v) (\(b))"
    }

    /// BN (Balance Nutrition) public API used by the web app to read a linked client's profile.
    static let bnAPIBase = URL(string: "https://bn-new-api.balancenutritiononline.com/api/v1")!
}
