import Foundation
#if canImport(NutriScanShared)
import NutriScanShared
#endif

/// Pushes Apple Health data to the server with a per-user sync key.
/// The key is created through POST /health/key (JWT) and kept in the Keychain.
@MainActor
final class HealthSync: ObservableObject {
    private struct StoredKey: Codable { var key: String; var userId: String }
    private static let keyKey = "health.syncKey"
    private static let lastSyncKey = "health.lastSync"
    private static let enabledKey = "health.enabled"

    private let api: APIClient
    private let hk = HealthKitManager.shared

    @Published private(set) var isSyncing = false
    @Published private(set) var lastSync: Date?
    @Published private(set) var lastError: String?
    @Published var isEnabled: Bool {
        didSet { UserDefaults.standard.set(isEnabled, forKey: Self.enabledKey) }
    }

    init(api: APIClient) {
        self.api = api
        isEnabled = UserDefaults.standard.bool(forKey: Self.enabledKey)
        lastSync = UserDefaults.standard.object(forKey: Self.lastSyncKey) as? Date
    }

    var isAvailable: Bool { hk.isAvailable }

    /// Ask for Health permission, create a sync key and upload the last 30 days.
    func connect() async throws {
        try await hk.requestAuthorization()
        isEnabled = true
        _ = try await ensureKey(forceNew: true)
        try await sync(days: 30)
    }

    func disconnect() async {
        isEnabled = false
        Keychain.delete(Self.keyKey)
        try? await api.deleteHealthKey()
    }

    /// Upload recent days. Safe to call often; the server upserts by date.
    func sync(days: Int = 7) async throws {
        guard isEnabled, hk.isAvailable, !isSyncing else { return }
        isSyncing = true
        defer { isSyncing = false }
        do {
            let summaries = try await hk.dailySummaries(days: days).filter(\.hasData)
            guard !summaries.isEmpty else {
                lastError = "No Apple Health data found yet. Check Settings > Health > Data Access > NutriScan."
                return
            }
            let payload = summaries.map(\.payload)
            var key = try await ensureKey()
            do {
                _ = try await api.ingestHealth(days: payload, syncKey: key)
            } catch APIError.server(let status, _, _) where status == 401 {
                // Key was rotated or removed elsewhere: make a new one and retry once.
                key = try await ensureKey(forceNew: true)
                _ = try await api.ingestHealth(days: payload, syncKey: key)
            }
            lastSync = .now
            lastError = nil
            UserDefaults.standard.set(lastSync, forKey: Self.lastSyncKey)
        } catch {
            lastError = error.localizedDescription
            throw error
        }
    }

    private func ensureKey(forceNew: Bool = false) async throws -> String {
        guard let userId = api.session.session?.userId else { throw APIError.notSignedIn }
        if !forceNew, let stored = Keychain.get(StoredKey.self, for: Self.keyKey), stored.userId == userId {
            return stored.key
        }
        let created = try await api.createHealthKey()
        Keychain.set(StoredKey(key: created.key, userId: userId), for: Self.keyKey)
        return created.key
    }

    func reset() {
        Keychain.delete(Self.keyKey)
        isEnabled = false
        lastSync = nil
        UserDefaults.standard.removeObject(forKey: Self.lastSyncKey)
    }
}
