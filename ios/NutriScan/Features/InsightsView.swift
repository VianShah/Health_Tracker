import Charts
import SwiftUI

struct InsightsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var range = 7
    @State private var summary: HealthSummary?
    @State private var loading = false

    private var days: [HealthDay] { summary?.days ?? model.summary?.days ?? [] }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    Picker("Range", selection: $range) {
                        Text("7 days").tag(7)
                        Text("14 days").tag(14)
                        Text("30 days").tag(30)
                    }
                    .pickerStyle(.segmented)

                    energyChart
                    stepsChart
                    scoresChart
                    shoppingSection
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Insights")
            .overlay { if loading && days.isEmpty { ProgressView() } }
            .task(id: range) { await load() }
            .refreshable { await load(); await model.refreshAll() }
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        summary = try? await model.api.healthSummary(days: range)
    }

    // MARK: Energy

    private struct EnergyPoint: Identifiable {
        var id: String { "\(series)-\(day.timeIntervalSince1970)" }
        var day: Date
        var series: String
        var kcal: Double
    }

    private var energyPoints: [EnergyPoint] {
        days.flatMap { d -> [EnergyPoint] in
            var out: [EnergyPoint] = []
            if let e = d.eaten?.kcal { out.append(.init(day: d.day, series: "Eaten", kcal: e)) }
            if let b = d.burnedKcal { out.append(.init(day: d.day, series: "Burned", kcal: b)) }
            return out
        }
    }

    private var energyChart: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Calories in vs out").font(.headline)
            if energyPoints.isEmpty {
                emptyNote("Log meals and connect Apple Health to see this chart.")
            } else {
                Chart(energyPoints) { p in
                    BarMark(x: .value("Day", p.day, unit: .day), y: .value("kcal", p.kcal))
                        .foregroundStyle(by: .value("Series", p.series))
                        .position(by: .value("Series", p.series))
                        .cornerRadius(3)
                }
                .chartForegroundStyleScale(["Eaten": Theme.eaten, "Burned": Theme.burned])
                .chartXAxis {
                    AxisMarks(values: .stride(by: .day, count: range > 14 ? 5 : 1)) { _ in
                        AxisGridLine()
                        AxisValueLabel(format: range > 14 ? Date.FormatStyle.dateTime.day().month(.defaultDigits) : Date.FormatStyle.dateTime.weekday(.narrow))
                    }
                }
                .frame(height: 200)
                let netDays = days.compactMap(\.netKcal)
                if !netDays.isEmpty {
                    let avg = netDays.reduce(0, +) / Double(netDays.count)
                    Text("Average net: \(avg > 0 ? "+" : "")\(Int(avg)) kcal/day on days with meals and Health data.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .card()
    }

    // MARK: Steps

    private var stepsChart: some View {
        let points: [ValuePoint] = days.compactMap { d in d.health?.steps.map { ValuePoint(id: d.date, x: d.day, value: $0) } }
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Steps").font(.headline)
                Spacer()
                if !points.isEmpty {
                    Text("avg \(Int(points.map(\.value).reduce(0, +) / Double(points.count)).formatted())")
                        .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                }
            }
            if points.isEmpty {
                emptyNote("Connect Apple Health on the Today tab.")
            } else {
                Chart {
                    ForEach(points) { p in
                        BarMark(x: .value("Day", p.x, unit: .day), y: .value("Steps", p.value))
                            .foregroundStyle(p.value >= Double(SharedStore.stepGoal) ? Theme.good : Theme.good.opacity(0.45))
                            .cornerRadius(3)
                    }
                    RuleMark(y: .value("Goal", Double(SharedStore.stepGoal)))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [4]))
                        .foregroundStyle(.secondary)
                        .annotation(position: .top, alignment: .leading) {
                            Text("Goal").font(.caption2).foregroundStyle(.secondary)
                        }
                }
                .frame(height: 170)
            }
        }
        .card()
    }

    // MARK: Scan scores

    private var scoresChart: some View {
        let cutoff = Calendar.current.date(byAdding: .day, value: -range, to: .now) ?? .distantPast
        let scans = model.history.filter { $0.date >= cutoff }.sorted { $0.date < $1.date }
        return VStack(alignment: .leading, spacing: 10) {
            Text("Scan scores").font(.headline)
            if scans.isEmpty {
                emptyNote("No scans in this period.")
            } else {
                Chart(scans) { s in
                    PointMark(x: .value("Date", s.date), y: .value("Score", s.healthScore))
                        .foregroundStyle(by: .value("Type", s.scanMode.title))
                        .symbolSize(60)
                }
                .chartYScale(domain: 0...10)
                .frame(height: 170)
                let avg = scans.map(\.healthScore).reduce(0, +) / Double(scans.count)
                Text("Average \(String(format: "%.1f", avg)) / 10 across \(scans.count) scans.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .card()
    }

    // MARK: Shopping

    @ViewBuilder
    private var shoppingSection: some View {
        if let habits = model.habits, (habits.totalReceiptScans ?? 0) > 0 {
            let categories: [CategoryPoint] = (habits.categoryDistribution ?? [:])
                .filter { $0.value > 0 }
                .sorted { $0.value > $1.value }
                .map { CategoryPoint(name: $0.key, count: $0.value) }
            VStack(alignment: .leading, spacing: 10) {
                Text("Shopping basket").font(.headline)
                HStack(spacing: 16) {
                    VStack(alignment: .leading) {
                        Text("Receipts").font(.caption).foregroundStyle(.secondary)
                        Text("\(habits.totalReceiptScans ?? 0)").font(.title2.bold())
                    }
                    VStack(alignment: .leading) {
                        Text("Avg basket").font(.caption).foregroundStyle(.secondary)
                        Text(String(format: "%.1f", habits.insights?.avgHealthScore ?? 0)).font(.title2.bold())
                            .foregroundStyle(Theme.scoreColor(habits.insights?.avgHealthScore ?? 0))
                    }
                    if let top = habits.insights?.topCategory {
                        VStack(alignment: .leading) {
                            Text("Top category").font(.caption).foregroundStyle(.secondary)
                            Text(top).font(.subheadline.bold()).lineLimit(1)
                        }
                    }
                }
                if !categories.isEmpty {
                    Chart(categories) { c in
                        SectorMark(angle: .value("Items", c.count), innerRadius: .ratio(0.6), angularInset: 1.5)
                            .foregroundStyle(by: .value("Category", c.name))
                            .cornerRadius(3)
                    }
                    .frame(height: 200)
                }
                if let receipts = habits.receiptHistory, receipts.count > 1 {
                    Text("Basket score by trip").font(.subheadline.weight(.semibold)).padding(.top, 6)
                    let trips = receipts.indices.map { TripPoint(trip: $0 + 1, score: receipts[$0].healthScore ?? 0) }
                    Chart(trips) { t in
                        LineMark(x: .value("Trip", t.trip), y: .value("Score", t.score))
                            .interpolationMethod(.catmullRom)
                        PointMark(x: .value("Trip", t.trip), y: .value("Score", t.score))
                    }
                    .chartYScale(domain: 0...10)
                    .frame(height: 140)
                }
                if let m = habits.macroTrends {
                    Text("Average per scan").font(.subheadline.weight(.semibold)).padding(.top, 6)
                    MacroBar(macros: Macros(protein: m.avgProtein, carbs: m.avgCarbs, fat: m.avgFat))
                }
                if let items = habits.frequentItems, !items.isEmpty {
                    Text("You buy most often").font(.subheadline.weight(.semibold)).padding(.top, 6)
                    ForEach(items.prefix(8)) { item in
                        HStack {
                            Text(item.name).font(.subheadline)
                            Spacer()
                            Text("×\(item.count)").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .card()
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text("Shopping basket").font(.headline)
                emptyNote("Scan a grocery receipt to see what your basket is made of.")
                Button("Scan a receipt") { model.handle(.scan(.receipt)) }.buttonStyle(.bordered)
            }
            .card()
        }
    }

    private struct ValuePoint: Identifiable { var id: String; var x: Date; var value: Double }
    private struct CategoryPoint: Identifiable { var id: String { name }; var name: String; var count: Double }
    private struct TripPoint: Identifiable { var id: Int { trip }; var trip: Int; var score: Double }

    private func emptyNote(_ text: String) -> some View {
        Text(text).font(.subheadline).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
    }
}
