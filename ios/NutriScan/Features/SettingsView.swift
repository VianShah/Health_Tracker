import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var health: HealthSync
    @EnvironmentObject private var profile: ProfileStore
    @EnvironmentObject private var notifications: NotificationManager

    @State private var waterGoal = SharedStore.waterGoal
    @State private var stepGoal = SharedStore.stepGoal
    @State private var showLink = false
    @State private var showServer = false
    @State private var confirmSignOut = false
    @State private var busy = false
    @State private var error: String?
    @State private var google = GoogleSignIn()

    var body: some View {
        NavigationStack {
            Form {
                accountSection
                Section("Profile") {
                    if session.session?.isLinkedToBN == true {
                        Label("Using your Balance Nutrition program profile", systemImage: "checkmark.seal.fill")
                            .font(.footnote).foregroundStyle(Theme.good)
                    }
                    NavigationLink("Allergies, goals & diet") { ProfileEditorView() }
                }
                healthSection
                Section("Daily goals") {
                    Stepper("Water: \(waterGoal) glasses", value: $waterGoal, in: 1...20)
                        .onChange(of: waterGoal) { _, v in SharedStore.waterGoal = v }
                    Stepper("Steps: \(stepGoal.formatted())", value: $stepGoal, in: 1000...30000, step: 500)
                        .onChange(of: stepGoal) { _, v in
                            SharedStore.stepGoal = v
                            Task { await model.updateWidgetSnapshot() }
                        }
                }
                remindersSection
                Section {
                    NavigationLink { WidgetsHelpView() } label: {
                        Label("Widgets, Siri & Control Center", systemImage: "rectangle.3.group")
                    }
                }
                Section("Server") {
                    Button { showServer = true } label: {
                        LabeledContent("API", value: AppConfig.baseURLString)
                    }
                    .foregroundStyle(.primary)
                }
                Section {
                    Button("Sign out", role: .destructive) { confirmSignOut = true }
                } footer: {
                    Text("NutriScan \(AppConfig.appVersion). Built with a free Apple ID? The app stops opening after 7 days — just press Run in Xcode again; your data is kept on the server.")
                }
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $showLink) { LinkBNView() }
            .sheet(isPresented: $showServer) {
                ServerSettingsView { Task { await model.bootstrap() } }
            }
            .confirmationDialog("Sign out?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { Task { await model.signOut() } }
            } message: {
                Text(session.session?.isGuest == true
                     ? "You're a guest. You can come back to the same data on this phone by tapping \"Continue without an account\"."
                     : "Your scans stay in your account.")
            }
            .task { await notifications.refreshAuthorization() }
        }
    }

    // MARK: Account

    @ViewBuilder
    private var accountSection: some View {
        Section("Account") {
            if let s = session.session {
                HStack(spacing: 12) {
                    Image(systemName: s.isGuest ? "person.crop.circle.badge.questionmark" : "person.crop.circle.fill")
                        .font(.largeTitle).foregroundStyle(Theme.brand)
                    VStack(alignment: .leading) {
                        Text(s.displayName).font(.headline)
                        if let e = s.account?.email, e != s.displayName { Text(e).font(.caption).foregroundStyle(.secondary) }
                        Text(s.isGuest ? "Guest on this phone" : "Signed in with \(s.account?.provider ?? "Google")")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }

                if s.isGuest {
                    if AppConfig.isGoogleConfigured && (model.clientConfig?.googleAvailable ?? false) {
                        Button {
                            Task { await upgradeWithGoogle() }
                        } label: {
                            HStack {
                                Label("Sign in with Google to keep your data", systemImage: "g.circle")
                                if busy {
                                    Spacer()
                                    ProgressView()
                                }
                            }
                        }
                        .disabled(busy)
                    }
                } else if let bn = s.account?.bnClientId {
                    LabeledContent("Balance Nutrition", value: "Client \(bn)")
                    if let summary = ProfileStore.programSummary(profile.bnClient) {
                        Text(summary).font(.caption).foregroundStyle(.secondary)
                    }
                    Button("Unlink program", role: .destructive) {
                        Task {
                            busy = true; defer { busy = false }
                            do { try await model.api.unlinkBN(); profile.clearBN(); await model.refreshAll() }
                            catch { self.error = error.localizedDescription }
                        }
                    }
                } else {
                    Button { showLink = true } label: {
                        Label("Link Balance Nutrition program", systemImage: "link")
                    }
                }
                if let error { Text(error).font(.caption).foregroundStyle(Theme.bad) }
            }
        }
        .task {
            if let bn = session.session?.account?.bnClientId { _ = await profile.loadBNClient(bn) }
        }
    }

    private func upgradeWithGoogle() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            guard let key = model.clientConfig?.auth?.apiKey else { throw GoogleSignIn.Failure.notConfigured }
            let token = try await google.signIn(firebaseAPIKey: key)
            _ = try await model.api.signIn(firebaseIdToken: token)
            // The sync key belonged to the guest ID; make a new one for the account.
            if health.isEnabled { health.reset(); try? await health.connect() }
            await model.bootstrap()
        } catch GoogleSignIn.Failure.cancelled {
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: Health

    private var healthSection: some View {
        Section {
            if !health.isAvailable {
                Text("Apple Health isn't available on this device.").foregroundStyle(.secondary)
            } else if health.isEnabled {
                LabeledContent("Status", value: health.lastSync.map { "Synced \($0.relativeShort)" } ?? "Connected")
                Button("Sync last 30 days") {
                    Task { try? await health.sync(days: 30); await model.refreshAll() }
                }
                .disabled(health.isSyncing)
                Button("Disconnect Apple Health", role: .destructive) {
                    Task { await health.disconnect(); await model.refreshAll() }
                }
            } else {
                Button("Connect Apple Health") {
                    Task {
                        do { try await health.connect(); await model.refreshAll() }
                        catch { self.error = error.localizedDescription }
                    }
                }
            }
            if let e = health.lastError { Text(e).font(.caption).foregroundStyle(Theme.bad) }
        } header: {
            Text("Apple Health")
        } footer: {
            Text("Read-only: steps, active & resting energy, exercise, distance, sleep, weight, resting heart rate and workouts. Change access in the Health app › Sharing › Apps › NutriScan.")
        }
    }

    // MARK: Reminders

    private var remindersSection: some View {
        Section {
            ForEach($notifications.mealReminders) { $r in
                HStack {
                    Toggle(r.title, isOn: $r.enabled)
                    if r.enabled {
                        DatePicker("", selection: Binding(
                            get: { Calendar.current.date(from: DateComponents(hour: r.hour, minute: r.minute)) ?? .now },
                            set: { d in
                                let c = Calendar.current.dateComponents([.hour, .minute], from: d)
                                r.hour = c.hour ?? r.hour
                                r.minute = c.minute ?? r.minute
                            }), displayedComponents: .hourAndMinute)
                        .labelsHidden()
                    }
                }
            }
            Toggle("Water every 2 hours (10:00–20:00)", isOn: $notifications.waterReminders)
        } header: {
            Text("Reminders")
        } footer: {
            if !notifications.authorized && (notifications.waterReminders || notifications.mealReminders.contains(where: \.enabled)) {
                Text("Notifications are off for NutriScan. Turn them on in iOS Settings › NutriScan › Notifications.")
            } else {
                Text("Local reminders — they work offline and need no account.")
            }
        }
    }
}

