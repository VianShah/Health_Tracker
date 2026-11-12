import SwiftUI
#if canImport(NutriScanShared)
import NutriScanShared
#endif

struct ScanResultView: View {
    @EnvironmentObject private var model: AppModel
    @State var result: ScanResult
    @State private var swapError: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                header
                if let note = result.mentorsNote, !note.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Mentor's note", systemImage: "person.crop.circle.badge.checkmark")
                            .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.brand)
                        Text(note).font(.subheadline)
                    }
                    .card()
                }
                if result.scanMode != .menu, result.computedMacros.kcal > 0 { macrosCard }
                if let swapError { ErrorBanner(message: swapError) }

                VStack(alignment: .leading, spacing: 10) {
                    Text(result.scanMode == .menu ? "Recommended dishes" : "Items (\(result.items.count))")
                        .font(.headline)
                        .padding(.horizontal, 4)
                    ForEach(sortedItems) { item in
                        ItemCard(item: item, mode: result.scanMode) { alt, selected in
                            Task { await choose(alt, for: item, selected: selected) }
                        }
                    }
                }
                Text("AI estimates (rounded slightly low for safety). Not medical advice.")
                    .font(.caption2).foregroundStyle(.tertiary)
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(result.scanMode.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ShareLink(item: shareText) { Image(systemName: "square.and.arrow.up") }
        }
    }

    private var sortedItems: [ScanItem] {
        result.scanMode == .menu ? result.items.sorted { $0.score > $1.score } : result.items
    }

    private var header: some View {
        HStack(spacing: 16) {
            ScoreRing(score: result.healthScore, size: 84, lineWidth: 9)
            VStack(alignment: .leading, spacing: 6) {
                Text(Theme.scoreLabel(result.healthScore))
                    .font(.title3.weight(.bold))
                    .foregroundStyle(Theme.scoreColor(result.healthScore))
                if let summary = result.summary { Text(summary).font(.subheadline) }
                Text(result.date.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .card()
    }

    private var macrosCard: some View {
        let m = result.computedMacros
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(Int(m.kcal))").font(.largeTitle.weight(.bold)).monospacedDigit()
                Text("kcal").foregroundStyle(.secondary)
                Spacer()
                Image(systemName: "flame.fill").foregroundStyle(Theme.eaten)
            }
            MacroBar(macros: m)
        }
        .card()
    }

    private var shareText: String {
        var lines = ["NutriScan · \(result.scanMode.title) · score \(String(format: "%.1f", result.healthScore))/10"]
        if let s = result.summary { lines.append(s) }
        for i in sortedItems.prefix(10) { lines.append("• \(i.name) — \(String(format: "%.1f", i.score))") }
        return lines.joined(separator: "\n")
    }

    private func choose(_ alt: String, for item: ScanItem, selected: Bool) async {
        guard let idx = result.items.firstIndex(where: { $0.id == item.id }) else { return }
        let previous = result.items[idx].selectedAlternative
        result.items[idx].selectedAlternative = selected ? alt : nil
        do {
            try await model.api.selectSwap(scanId: result.id, original: item.name, chosen: alt, selected: selected)
            swapError = nil
        } catch {
            result.items[idx].selectedAlternative = previous
            swapError = error.localizedDescription
        }
    }
}

private struct ItemCard: View {
    var item: ScanItem
    var mode: ScanModeOption
    var onChoose: (String, Bool) -> Void
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(item.name).font(.subheadline.weight(.semibold))
                        if item.isUnplanned == true {
                            Text("Unplanned").font(.caption2.weight(.bold))
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Theme.ok.opacity(0.2), in: Capsule()).foregroundStyle(Theme.ok)
                        } else if item.isUnplanned == false {
                            Text("In plan").font(.caption2.weight(.bold))
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Theme.good.opacity(0.2), in: Capsule()).foregroundStyle(Theme.good)
                        }
                        if item.isNonFood == true {
                            Text("Not food").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                        }
                    }
                    if let q = item.quantity, !q.isEmpty { Text(q).font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
                ScorePill(score: item.score)
            }

            if let m = item.macros, item.isNonFood != true, m.kcal > 0 {
                HStack(spacing: 12) {
                    macro("kcal", m.kcal)
                    macro("P", m.protein)
                    macro("C", m.carbs)
                    macro("F", m.fat)
                    if let c = item.confidence, c < 60 {
                        Spacer()
                        Label("\(Int(c))%", systemImage: "questionmark.circle").font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }

            if let possible = item.possibleItems, !possible.isEmpty {
                Text("Could be: " + possible.joined(separator: ", ")).font(.caption).foregroundStyle(.secondary)
            }

            if let reason = item.reason, !reason.isEmpty {
                Text(reason).font(.footnote)
                    .lineLimit(expanded ? nil : 3)
                    .onTapGesture { withAnimation { expanded.toggle() } }
            }
            if let c = item.complianceReason, !c.isEmpty, expanded {
                Text(c).font(.caption).foregroundStyle(.secondary)
            }

            if let nutrients = item.keyNutrients, !nutrients.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(nutrients, id: \.self) { n in
                            Text("\(n.label) \(n.value)")
                                .font(.caption2.weight(.medium))
                                .padding(.horizontal, 8).padding(.vertical, 4)
                                .background((n.isHigh == true ? Theme.ok : Color.secondary).opacity(0.14), in: Capsule())
                        }
                    }
                }
            }

            if let alts = item.alternatives, !alts.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text(mode == .menu ? "Better picks" : "Healthier swaps — tap one you'll try")
                        .font(.caption.weight(.semibold)).foregroundStyle(Theme.brand)
                    ForEach(alts, id: \.self) { alt in
                        let chosen = item.selectedAlternative == alt
                        Button {
                            onChoose(alt, !chosen)
                        } label: {
                            HStack {
                                Image(systemName: chosen ? "checkmark.circle.fill" : "arrow.triangle.swap")
                                Text(alt).multilineTextAlignment(.leading)
                                Spacer()
                            }
                            .font(.footnote)
                            .padding(10)
                            .background((chosen ? Theme.good : Theme.brand).opacity(chosen ? 0.18 : 0.08),
                                        in: RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .card()
    }

    private func macro(_ label: String, _ v: Double?) -> some View {
        HStack(spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text("\(Int((v ?? 0).rounded()))").font(.caption.weight(.semibold)).monospacedDigit()
        }
    }
}
