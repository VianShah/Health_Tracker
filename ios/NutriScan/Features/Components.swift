import SwiftUI

enum Theme {
    static let brand = Color("AccentColor")
    static let good = Color(red: 0.08, green: 0.72, blue: 0.48)
    static let ok = Color(red: 0.96, green: 0.65, blue: 0.14)
    static let bad = Color(red: 0.91, green: 0.30, blue: 0.24)
    static let eaten = Color(red: 0.98, green: 0.52, blue: 0.20)
    static let burned = Color(red: 0.20, green: 0.55, blue: 0.95)
    static let water = Color(red: 0.16, green: 0.66, blue: 0.96)

    static func scoreColor(_ score: Double) -> Color {
        score >= 7 ? good : score >= 4.5 ? ok : bad
    }

    static func scoreLabel(_ score: Double) -> String {
        score >= 8 ? "Excellent" : score >= 7 ? "Good" : score >= 4.5 ? "Fair" : "Needs work"
    }
}

struct CardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

extension View {
    func card() -> some View { modifier(CardModifier()) }
}

/// Circular 0–10 score.
struct ScoreRing: View {
    var score: Double
    var size: CGFloat = 64
    var lineWidth: CGFloat = 7

    var body: some View {
        ZStack {
            Circle().stroke(Theme.scoreColor(score).opacity(0.18), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: max(0.02, min(1, score / 10)))
                .stroke(Theme.scoreColor(score), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text(score, format: .number.precision(.fractionLength(score.truncatingRemainder(dividingBy: 1) == 0 ? 0 : 1)))
                .font(.system(size: size * 0.32, weight: .bold, design: .rounded))
                .monospacedDigit()
        }
        .frame(width: size, height: size)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Health score \(score, specifier: "%.1f") out of 10")
    }
}

struct ScorePill: View {
    var score: Double
    var body: some View {
        Text(score, format: .number.precision(.fractionLength(1)))
            .font(.caption.weight(.bold)).monospacedDigit()
            .padding(.horizontal, 8).padding(.vertical, 3)
            .foregroundStyle(.white)
            .background(Theme.scoreColor(score), in: Capsule())
    }
}

struct MacroBar: View {
    var macros: Macros

    var body: some View {
        let p = (macros.protein ?? 0) * 4, c = (macros.carbs ?? 0) * 4, f = (macros.fat ?? 0) * 9
        let total = max(1, p + c + f)
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { geo in
                HStack(spacing: 2) {
                    Rectangle().fill(Color.purple).frame(width: geo.size.width * p / total)
                    Rectangle().fill(Color.orange).frame(width: geo.size.width * c / total)
                    Rectangle().fill(Color.pink).frame(width: geo.size.width * f / total)
                }
                .clipShape(Capsule())
            }
            .frame(height: 8)
            HStack {
                MacroLegend(color: .purple, label: "Protein", grams: macros.protein)
                Spacer()
                MacroLegend(color: .orange, label: "Carbs", grams: macros.carbs)
                Spacer()
                MacroLegend(color: .pink, label: "Fat", grams: macros.fat)
            }
        }
    }
}

struct MacroLegend: View {
    var color: Color
    var label: String
    var grams: Double?
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text("\(Int((grams ?? 0).rounded())) g").font(.caption.weight(.semibold)).monospacedDigit()
        }
    }
}

struct StatTile: View {
    var title: String
    var value: String
    var unit: String? = nil
    var symbol: String
    var tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: symbol)
                .font(.caption.weight(.semibold))
                .foregroundStyle(tint)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value).font(.title2.weight(.bold)).monospacedDigit()
                if let unit { Text(unit).font(.caption).foregroundStyle(.secondary) }
            }
        }
        .card()
    }
}

struct ErrorBanner: View {
    var message: String
    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle.fill")
            .font(.footnote)
            .foregroundStyle(.white)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.bad.gradient, in: RoundedRectangle(cornerRadius: 12))
    }
}

extension Date {
    var relativeShort: String {
        formatted(.relative(presentation: .named, unitsStyle: .abbreviated))
    }
}
