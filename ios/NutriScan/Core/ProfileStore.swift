import Foundation

/// The nutrition profile sent with each scan (`userProfile` in POST /analyze).
/// For a linked Balance Nutrition client it is read from the BN API (same as the
/// web app); otherwise it comes from what the user typed in Settings > Profile.
struct NutritionProfile: Codable, Equatable {
    var name: String = ""
    var gender: String = ""
    var age: String = ""
    var heightCm: String = ""
    var currentWeightKg: String = ""
    var weightGoalKg: String = ""
    var eatingHabit: String = "Vegetarian"
    var healthGoal: String = "Weight Loss"
    var allergies: [String] = []
    var aversions: [String] = []

    static let eatingHabits = ["Vegetarian", "Non-Vegetarian", "Eggetarian", "Vegan", "Jain"]
    static let goals = ["Weight Loss", "Weight Gain", "Maintain Weight", "Muscle Gain", "Diabetes Control", "PCOS", "Heart Health", "Better Energy"]
}

@MainActor
final class ProfileStore: ObservableObject {
    private static let key = "nutrition.profile.v1"

    @Published var local: NutritionProfile {
        didSet { if let d = try? JSONEncoder().encode(local) { UserDefaults.standard.set(d, forKey: Self.key) } }
    }

    /// Cached BN client payload for the linked account (client_details/program_details/weight).
    @Published private(set) var bnClient: [String: Any]?
    private var bnClientFor: String?

    init() {
        if let d = UserDefaults.standard.data(forKey: Self.key), let p = try? JSONDecoder().decode(NutritionProfile.self, from: d) {
            local = p
        } else {
            local = NutritionProfile()
        }
    }

    var isLocalProfileEmpty: Bool { local.name.isEmpty && local.age.isEmpty && local.allergies.isEmpty }

    /// Builds the profile dictionary for /analyze.
    func profileForScan(session: StoredSession?) async -> [String: Any] {
        if let bnId = session?.account?.bnClientId, let bn = await loadBNClient(bnId) {
            return Self.profile(fromBN: bn, userId: bnId)
        }
        let p = local
        var out: [String: Any] = [
            "name": p.name.isEmpty ? (session?.account?.name ?? "Guest") : p.name,
            "gender": p.gender,
            "age": p.age,
            "height": p.heightCm.isEmpty ? "?" : p.heightCm,
            "eatingHabit": p.eatingHabit,
            "program": "Standard",
            "healthGoal": p.healthGoal,
            "allergies": p.allergies,
            "aversions": p.aversions,
            "dietPreference": [String](),
            "classification": "LEAD",
            "userId": session?.userId ?? "guest",
        ]
        if !p.currentWeightKg.isEmpty { out["currentWeight"] = p.currentWeightKg }
        if !p.weightGoalKg.isEmpty { out["weightGoal"] = p.weightGoalKg }
        return out
    }

    func loadBNClient(_ clientId: String, force: Bool = false) async -> [String: Any]? {
        if !force, bnClientFor == clientId, let bnClient { return bnClient }
        var comps = URLComponents(url: AppConfig.bnAPIBase.appendingPathComponent("client-details/get-single-client-by-user_id"),
                                  resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "user_id", value: clientId)]
        guard let url = comps.url,
              let response = try? await URLSession.shared.data(from: url),
              let json = (try? JSONSerialization.jsonObject(with: response.0)) as? [String: Any],
              let payload = json["data"] as? [String: Any] else { return nil }
        bnClient = payload
        bnClientFor = clientId
        return payload
    }

    func clearBN() { bnClient = nil; bnClientFor = nil }

    /// Mirrors the profile the web app builds in public/index.html.
    static func profile(fromBN data: [String: Any], userId: String) -> [String: Any] {
        let client = data["client_details"] as? [String: Any] ?? [:]
        let weight = data["weight"] as? [String: Any] ?? [:]
        let program = data["program_details"] as? [String: Any] ?? [:]
        let rawStatus = (client["user_status"] as? String ?? "").lowercased()
        let classification = rawStatus == "lead" ? "LEAD" : (rawStatus == "active" || rawStatus == "completed") ? "CLIENT" : "UNKNOWN"
        let subOrder = program["sub_order_id"] ?? NSNull()
        let activeOrder = program["sub_order_id"] ?? program["active_order_id"] ?? NSNull()

        return [
            "name": client["full_name"] ?? "",
            "gender": client["gender"] ?? "",
            "age": client["age"] ?? "",
            "height": client["height"] ?? "?",
            "eatingHabit": client["eating_habit"] ?? "",
            "program": program["program_name"] ?? "Standard",
            "healthGoal": client["health_goal"] ?? "Weight Loss",
            "state": client["sub_user_status"] ?? "",
            "weightGoal": weight["weight_goal"] ?? NSNull(),
            "currentWeight": weight["current_program_latest_weight"] ?? NSNull(),
            "allergies": client["allergies"] ?? [String](),
            "aversions": client["aversions"] ?? [String](),
            "dietPreference": client["food_preferences"] ?? [String](),
            "classification": classification,
            "rawUserStatus": client["user_status"] ?? "",
            "userId": userId,
            "subOrderId": subOrder,
            "activeOrderId": activeOrder,
        ]
    }

    /// Short description of the linked program for Settings.
    static func programSummary(_ data: [String: Any]?) -> String? {
        guard let data else { return nil }
        let client = data["client_details"] as? [String: Any] ?? [:]
        let program = data["program_details"] as? [String: Any] ?? [:]
        let name = program["program_name"] as? String
        let status = client["user_status"] as? String
        return [name, status].compactMap { $0 }.joined(separator: " · ").nilIfEmpty
    }
}

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
