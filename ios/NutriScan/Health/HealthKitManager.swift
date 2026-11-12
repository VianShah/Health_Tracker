import Foundation
import HealthKit

/// Reads daily totals from Apple Health. Read-only: NutriScan never writes.
/// Replaces the "Health Auto Export / Shortcut" setup the web app needs —
/// the native app reads HealthKit itself and pushes to /api/v1/health/ingest.
final class HealthKitManager {
    static let shared = HealthKitManager()
    private let store = HKHealthStore()

    var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    private var readTypes: Set<HKObjectType> {
        var types: Set<HKObjectType> = [
            HKQuantityType(.stepCount),
            HKQuantityType(.activeEnergyBurned),
            HKQuantityType(.basalEnergyBurned),
            HKQuantityType(.appleExerciseTime),
            HKQuantityType(.distanceWalkingRunning),
            HKQuantityType(.bodyMass),
            HKQuantityType(.restingHeartRate),
            HKCategoryType(.sleepAnalysis),
        ]
        types.insert(HKObjectType.workoutType())
        return types
    }

    /// Shows Apple's permission sheet (only the first time, or for new types).
    func requestAuthorization() async throws {
        guard isAvailable else { throw HealthError.unavailable }
        try await store.requestAuthorization(toShare: [], read: readTypes)
    }

    /// Whether we've already shown the permission sheet. (iOS never reveals
    /// whether *read* access was granted — denied reads just return no data.)
    func hasRequestedAuthorization() async -> Bool {
        guard isAvailable else { return false }
        let status = try? await store.statusForAuthorizationRequest(toShare: [], read: readTypes)
        return status == .unnecessary
    }

    enum HealthError: LocalizedError {
        case unavailable
        var errorDescription: String? { "Apple Health isn't available on this device." }
    }

    // MARK: - Daily summaries

    struct Day {
        var date: Date
        var steps: Double?
        var activeKcal: Double?
        var restingKcal: Double?
        var exerciseMinutes: Double?
        var distanceKm: Double?
        var sleepHours: Double?
        var weightKg: Double?
        var restingHr: Double?
        var workouts: [[String: Any]] = []

        var hasData: Bool {
            [steps, activeKcal, restingKcal, exerciseMinutes, distanceKm, sleepHours, weightKg, restingHr]
                .contains { $0 != nil } || !workouts.isEmpty
        }

        /// The "simple day" format accepted by POST /health/ingest.
        var payload: [String: Any] {
            var d: [String: Any] = ["date": APIDate.dayKey(date)]
            func put(_ k: String, _ v: Double?, _ dp: Double = 1) { if let v { d[k] = (v * dp).rounded() / dp } }
            put("steps", steps)
            put("activeCalories", activeKcal)
            put("restingCalories", restingKcal)
            put("exerciseMinutes", exerciseMinutes)
            put("distanceKm", distanceKm, 100)
            put("sleepHours", sleepHours, 10)
            put("weightKg", weightKg, 10)
            put("restingHr", restingHr)
            if !workouts.isEmpty { d["workouts"] = workouts }
            return d
        }
    }

    /// The last `count` days including today, oldest first.
    func dailySummaries(days count: Int) async throws -> [Day] {
        guard isAvailable else { throw HealthError.unavailable }
        let cal = Calendar.current
        let todayStart = cal.startOfDay(for: .now)
        guard let start = cal.date(byAdding: .day, value: -(count - 1), to: todayStart) else { return [] }
        let end = Date.now

        var days: [Date: Day] = [:]
        for i in 0..<count {
            let d = cal.date(byAdding: .day, value: i, to: start)!
            days[d] = Day(date: d)
        }

        async let steps = sums(.stepCount, unit: .count(), from: start, to: end)
        async let active = sums(.activeEnergyBurned, unit: .kilocalorie(), from: start, to: end)
        async let basal = sums(.basalEnergyBurned, unit: .kilocalorie(), from: start, to: end)
        async let exercise = sums(.appleExerciseTime, unit: .minute(), from: start, to: end)
        async let distance = sums(.distanceWalkingRunning, unit: .meterUnit(with: .kilo), from: start, to: end)
        async let weight = averages(.bodyMass, unit: .gramUnit(with: .kilo), from: start, to: end)
        async let restingHr = averages(.restingHeartRate, unit: .count().unitDivided(by: .minute()), from: start, to: end)
        // Sleep that ended on a given day counts for that day, so start a day earlier.
        async let sleep = sleepHours(from: cal.date(byAdding: .hour, value: -18, to: start)!, to: end)
        async let workoutMap = workouts(from: start, to: end)

        let (s, a, b, e, dist, w, hr, sl, wo) = try await (steps, active, basal, exercise, distance, weight, restingHr, sleep, workoutMap)

        for key in days.keys {
            days[key]?.steps = s[key]
            days[key]?.activeKcal = a[key]
            days[key]?.restingKcal = b[key]
            days[key]?.exerciseMinutes = e[key]
            days[key]?.distanceKm = dist[key]
            days[key]?.weightKg = w[key]
            days[key]?.restingHr = hr[key]
            days[key]?.sleepHours = sl[key]
            days[key]?.workouts = wo[key] ?? []
        }
        return days.values.sorted { $0.date < $1.date }
    }

