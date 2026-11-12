import SwiftUI
#if canImport(NutriScanShared)
import NutriScanShared
#endif

struct HistoryView: View {
    @EnvironmentObject private var model: AppModel
    @State private var filter: ScanModeOption?

    private var filtered: [ScanResult] {
        guard let filter else { return model.history }
        return model.history.filter { $0.scanMode == filter }
    }

    private var grouped: [(day: Date, scans: [ScanResult])] {
        let groups = Dictionary(grouping: filtered) { Calendar.current.startOfDay(for: $0.date) }
        return groups.keys.sorted(by: >).map { ($0, groups[$0]!.sorted { $0.date > $1.date }) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("Filter", selection: $filter) {
                        Text("All").tag(ScanModeOption?.none)
                        ForEach(ScanModeOption.allCases) { Text($0.title).tag(ScanModeOption?.some($0)) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }

                if filtered.isEmpty {
                    ContentUnavailableView {
                        Label("No scans yet", systemImage: "camera.viewfinder")
                    } description: {
                        Text("Your meals, receipts and menus will appear here.")
                    } actions: {
                        Button("Scan something") { model.handle(.scan(filter ?? .plate)) }
                            .buttonStyle(.borderedProminent)
                    }
                }

                ForEach(grouped, id: \.day) { group in
                    Section(header: Text(dayTitle(group.day))) {
                        ForEach(group.scans) { scan in
                            NavigationLink {
                                ScanResultView(result: scan)
                            } label: {
                                HistoryRow(scan: scan)
                            }
                        }
                    }
                }
            }
            .navigationTitle("History")
            .refreshable { await model.refreshAll() }
            .overlay { if model.isRefreshing && model.history.isEmpty { ProgressView() } }
        }
    }

    private func dayTitle(_ d: Date) -> String {
        if Calendar.current.isDateInToday(d) { return "Today" }
        if Calendar.current.isDateInYesterday(d) { return "Yesterday" }
        return d.formatted(.dateTime.weekday(.wide).day().month())
    }
}

private struct HistoryRow: View {
    var scan: ScanResult
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: scan.scanMode.symbol)
                .frame(width: 36, height: 36)
                .background(Theme.brand.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                .foregroundStyle(Theme.brand)
            VStack(alignment: .leading, spacing: 3) {
                Text(scan.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                HStack(spacing: 6) {
                    Text(scan.date.formatted(date: .omitted, time: .shortened))
                    if scan.scanMode == .plate, scan.computedMacros.kcal > 0 {
                        Text("· \(Int(scan.computedMacros.kcal)) kcal")
                    } else {
                        Text("· \(scan.items.count) items")
                    }
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            ScorePill(score: scan.healthScore)
        }
        .padding(.vertical, 2)
    }
}
