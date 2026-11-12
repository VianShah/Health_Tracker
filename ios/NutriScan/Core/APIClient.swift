import Foundation
import UIKit

enum APIError: LocalizedError {
    case notSignedIn
    case sessionExpired
    case server(status: Int, message: String, code: String?)
    case network(String)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .notSignedIn: return "Please sign in first."
        case .sessionExpired: return "Your session ended. Please sign in again."
        case .server(_, let message, _): return message
        case .network(let m): return "Can't reach the NutriScan server. \(m)"
        case .decoding(let m): return "The server sent something unexpected. \(m)"
        }
    }

    var code: String? { if case .server(_, _, let c) = self { return c }; return nil }
}

/// Talks to the NutriScan API (api/index.js + api/health.js).
@MainActor
final class APIClient {
    let session: SessionStore
    private let urlSession: URLSession
    private var refreshTask: Task<Void, Error>?

    init(session: SessionStore) {
        self.session = session
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 90       // AI analysis can take a while
        config.timeoutIntervalForResource = 180
        config.waitsForConnectivity = true
        urlSession = URLSession(configuration: config)
    }

    private var deviceInfo: String {
        "NutriScan-iOS/\(AppConfig.appVersion) (\(UIDevice.current.model); iOS \(UIDevice.current.systemVersion))"
    }

    // MARK: - Core request

    private struct ErrorBody: Decodable { var error: String?; var code: String?; var details: String? }

    private func makeRequest(_ method: String, _ path: String, query: [URLQueryItem] = [],
                             body: Data? = nil, contentType: String? = "application/json",
                             bearer: String? = nil) -> URLRequest {
        var comps = URLComponents(url: AppConfig.apiRoot.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { comps.queryItems = query }
        var req = URLRequest(url: comps.url!)
        req.httpMethod = method
        req.httpBody = body
        if let contentType, body != nil { req.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let bearer { req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        return req
    }

    private func perform(_ req: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, resp) = try await urlSession.data(for: req)
            guard let http = resp as? HTTPURLResponse else { throw APIError.network("No response.") }
            return (data, http)
        } catch let e as APIError {
            throw e
        } catch {
            throw APIError.network(error.localizedDescription)
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw APIError.decoding(String(describing: error).prefix(160).description) }
    }

    private func serverError(_ data: Data, _ http: HTTPURLResponse) -> APIError {
        let body = try? JSONDecoder().decode(ErrorBody.self, from: data)
        let message = body?.error ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode).capitalized
        return .server(status: http.statusCode, message: message, code: body?.code)
    }

    /// Unauthenticated JSON call.
    func publicCall<T: Decodable>(_ method: String, _ path: String, json: [String: Any]? = nil,
                                  bearer: String? = nil, query: [URLQueryItem] = [], as type: T.Type) async throws -> T {
        let body = try json.map { try JSONSerialization.data(withJSONObject: $0) }
        let (data, http) = try await perform(makeRequest(method, path, query: query, body: body, bearer: bearer))
        guard (200..<300).contains(http.statusCode) else { throw serverError(data, http) }
        return try decode(T.self, data)
    }

    /// Authenticated call. Refreshes the access token once if it expired.
    func authed<T: Decodable>(_ method: String, _ path: String, json: [String: Any]? = nil,
                              query: [URLQueryItem] = [], rawBody: Data? = nil, contentType: String? = "application/json",
                              as type: T.Type) async throws -> T {
        let body = try rawBody ?? json.map { try JSONSerialization.data(withJSONObject: $0) }

        for attempt in 0..<2 {
            guard let token = session.session?.accessToken else { throw APIError.notSignedIn }
            let (data, http) = try await perform(makeRequest(method, path, query: query, body: body,
                                                             contentType: contentType, bearer: token))
            if (200..<300).contains(http.statusCode) { return try decode(T.self, data) }

            let err = serverError(data, http)
            let tokenProblem = http.statusCode == 401 || (http.statusCode == 403 && (err.errorDescription ?? "").contains("Invalid token"))
            if tokenProblem && attempt == 0 {
                try await refreshTokens()
                continue
            }
            throw err
        }
        throw APIError.sessionExpired
    }

    // MARK: - Tokens

    /// One refresh at a time; concurrent callers wait for the same task.
    func refreshTokens() async throws {
        if let running = refreshTask { return try await running.value }
        let task = Task { @MainActor in
            defer { self.refreshTask = nil }
            guard let s = self.session.session else { throw APIError.notSignedIn }
            do {
                let auth = try await self.publicCall("POST", "auth/refresh",
                                                     json: ["refreshToken": s.refreshToken, "userId": s.userId],
                                                     as: AuthResponse.self)
                self.session.apply(auth, keepingAccount: true)
            } catch {
                // A guest can always come back with the device secret.
                if s.isGuest, let secret = self.session.guestSecret {
                    let auth = try await self.publicCall("POST", "auth/guest", json: ["guestSecret": secret], as: AuthResponse.self)
                    self.session.apply(auth)
                    return
                }
                if case APIError.network = error { throw error }
                self.session.clear()
                throw APIError.sessionExpired
            }
        }
        refreshTask = task
        try await task.value
    }

    // MARK: - Auth endpoints

    func clientConfig() async throws -> ClientConfig {
        try await publicCall("GET", "client-config", as: ClientConfig.self)
    }

    func startGuest() async throws {
        var body: [String: Any] = [:]
        if let secret = session.guestSecret { body["guestSecret"] = secret }
        let auth = try await publicCall("POST", "auth/guest", json: body, as: AuthResponse.self)
        session.apply(auth)
    }