    /// Today's step count, for the widget between server refreshes.
    func todaySteps() async -> Double? {
        let start = Calendar.current.startOfDay(for: .now)
        return (try? await sums(.stepCount, unit: .count(), from: start, to: .now))?[start]
    }

    // MARK: - Queries

    private func collection(_ id: HKQuantityTypeIdentifier, options: HKStatisticsOptions, from: Date, to: Date) async throws -> HKStatisticsCollection {
        let type = HKQuantityType(id)
        let predicate = HKQuery.predicateForSamples(withStart: from, end: to, options: .strictStartDate)
        let descriptor = HKStatisticsCollectionQueryDescriptor(
            predicate: .quantitySample(type: type, predicate: predicate),
            options: options,
            anchorDate: Calendar.current.startOfDay(for: from),
            intervalComponents: DateComponents(day: 1))
        return try await descriptor.result(for: store)
    }

    private func sums(_ id: HKQuantityTypeIdentifier, unit: HKUnit, from: Date, to: Date) async throws -> [Date: Double] {
        let stats = try await collection(id, options: .cumulativeSum, from: from, to: to)
        var out: [Date: Double] = [:]
        stats.enumerateStatistics(from: from, to: to) { s, _ in
            if let q = s.sumQuantity() { out[Calendar.current.startOfDay(for: s.startDate)] = q.doubleValue(for: unit) }
        }
        return out
    }

    private func averages(_ id: HKQuantityTypeIdentifier, unit: HKUnit, from: Date, to: Date) async throws -> [Date: Double] {
        let stats = try await collection(id, options: .discreteAverage, from: from, to: to)
        var out: [Date: Double] = [:]
        stats.enumerateStatistics(from: from, to: to) { s, _ in
            if let q = s.averageQuantity() { out[Calendar.current.startOfDay(for: s.startDate)] = q.doubleValue(for: unit) }
        }
        return out
    }

    /// Hours asleep per wake-up day. Overlapping samples (iPhone + Watch) are merged.
    private func sleepHours(from: Date, to: Date) async throws -> [Date: Double] {
        let predicate = HKQuery.predicateForSamples(withStart: from, end: to)
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.categorySample(type: HKCategoryType(.sleepAnalysis), predicate: predicate)],
            sortDescriptors: [SortDescriptor(\.startDate)])
        let samples = try await descriptor.result(for: store)

        let asleepValues: Set<Int> = [
            HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
            HKCategoryValueSleepAnalysis.asleepCore.rawValue,
            HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
            HKCategoryValueSleepAnalysis.asleepREM.rawValue,
        ]
        let intervals = samples.filter { asleepValues.contains($0.value) }.map { ($0.startDate, $0.endDate) }

        // Merge overlaps.
        var merged: [(Date, Date)] = []
        for iv in intervals.sorted(by: { $0.0 < $1.0 }) {
            if let last = merged.last, iv.0 <= last.1 {
                merged[merged.count - 1].1 = max(last.1, iv.1)
            } else {
                merged.append(iv)
            }
        }

        var out: [Date: Double] = [:]
        for (s, e) in merged {
            let day = Calendar.current.startOfDay(for: e)
            out[day, default: 0] += e.timeIntervalSince(s) / 3600
        }
        return out
    }

    private func workouts(from: Date, to: Date) async throws -> [Date: [[String: Any]]] {
        let predicate = HKQuery.predicateForSamples(withStart: from, end: to, options: .strictStartDate)
        let descriptor = HKSampleQueryDescriptor(predicates: [.workout(predicate)], sortDescriptors: [SortDescriptor(\.startDate)])
        let workouts = try await descriptor.result(for: store)

        var out: [Date: [[String: Any]]] = [:]
        for w in workouts.prefix(60) {
            var item: [String: Any] = [
                "type": w.workoutActivityType.displayName,
                "start": APIDate.iso(w.startDate),
                "minutes": (w.duration / 60).rounded(),
            ]
            if let kcal = w.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie()) {
                item["kcal"] = kcal.rounded()
            }
            if let km = w.totalDistance?.doubleValue(for: .meterUnit(with: .kilo)) {
                item["distanceKm"] = (km * 100).rounded() / 100
            }
            out[Calendar.current.startOfDay(for: w.startDate), default: []].append(item)
        }
        return out
    }
}

extension HKWorkoutActivityType {
    var displayName: String {
        switch self {
        case .walking: return "Walking"
        case .running: return "Running"
        case .cycling: return "Cycling"
        case .swimming: return "Swimming"
        case .yoga: return "Yoga"
        case .hiking: return "Hiking"
        case .elliptical: return "Elliptical"
        case .rowing: return "Rowing"
        case .traditionalStrengthTraining: return "Strength Training"
        case .functionalStrengthTraining: return "Functional Training"
        case .highIntensityIntervalTraining: return "HIIT"
        case .dance, .socialDance, .cardioDance: return "Dance"
        case .pilates: return "Pilates"
        case .coreTraining: return "Core Training"
        case .mixedCardio: return "Cardio"
        case .stairClimbing, .stairs: return "Stairs"
        case .badminton: return "Badminton"
        case .tennis: return "Tennis"
        case .cricket: return "Cricket"
        case .soccer: return "Football"
        case .basketball: return "Basketball"
        case .mindAndBody: return "Mind & Body"
        case .cooldown: return "Cooldown"
        default: return "Workout"
        }
    }
}
