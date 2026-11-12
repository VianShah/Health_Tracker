import SwiftUI

/// First screen. "Continue without an account" needs nothing at all (the server
/// creates an anonymous guest ID tied to a secret kept in this phone's Keychain).
struct OnboardingView: View {
    @EnvironmentObject private var model: AppModel
    @State private var busy: String?
    @State private var error: String?
    @State private var showServer = false
    @State private var google = GoogleSignIn()

    private var googleAvailable: Bool {
        AppConfig.isGoogleConfigured && (model.clientConfig?.googleAvailable ?? false)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 28) {
                    VStack(spacing: 14) {
                        Image(systemName: "leaf.circle.fill")
                            .font(.system(size: 84))
                            .foregroundStyle(Theme.brand.gradient)
                            .padding(.top, 40)
                        Text("NutriScan").font(.largeTitle.bold())
                        Text("Snap your plate, a grocery bill or a menu.\nGet a clinical-grade nutrition audit in seconds.")
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.secondary)
                    }

                    VStack(alignment: .leading, spacing: 14) {
                        feature("fork.knife", "Log meals", "Portions and macros from one photo.")
                        feature("receipt", "Audit receipts", "Spot processed food and get healthier swaps.")
                        feature("menucard", "Order smarter", "The 5 best dishes on any menu.")
                        feature("heart.text.square", "Apple Health", "Compare what you eat with what you burn.")
                        feature("rectangle.3.group", "Widgets & Shortcuts", "Home Screen, Lock Screen, Control Center and Siri.")
                    }
                    .card()

                    if let error { ErrorBanner(message: error) }

                    VStack(spacing: 12) {
                        if googleAvailable {
                            Button { Task { await signInWithGoogle() } } label: {
                                HStack {
                                    if busy == "google" { ProgressView().tint(.white) } else { Image(systemName: "g.circle.fill") }
                                    Text("Sign in with Google")
                                }
                                .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.large)
                        }

                        Button { Task { await continueAsGuest() } } label: {
                            HStack {
                                if busy == "guest" { ProgressView() }
                                Text("Continue without an account")
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(googleAvailable ? AnyPrimitiveButtonStyle(.bordered) : AnyPrimitiveButtonStyle(.borderedProminent))
                        .controlSize(.large)

                        Text("Free. Your scans are saved to a private guest ID on this phone. You can sign in later and keep everything.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .disabled(busy != nil)

                    Button("Server: \(AppConfig.baseURLString)") { showServer = true }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(20)
            }
            .background(Color(.systemGroupedBackground))
            .sheet(isPresented: $showServer) {
                ServerSettingsView { Task { model.clientConfig = try? await model.api.clientConfig() } }
            }
        }
    }

    private func feature(_ symbol: String, _ title: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(Theme.brand)
                .frame(width: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(text).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private func continueAsGuest() async {
        busy = "guest"; error = nil
        defer { busy = nil }
        do {
            try await model.api.startGuest()
            await model.refreshAll()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func signInWithGoogle() async {
        busy = "google"; error = nil
        defer { busy = nil }
        do {
            guard let apiKey = model.clientConfig?.auth?.apiKey else { throw GoogleSignIn.Failure.notConfigured }
            let idToken = try await google.signIn(firebaseAPIKey: apiKey)
            _ = try await model.api.signIn(firebaseIdToken: idToken)
            await model.bootstrap()
        } catch GoogleSignIn.Failure.cancelled {
            // user closed the sheet
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Lets a view pick between two primitive button styles at runtime.
struct AnyPrimitiveButtonStyle: PrimitiveButtonStyle {
    private let make: (Configuration) -> AnyView
    init<S: PrimitiveButtonStyle>(_ style: S) { make = { AnyView(style.makeBody(configuration: $0)) } }
    func makeBody(configuration: Configuration) -> some View { make(configuration) }
}
