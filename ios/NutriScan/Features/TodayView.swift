import SwiftUI
import WidgetKit
#if canImport(NutriScanShared)
import NutriScanShared
#endif

struct TodayView: View {
    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var health: HealthSync
    @State private var hydration = SharedStore.hydration()
    @State private var healthError: String?
    @State private var connecting = false

    private var today: HealthDay? {
        guard let t = model.summary?.today, t.date == APIDate.dayKey(.now) else { return nil }
        return t
    }

    private var todaysMeals: [ScanResult] {
        model.history.filter { $0.scanMode == .plate && Calendar.current.isDateInToday($0.date) }
    }

    private var eatenKcal: Int {
        if let e = today?.eaten?.kcal { return Int(e) }
        return Int(todaysMeals.reduce(0) { $0 + $1.computedMacros.kcal })
    }

    private var todayMacros: Macros {
        if let e = today?.eaten { return Macros(calories: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat) }
        return todaysMeals.map(\.computedMacros).reduce(Macros(calories: 0, protein: 0, carbs: 0, fat: 0), +)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if let err = model.lastError { ErrorBanner(message: err) }
                    energyCard
                    quickScan
                    hydrationCard
                    if !(model.summary?.insights.isEmpty ?? true) { insightsCard }
                    healthCard
                    if let last = model.history.first { lastScanCard(last) }
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle(greeting)
            .refreshable { await model.refreshAll() }
            .onAppear { hydration = SharedStore.hydration() }
            .onChange(of: model.isRefreshing) { _, _ in hydration = SharedStore.hydration() }
            .onReceive(NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)) { _ in
                let h = SharedStore.hydration()
                if h != hydration { hydration = h }
            }
        }
    }

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: .now)
        let part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"
        if let n = session.session?.firstName { return "\(part), \(n)" }
        return part
    }

    // MARK: Cards

    private var energyCard: some View {
        let burned = today?.burnedKcal.map { Int($0) }
        let steps = today?.health?.steps.map { Int($0) }
        return VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Energy today").font(.headline)
                Spacer()
                if let net = today?.netKcal {
                    Text(net > 0 ? "+\(Int(net)) kcal net" : "\(Int(net)) kcal net")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background((net > 0 ? Theme.eaten : Theme.good).opacity(0.15), in: Capsule())
                        .foregroundStyle(net > 0 ? Theme.eaten : Theme.good)
                }
            }
            HStack(spacing: 12) {
                energyStat("Eaten", eatenKcal, "fork.knife", Theme.eaten,
                           detail: "\(today?.eaten?.meals ?? todaysMeals.count) meal(s)")
                energyStat("Burned", burned, "flame.fill", Theme.burned,
                           detail: burned == nil ? (health.isEnabled ? "syncing…" : "connect Health") : "active + resting")
                energyStat("Steps", steps, "figure.walk", Theme.good,
                           detail: "goal \(SharedStore.stepGoal.formatted())")
            }
            if todayMacros.kcal > 0 { MacroBar(macros: todayMacros) }
        }
        .card()
    }

    private func energyStat(_ title: String, _ value: Int?, _ symbol: String, _ tint: Color, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(title, systemImage: symbol).font(.caption.weight(.semibold)).foregroundStyle(tint)
            Text(value.map { $0.formatted() } ?? "—").font(.title3.weight(.bold)).monospacedDigit()
            Text(detail).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var quickScan: some View {
        HStack(spacing: 10) {
            ForEach(ScanModeOption.allCases) { mode in
                Button {
                    model.handle(.scan(mode))
                } label: {
                    VStack(spacing: 8) {
                        Image(systemName: mode.symbol).font(.title2)
                        Text(mode.title).font(.caption.weight(.semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Theme.brand.opacity(0.12), in: RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.brand)
            }
        }
    }

    private var hydrationCard: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle().stroke(Theme.water.opacity(0.18), lineWidth: 8)
                Circle().trim(from: 0, to: hydration.progress)
                    .stroke(Theme.water, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Image(systemName: "drop.fill").foregroundStyle(Theme.water)
            }
            .frame(width: 54, height: 54)
            .animation(.spring, value: hydration.glasses)

            VStack(alignment: .leading, spacing: 2) {
                Text("Water").font(.headline)
                Text("\(hydration.glasses) of \(hydration.goal) glasses")
                    .font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
            }
            Spacer()
            Button { hydration = SharedStore.addWater(-1) } label: {
                Image(systemName: "minus").frame(width: 34, height: 34)
            }
            .buttonStyle(.bordered).buttonBorderShape(.circle)
            .disabled(hydration.glasses == 0)
            Button { hydration = SharedStore.addWater(1) } label: {
                Image(systemName: "plus").frame(width: 34, height: 34)
            }
            .buttonStyle(.borderedProminent).buttonBorderShape(.circle).tint(Theme.water)
        }
        .card()
        .sensoryFeedback(.increase, trigger: hydration.glasses)
    }

    private var insightsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Insights").font(.headline)
            ForEach(model.summary?.insights ?? []) { i in
                Label {
                    Text(i.text).font(.subheadline)
                } icon: {
                    Image(systemName: i.kind == "good" ? "hand.thumbsup.fill" : "lightbulb.fill")
                        .foregroundStyle(i.kind == "good" ? Theme.good : Theme.ok)
                }
            }
            Text("Estimates, not medical advice.").font(.caption2).foregroundStyle(.tertiary)
        }
        .card()
    }

    @ViewBuilder
    private var healthCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Apple Health", systemImage: "heart.fill").font(.headline).foregroundStyle(.pink)
                Spacer()
                if health.isSyncing { ProgressView() }
            }
            if !health.isAvailable {
                Text("Apple Health isn't available on this device.").font(.subheadline).foregroundStyle(.secondary)
            } else if health.isEnabled {
                if let h = today?.health {
                    HStack(spacing: 16) {
                        if let m = h.exerciseMinutes { mini("Exercise", "\(Int(m)) min") }
                        if let s = h.sleepHours { mini("Sleep", String(format: "%.1f h", s)) }
                        if let w = h.weightKg { mini("Weight", String(format: "%.1f kg", w)) }
                        if let hr = h.restingHr { mini("Resting HR", "\(Int(hr))") }
                    }
                }
                HStack {
                    Text(health.lastSync.map { "Synced \($0.relativeShort)" } ?? "Not synced yet")
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Sync now") {
                        Task {
                            do { try await health.sync(days: 7); await model.refreshAll() }
                            catch { healthError = error.localizedDescription }
                        }
                    }
                    .font(.caption.weight(.semibold))
                    .disabled(health.isSyncing)
                }
                if let e = healthError ?? health.lastError { Text(e).font(.caption).foregroundStyle(Theme.bad) }
            } else {
                Text("Connect to see calories burned, steps, sleep and workouts next to what you eat.")
                    .font(.subheadline).foregroundStyle(.secondary)
                Button {
                    Task {
                        connecting = true
                        defer { connecting = false }
                        do { try await health.connect(); await model.refreshAll() }
                        catch { healthError = error.localizedDescription }
                    }
                } label: {
                    HStack {
                        if connecting { ProgressView() }
                        Text("Connect Apple Health")
                    }
                }
                .buttonStyle(.borderedProminent).tint(.pink)
                .disabled(connecting)
                if let e = healthError { Text(e).font(.caption).foregroundStyle(Theme.bad) }
            }
        }
        .card()
    }

    private func mini(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.subheadline.weight(.semibold)).monospacedDigit()
        }
    }

    private func lastScanCard(_ scan: ScanResult) -> some View {
        NavigationLink {
            ScanResultView(result: scan)
        } label: {
            HStack(spacing: 14) {
                ScoreRing(score: scan.healthScore, size: 52, lineWidth: 6)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Last scan · \(scan.scanMode.title)").font(.caption).foregroundStyle(.secondary)
                    Text(scan.title).font(.subheadline.weight(.semibold)).lineLimit(2)
                    Text(scan.date.relativeShort).font(.caption2).foregroundStyle(.tertiary)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
            }
            .card()
        }
        .buttonStyle(.plain)
    }
}