    /// Exchanges a Firebase ID token (from Google sign-in) for app tokens.
    /// Sends the guest secret so guest scans move into the account.
    func signIn(firebaseIdToken: String) async throws -> AuthResponse {
        var body: [String: Any] = ["idToken": firebaseIdToken, "deviceInfo": deviceInfo]
        if let secret = session.guestSecret { body["guestSecret"] = secret }
        let auth = try await publicCall("POST", "auth/firebase", json: body, as: AuthResponse.self)
        session.apply(auth)
        session.guestSecret = nil
        return auth
    }

    func me() async throws -> MeResponse {
        try await authed("GET", "auth/me", as: MeResponse.self)
    }

    func linkBN(clientId: String) async throws {
        let auth = try await authed("POST", "auth/link-bn", json: ["clientId": clientId], as: AuthResponse.self)
        session.apply(auth)
    }

    func unlinkBN() async throws {
        let auth = try await authed("POST", "auth/unlink-bn", json: [:], as: AuthResponse.self)
        session.apply(auth)
    }

    func signOut() async {
        if let s = session.session {
            _ = try? await publicCall("POST", "auth/revoke", json: ["refreshToken": s.refreshToken], as: OKResponse.self)
        }
        session.clear()
    }

    // MARK: - Scans

    /// POST /analyze (multipart). `images` must already be compressed JPEGs.
    func analyze(images: [Data], mode: ScanModeOption, profile: [String: Any], mealTime: Date,
                 mealType: String?, notes: String?) async throws -> ScanResult {
        var form = MultipartForm()
        for (i, img) in images.enumerated() {
            form.addFile(name: "images", filename: "scan\(i + 1).jpg", mimeType: "image/jpeg", data: img)
        }
        let profileJSON = (try? JSONSerialization.data(withJSONObject: profile)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        form.addField("userProfile", profileJSON)
        form.addField("scanMode", mode.apiValue)
        if let uid = session.session?.userId { form.addField("userId", uid) }
        form.addField("localTime", APIDate.iso(mealTime))
        form.addField("deviceHour", String(Calendar.current.component(.hour, from: mealTime)))
        form.addField("deviceTime", mealTime.formatted(.dateTime.year().month().day().hour().minute().second().timeZone()))
        if mode == .menu { form.addField("ask_diet", "yes") }
        if let mealType, mode == .plate { form.addField("mealType", mealType) }
        if let notes, !notes.isEmpty { form.addField("notes", notes) }

        return try await authed("POST", "analyze", rawBody: form.finalize(), contentType: form.contentType, as: ScanResult.self)
    }

    func history() async throws -> [ScanResult] {
        try await authed("GET", "results", as: HistoryResponse.self).history
    }

    func latestScan() async throws -> ScanResult? {
        do { return try await authed("GET", "results/latest", as: ScanResult.self) }
        catch APIError.server(let status, _, _) where status == 404 { return nil }
    }

    func selectSwap(scanId: String, original: String, chosen: String, selected: Bool) async throws {
        _ = try await authed("POST", "swaps/select",
                             json: ["scanId": scanId, "original": original, "chosen": chosen, "selected": selected],
                             as: OKResponse.self)
    }

    func shoppingHabits(trips: Int? = nil) async throws -> ShoppingHabits {
        try await authed("GET", "shopping-habits", query: trips.map { [URLQueryItem(name: "trips", value: String($0))] } ?? [],
                         as: ShoppingHabits.self)
    }

    // MARK: - Health

    func createHealthKey() async throws -> HealthKeyResponse {
        try await authed("POST", "health/key", json: [:], as: HealthKeyResponse.self)
    }

    func deleteHealthKey() async throws {
        _ = try await authed("DELETE", "health/key", as: OKResponse.self)
    }

    func healthStatus() async throws -> HealthStatus {
        try await authed("GET", "health/status", as: HealthStatus.self)
    }

    func healthSummary(days: Int) async throws -> HealthSummary {
        try await authed("GET", "health/summary", query: [
            URLQueryItem(name: "days", value: String(days)),
            URLQueryItem(name: "tz", value: TimeZone.current.identifier),
        ], as: HealthSummary.self)
    }

    /// Uploads per-day Apple Health data with the sync key (not the JWT).
    func ingestHealth(days: [[String: Any]], syncKey: String) async throws -> IngestResponse {
        try await publicCall("POST", "health/ingest",
                             json: ["days": days, "timezone": TimeZone.current.identifier],
                             bearer: syncKey,
                             query: [URLQueryItem(name: "tz", value: TimeZone.current.identifier)],
                             as: IngestResponse.self)
    }
}

/// multipart/form-data builder.
struct MultipartForm {
    private let boundary = "NutriScan-\(UUID().uuidString)"
    private var body = Data()

    var contentType: String { "multipart/form-data; boundary=\(boundary)" }

    mutating func addField(_ name: String, _ value: String) {
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
        body.append(value)
        body.append("\r\n")
    }

    mutating func addFile(name: String, filename: String, mimeType: String, data: Data) {
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n")
        body.append("Content-Type: \(mimeType)\r\n\r\n")
        body.append(data)
        body.append("\r\n")
    }

    func finalize() -> Data {
        var out = body
        out.append("--\(boundary)--\r\n")
        return out
    }
}

private extension Data {
    mutating func append(_ string: String) { append(Data(string.utf8)) }
}
