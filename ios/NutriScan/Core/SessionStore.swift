import Foundation

/// What we keep about the signed-in user. Stored in the Keychain.
struct StoredSession: Codable, Equatable {
    var accessToken: String
    var refreshToken: String
    var userId: String
    var account: Account?
    var isGuest: Bool

    var displayName: String {
        if let n = account?.name, !n.isEmpty { return n }
        if let e = account?.email { return e }
        return isGuest ? "Guest" : "NutriScan user"
    }

    var firstName: String? {
        account?.name?.split(separator: " ").first.map(String.init)
    }

    /// Linked to a Balance Nutrition program (user ID is then the BN client ID).
    var isLinkedToBN: Bool { account?.bnClientId != nil }
}

@MainActor
final class SessionStore: ObservableObject {
    private static let sessionKey = "session.v1"
    private static let guestSecretKey = "guest.secret"

    @Published private(set) var session: StoredSession?

    init() {
        session = Keychain.get(StoredSession.self, for: Self.sessionKey)
    }

    var isSignedIn: Bool { session != nil }

    /// Device-held secret behind the guest ID. Kept after sign-in so a guest's
    /// data can be carried into an account, and removed once that happened.
    var guestSecret: String? {
        get { Keychain.get(String.self, for: Self.guestSecretKey) }
        set { Keychain.set(newValue, for: Self.guestSecretKey) }
    }

    func apply(_ auth: AuthResponse, keepingAccount: Bool = false) {
        let previous = session
        let userId = auth.userId ?? previous?.userId ?? ""
        let new = StoredSession(
            accessToken: auth.accessToken,
            refreshToken: auth.refreshToken,
            userId: userId,
            account: keepingAccount ? (auth.account ?? previous?.account) : auth.account,
            isGuest: auth.guest ?? (keepingAccount ? (previous?.isGuest ?? false) : userId.hasPrefix("guest_"))
        )
        if let secret = auth.guestSecret { guestSecret = secret }
        save(new)
    }

    func updateAccount(_ account: Account?) {
        guard var s = session else { return }
        s.account = account
        save(s)
    }

    func clear() {
        session = nil
        Keychain.delete(Self.sessionKey)
    }

    private func save(_ s: StoredSession) {
        session = s
        Keychain.set(s, for: Self.sessionKey)
    }
}