// MARK: - Link BN

struct LinkBNView: View {
    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var profile: ProfileStore
    @Environment(\.dismiss) private var dismiss
    @State private var clientId = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("BN client ID", text: $clientId)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                } footer: {
                    Text("Your scans will be compared against your active diet plan. The program's registered email must match your sign-in email.")
                }
                if let error { Section { Text(error).foregroundStyle(Theme.bad) } }
            }
            .navigationTitle("Link program")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else {
                        Button("Link") { Task { await link() } }
                            .disabled(clientId.trimmingCharacters(in: .whitespaces).count < 3)
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func link() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            let id = clientId.trimmingCharacters(in: .whitespaces)
            try await model.api.linkBN(clientId: id)
            _ = await profile.loadBNClient(id, force: true)
            await model.refreshAll()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Server

struct ServerSettingsView: View {
    var onSave: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var url = AppConfig.baseURLString
    @State private var status: String?
    @State private var testing = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://your-host", text: $url)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } footer: {
                    Text("Where the NutriScan API (this repo's api/ folder) runs. For a server on your Mac use its LAN address, e.g. http://192.168.1.20:3002. Default: \(AppConfig.bundledBaseURL)")
                }
                Section {
                    Button {
                        Task { await test() }
                    } label: {
                        HStack {
                            Text("Test connection")
                            if testing {
                                Spacer()
                                ProgressView()
                            }
                        }
                    }
                    if let status { Text(status).font(.footnote) }
                    Button("Reset to default") { url = AppConfig.bundledBaseURL }
                }
            }
            .navigationTitle("Server")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        AppConfig.baseURLString = url
                        onSave()
                        dismiss()
                    }
                }
            }
        }
    }

    private func test() async {
        testing = true
        defer { testing = false }
        let base = url.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        guard let u = URL(string: base + "/api/v1/client-config") else { status = "That isn't a valid URL."; return }
        do {
            let (_, resp) = try await URLSession.shared.data(from: u)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            status = code == 200 ? "✅ Connected." : "Server answered with HTTP \(code)."
        } catch {
            status = "❌ \(error.localizedDescription)"
        }
    }
}

