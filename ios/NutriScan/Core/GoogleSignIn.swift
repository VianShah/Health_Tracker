import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

/// Google sign-in without any third-party SDK:
///   1. ASWebAuthenticationSession → Google OAuth (PKCE, iOS client, no secret)
///   2. code → Google ID token
///   3. Firebase Auth REST `signInWithIdp` → Firebase ID token
///   4. The app sends that to POST /api/v1/auth/firebase (see APIClient.signIn)
///
/// Needs GOOGLE_IOS_CLIENT_ID / GOOGLE_REVERSED_CLIENT_ID in Config/Signing.xcconfig,
/// and the Firebase web API key, which the server publishes at GET /client-config.
@MainActor
final class GoogleSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    enum Failure: LocalizedError {
        case notConfigured, cancelled, noCode, exchange(String)
        var errorDescription: String? {
            switch self {
            case .notConfigured: return "Google sign-in isn't set up in this build. Use \"Continue without an account\", or add GOOGLE_IOS_CLIENT_ID in Config/Signing.xcconfig."
            case .cancelled: return nil
            case .noCode: return "Google didn't return a sign-in code."
            case .exchange(let m): return m
            }
        }
    }

    private var authSession: ASWebAuthenticationSession?

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }

    /// Returns a Firebase ID token.
    func signIn(firebaseAPIKey: String) async throws -> String {
        guard let clientID = AppConfig.googleClientID, let scheme = AppConfig.googleRedirectScheme else {
            throw Failure.notConfigured
        }
        let redirectURI = "\(scheme):/oauth2redirect"
        let verifier = Self.randomURLSafe(64)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncoded
        let state = Self.randomURLSafe(16)

        var comps = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        comps.queryItems = [
            .init(name: "client_id", value: clientID),
            .init(name: "redirect_uri", value: redirectURI),
            .init(name: "response_type", value: "code"),
            .init(name: "scope", value: "openid email profile"),
            .init(name: "code_challenge", value: challenge),
            .init(name: "code_challenge_method", value: "S256"),
            .init(name: "state", value: state),
            .init(name: "prompt", value: "select_account"),
        ]

        let callback: URL = try await withCheckedThrowingContinuation { cont in
            let s = ASWebAuthenticationSession(url: comps.url!, callbackURLScheme: scheme) { url, error in
                if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    cont.resume(throwing: Failure.cancelled)
                } else if let error {
                    cont.resume(throwing: error)
                } else if let url {
                    cont.resume(returning: url)
                } else {
                    cont.resume(throwing: Failure.noCode)
                }
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = false
            self.authSession = s
            s.start()
        }

        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard items.first(where: { $0.name == "state" })?.value == state,
              let code = items.first(where: { $0.name == "code" })?.value else { throw Failure.noCode }

        // 2. Code → Google ID token
        var tokenReq = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        tokenReq.httpMethod = "POST"
        tokenReq.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        tokenReq.httpBody = Self.formEncode([
            "code": code, "client_id": clientID, "redirect_uri": redirectURI,
            "grant_type": "authorization_code", "code_verifier": verifier,
        ])
        let (tokenData, _) = try await URLSession.shared.data(for: tokenReq)
        let tokenJSON = (try? JSONSerialization.jsonObject(with: tokenData)) as? [String: Any]
        guard let googleIdToken = tokenJSON?["id_token"] as? String else {
            throw Failure.exchange((tokenJSON?["error_description"] as? String) ?? "Google sign-in failed.")
        }

        // 3. Google ID token → Firebase ID token
        var fbReq = URLRequest(url: URL(string: "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=\(firebaseAPIKey)")!)
        fbReq.httpMethod = "POST"
        fbReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
        fbReq.setValue(Bundle.main.bundleIdentifier, forHTTPHeaderField: "X-Ios-Bundle-Identifier")
        fbReq.httpBody = try JSONSerialization.data(withJSONObject: [
            "postBody": "id_token=\(googleIdToken)&providerId=google.com",
            "requestUri": "http://localhost",
            "returnSecureToken": true,
            "returnIdpCredential": true,
        ])
        let (fbData, _) = try await URLSession.shared.data(for: fbReq)
        let fbJSON = (try? JSONSerialization.jsonObject(with: fbData)) as? [String: Any]
        guard let firebaseIdToken = fbJSON?["idToken"] as? String else {
            let msg = ((fbJSON?["error"] as? [String: Any])?["message"] as? String) ?? "unknown error"
            throw Failure.exchange("Firebase rejected the Google sign-in (\(msg)). Make sure the iOS OAuth client is in the same Google Cloud project as Firebase, or allow-list it under Firebase > Authentication > Google.")
        }
        return firebaseIdToken
    }

    private static func randomURLSafe(_ bytes: Int) -> String {
        var data = Data(count: bytes)
        _ = data.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, bytes, $0.baseAddress!) }
        return data.base64URLEncoded
    }

    private static func formEncode(_ params: [String: String]) -> Data {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return params.map { k, v in
            "\(k)=\(v.addingPercentEncoding(withAllowedCharacters: allowed) ?? v)"
        }.joined(separator: "&").data(using: .utf8)!
    }
}

private extension Data {
    var base64URLEncoded: String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