// MARK: - Profile editor

struct ProfileEditorView: View {
    @EnvironmentObject private var profile: ProfileStore
    @EnvironmentObject private var session: SessionStore
    @State private var allergyText = ""
    @State private var aversionText = ""

    var body: some View {
        Form {
            if session.session?.isLinkedToBN == true {
                Section {
                    Text("Your linked Balance Nutrition profile is used for scans. These details apply only if you unlink.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            Section("About you") {
                TextField("Name", text: $profile.local.name).textContentType(.givenName)
                Picker("Gender", selection: $profile.local.gender) {
                    Text("Not set").tag("")
                    Text("Female").tag("Female")
                    Text("Male").tag("Male")
                    Text("Other").tag("Other")
                }
                TextField("Age", text: $profile.local.age).keyboardType(.numberPad)
                TextField("Height (cm)", text: $profile.local.heightCm).keyboardType(.decimalPad)
                TextField("Current weight (kg)", text: $profile.local.currentWeightKg).keyboardType(.decimalPad)
                TextField("Goal weight (kg)", text: $profile.local.weightGoalKg).keyboardType(.decimalPad)
            }
            Section("Diet") {
                Picker("Eating habit", selection: $profile.local.eatingHabit) {
                    ForEach(NutritionProfile.eatingHabits, id: \.self) { Text($0) }
                }
                Picker("Health goal", selection: $profile.local.healthGoal) {
                    ForEach(NutritionProfile.goals, id: \.self) { Text($0) }
                }
            }
            tagSection(title: "Allergies", placeholder: "e.g. peanuts", text: $allergyText, list: $profile.local.allergies)
            tagSection(title: "Foods you avoid", placeholder: "e.g. mushrooms", text: $aversionText, list: $profile.local.aversions)
        }
        .navigationTitle("Profile")
    }

    private func tagSection(title: String, placeholder: String, text: Binding<String>, list: Binding<[String]>) -> some View {
        Section {
            ForEach(list.wrappedValue, id: \.self) { Text($0) }
                .onDelete { list.wrappedValue.remove(atOffsets: $0) }
            HStack {
                TextField(placeholder, text: text)
                    .onSubmit { add(text, to: list) }
                Button("Add") { add(text, to: list) }
                    .disabled(text.wrappedValue.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        } header: {
            Text(title)
        } footer: {
            if title == "Allergies" { Text("Items containing these score 0 and get safe alternatives.") }
        }
    }

    private func add(_ text: Binding<String>, to list: Binding<[String]>) {
        let v = text.wrappedValue.trimmingCharacters(in: .whitespaces)
        guard !v.isEmpty, !list.wrappedValue.contains(where: { $0.caseInsensitiveCompare(v) == .orderedSame }) else { return }
        list.wrappedValue.append(v)
        text.wrappedValue = ""
    }
}

// MARK: - Widgets help

struct WidgetsHelpView: View {
    var body: some View {
        List {
            Section("Home Screen widgets") {
                help("square.grid.2x2", "Today", "Calories eaten vs burned, steps and your last scan. Small, medium and large.")
                help("drop.fill", "Water", "Interactive: tap + / − right on the widget.")
                help("camera.viewfinder", "Quick Scan", "One tap to scan a meal, receipt or menu.")
                Text("Long-press the Home Screen › Edit › Add Widget › NutriScan.").font(.footnote).foregroundStyle(.secondary)
            }
            Section("Lock Screen") {
                help("lock.fill", "Steps ring, energy & water", "Lock Screen › Customize › tap the widget area › NutriScan.")
            }
            Section("Control Center (iOS 18+)") {
                help("switch.2", "Scan Meal and Log Water controls", "Open Control Center › + › Add a Control › NutriScan. Also works on the Action button.")
            }
            Section("Siri & Shortcuts") {
                help("mic.fill", "\"Scan a meal with NutriScan\"", "Opens the camera.")
                help("mic.fill", "\"Log water in NutriScan\"", "Adds a glass.")
                help("mic.fill", "\"NutriScan summary\"", "Reads today's calories, steps and water.")
                help("mic.fill", "\"Sync NutriScan health\"", "Uploads Apple Health data.")
            }
            Section {
                Text("Widgets refresh when you open the app, after each scan, and in the background about every hour (iOS decides the exact time).")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Widgets & Shortcuts")
    }

    private func help(_ symbol: String, _ title: String, _ text: String) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(text).font(.footnote).foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: symbol).foregroundStyle(Theme.brand)
        }
    }
}
