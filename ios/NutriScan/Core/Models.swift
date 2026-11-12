import Foundation

// MARK: - Lenient number decoding
// The API is fed by an LLM, so numbers occasionally arrive as strings.

extension KeyedDecodingContainer {
    func flexDouble(_ key: Key) -> Double? {
        if let v = try? decodeIfPresent(Double.self, forKey: key) { return v }
        if let v = try? decodeIfPresent(Int.self, forKey: key) { return Double(v) }
        if let s = try? decodeIfPresent(String.self, forKey: key) {
            return Double(s.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ""))
        }
        return nil
    }

    func flexString(_ key: Key) -> String? {
        if let s = try? decodeIfPresent(String.self, forKey: key) { return s }
        if let i = try? decodeIfPresent(Int.self, forKey: key) { return String(i) }
        if let d = try? decodeIfPresent(Double.self, forKey: key) { return String(d) }
        return nil
    }
}

enum APIDate {
    private static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f
    }()
    private static let day: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = .current; f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func parse(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        return withFraction.date(from: s) ?? plain.date(from: s) ?? day.date(from: String(s.prefix(10)))
    }

    static func iso(_ d: Date) -> String { withFraction.string(from: d) }
    static func dayKey(_ d: Date) -> String { day.string(from: d) }
    static func fromDayKey(_ s: String) -> Date? { day.date(from: s) }
}

// MARK: - Auth

struct Account: Codable, Equatable {
    var email: String?
    var name: String?
    var picture: String?
    var provider: String?
    var bnClientId: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        email = try c.decodeIfPresent(String.self, forKey: .email)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        picture = try c.decodeIfPresent(String.self, forKey: .picture)
        provider = try c.decodeIfPresent(String.self, forKey: .provider)
        bnClientId = c.flexString(.bnClientId)
    }
}

struct AuthResponse: Decodable {
    var accessToken: String
    var refreshToken: String
    var userId: String?
    var account: Account?
    var guest: Bool?
    var guestSecret: String?
    var isNewAccount: Bool?

    enum CodingKeys: String, CodingKey { case token, accessToken, refreshToken, userId, account, guest, guestSecret, isNewAccount }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let access = try c.decodeIfPresent(String.self, forKey: .accessToken) ?? c.decodeIfPresent(String.self, forKey: .token) else {
            throw DecodingError.keyNotFound(CodingKeys.accessToken, .init(codingPath: [], debugDescription: "No access token"))
        }
        accessToken = access
        refreshToken = try c.decode(String.self, forKey: .refreshToken)
        userId = c.flexString(.userId)
        account = try c.decodeIfPresent(Account.self, forKey: .account)
        guest = try c.decodeIfPresent(Bool.self, forKey: .guest)
        guestSecret = try c.decodeIfPresent(String.self, forKey: .guestSecret)
        isNewAccount = try c.decodeIfPresent(Bool.self, forKey: .isNewAccount)
    }
}

struct MeResponse: Decodable {
    var userId: String?
    var account: Account?
    enum CodingKeys: String, CodingKey { case userId, account }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        userId = c.flexString(.userId)
        account = try c.decodeIfPresent(Account.self, forKey: .account)
    }
}

struct ClientConfig: Decodable {
    struct Auth: Decodable {
        var apiKey: String
        var projectId: String
        var providers: [String]?
        var enabledProviders: [String]?
    }
    var auth: Auth?
    var guestMode: Bool?

    /// Google is usable when the server has Firebase configured and hasn't reported it disabled.
    var googleAvailable: Bool {
        guard let auth else { return false }
        if let enabled = auth.enabledProviders { return enabled.contains("google") }
        return (auth.providers ?? ["google"]).contains("google")
    }
}

// MARK: - Scans

struct Macros: Codable, Equatable, Hashable {
    var calories: Double?
    var protein: Double?
    var carbs: Double?
    var fat: Double?

    init(calories: Double? = nil, protein: Double? = nil, carbs: Double? = nil, fat: Double? = nil) {
        self.calories = calories; self.protein = protein; self.carbs = carbs; self.fat = fat
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        calories = c.flexDouble(.calories)
        protein = c.flexDouble(.protein)
        carbs = c.flexDouble(.carbs)
        fat = c.flexDouble(.fat)
    }

    /// Calories, or an estimate from macros when the API left them out.
    var kcal: Double {
        if let calories, calories > 0 { return calories }
        return (protein ?? 0) * 4 + (carbs ?? 0) * 4 + (fat ?? 0) * 9
    }

    static func + (a: Macros, b: Macros) -> Macros {
        Macros(calories: a.kcal + b.kcal, protein: (a.protein ?? 0) + (b.protein ?? 0),
               carbs: (a.carbs ?? 0) + (b.carbs ?? 0), fat: (a.fat ?? 0) + (b.fat ?? 0))
    }
}

struct KeyNutrient: Codable, Hashable {
    var label: String
    var value: String
    var isHigh: Bool?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        label = (try? c.decode(String.self, forKey: .label)) ?? ""
        value = c.flexString(.value) ?? ""
        isHigh = try? c.decodeIfPresent(Bool.self, forKey: .isHigh)
    }
}

struct ScanItem: Codable, Identifiable, Hashable {
    var id: String { name + "|" + (quantity ?? "") }
    var name: String
    var quantity: String?
    var macros: Macros?
    var confidence: Double?
    var possibleItems: [String]?
    var keyNutrients: [KeyNutrient]?
    var score: Double
    var isNonFood: Bool?
    var isUnplanned: Bool?
    var complianceReason: String?
    var lifestyleCategory: String?
    var category: String?
    var reason: String?
    var alternatives: [String]?
    var selectedAlternative: String?

    enum CodingKeys: String, CodingKey {
        case name, quantity, macros, confidence, possibleItems, keyNutrients, score, isNonFood, isUnplanned,
             complianceReason, lifestyleCategory, category, reason, alternatives, selectedAlternative
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = (try? c.decode(String.self, forKey: .name)) ?? "Item"
        quantity = c.flexString(.quantity)
        macros = try? c.decodeIfPresent(Macros.self, forKey: .macros)
        confidence = c.flexDouble(.confidence)
        possibleItems = try? c.decodeIfPresent([String].self, forKey: .possibleItems)
        keyNutrients = try? c.decodeIfPresent([KeyNutrient].self, forKey: .keyNutrients)
        score = c.flexDouble(.score) ?? 0
        isNonFood = try? c.decodeIfPresent(Bool.self, forKey: .isNonFood)
        isUnplanned = try? c.decodeIfPresent(Bool.self, forKey: .isUnplanned)
        complianceReason = try? c.decodeIfPresent(String.self, forKey: .complianceReason)
        lifestyleCategory = try? c.decodeIfPresent(String.self, forKey: .lifestyleCategory)
        category = try? c.decodeIfPresent(String.self, forKey: .category)
        reason = try? c.decodeIfPresent(String.self, forKey: .reason)
        alternatives = try? c.decodeIfPresent([String].self, forKey: .alternatives)
        selectedAlternative = try? c.decodeIfPresent(String.self, forKey: .selectedAlternative)
    }
}

/// One analysed scan. Used both for a fresh POST /analyze response and for
/// entries in GET /results (which add id/scanMode/timestamp/createdAt).
struct ScanResult: Codable, Identifiable, Hashable {
    var id: String
    var mode: String
    var restaurantName: String?
    var items: [ScanItem]
    var healthScore: Double
    var summary: String?
    var mentorsNote: String?
    var totalMacros: Macros?
    var date: Date

    enum CodingKeys: String, CodingKey {
        case id, scanId, scanMode, type, restaurantName, items, healthScore, summary, mentorsNote, totalMacros, timestamp, createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.flexString(.id) ?? c.flexString(.scanId) ?? UUID().uuidString
        let rawMode: String? = (try? c.decodeIfPresent(String.self, forKey: .scanMode)) ?? (try? c.decodeIfPresent(String.self, forKey: .type))
        let m = (rawMode ?? "PLATE").uppercased()
        mode = m == "MEAL" ? "PLATE" : m
        restaurantName = try? c.decodeIfPresent(String.self, forKey: .restaurantName)
        items = (try? c.decodeIfPresent([ScanItem].self, forKey: .items)) ?? []
        healthScore = c.flexDouble(.healthScore) ?? 0
        summary = try? c.decodeIfPresent(String.self, forKey: .summary)
        mentorsNote = try? c.decodeIfPresent(String.self, forKey: .mentorsNote)
        totalMacros = try? c.decodeIfPresent(Macros.self, forKey: .totalMacros)
        let ts: String? = try? c.decodeIfPresent(String.self, forKey: .timestamp)
        let created: String? = try? c.decodeIfPresent(String.self, forKey: .createdAt)
        date = APIDate.parse(ts) ?? APIDate.parse(created) ?? .now
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(mode, forKey: .scanMode)
        try c.encodeIfPresent(restaurantName, forKey: .restaurantName)
        try c.encode(items, forKey: .items)
        try c.encode(healthScore, forKey: .healthScore)
        try c.encodeIfPresent(summary, forKey: .summary)
        try c.encodeIfPresent(mentorsNote, forKey: .mentorsNote)
        try c.encodeIfPresent(totalMacros, forKey: .totalMacros)
        try c.encode(APIDate.iso(date), forKey: .timestamp)
    }

    var scanMode: ScanModeOption {
        ScanModeOption(rawValue: mode.lowercased()) ?? .plate
    }

    var foodItems: [ScanItem] { items.filter { $0.isNonFood != true } }

    /// Totals from item macros (the API's totalMacros omits calories in history).
    var computedMacros: Macros {
        let fromItems = foodItems.compactMap(\.macros).reduce(Macros(calories: 0, protein: 0, carbs: 0, fat: 0), +)
        if fromItems.kcal > 0 { return fromItems }
        return totalMacros ?? fromItems
    }

    var title: String {
        if let r = restaurantName, !r.isEmpty { return r }
        let names = foodItems.prefix(3).map(\.name)
        if names.isEmpty { return scanMode.title }
        return names.joined(separator: ", ") + (foodItems.count > 3 ? " +\(foodItems.count - 3)" : "")
    }
}

struct HistoryResponse: Decodable {
    var total: Int?
    var history: [ScanResult]
}

// MARK: - Health

struct HealthValues: Codable, Hashable {
    var steps: Double?
    var activeKcal: Double?
    var restingKcal: Double?
    var exerciseMinutes: Double?
    var distanceKm: Double?
    var sleepHours: Double?
    var weightKg: Double?
    var restingHr: Double?
    var workouts: [Workout]?

    struct Workout: Codable, Hashable {
        var type: String?
        var start: String?
        var minutes: Double?
        var kcal: Double?
        var distanceKm: Double?
    }
}

struct EatenTotals: Codable, Hashable {
    var kcal: Double
    var protein: Double
    var carbs: Double
    var fat: Double
    var meals: Int
}

struct HealthDay: Codable, Identifiable, Hashable {
    var id: String { date }
    var date: String
    var health: HealthValues?
    var eaten: EatenTotals?
    var burnedKcal: Double?
    var netKcal: Double?

    var day: Date { APIDate.fromDayKey(date) ?? .now }
}

struct HealthInsight: Codable, Hashable, Identifiable {
    var id: String { text }
    var kind: String
    var text: String
}

struct HealthSummary: Codable {
    var connected: Bool
    var lastSyncAt: String?
    var timeZone: String?
    var days: [HealthDay]
    var insights: [HealthInsight]

    var today: HealthDay? { days.last }
}

struct HealthKeyResponse: Decodable {
    var key: String
    var ingestUrl: String?
}

struct HealthStatus: Decodable {
    var connected: Bool
    var createdAt: String?
    var lastSyncAt: String?
}

struct IngestResponse: Decodable {
    var status: String?
    var daysSaved: Int?
    var from: String?
    var to: String?
}

// MARK: - Shopping habits

struct ShoppingHabits: Decodable {
    struct FrequentItem: Decodable, Hashable, Identifiable {
        var id: String { name }
        var name: String
        var count: Int
    }
    struct Receipt: Decodable, Hashable, Identifiable {
        var id: String { (date ?? "") + "\(healthScore ?? 0)" }
        var date: String?
        var healthScore: Double?
        var itemCount: Int?
        var totalCalories: Double?
        var day: Date? { APIDate.parse(date) }
    }
    struct MacroTrends: Decodable { var avgProtein: Double?; var avgCarbs: Double?; var avgFat: Double? }
    struct Insights: Decodable { var topCategory: String?; var avgHealthScore: Double?; var totalItemsTracked: Int? }

    var totalReceiptScans: Int?
    var frequentItems: [FrequentItem]?
    var categoryDistribution: [String: Double]?
    var macroTrends: MacroTrends?
    var receiptHistory: [Receipt]?
    var insights: Insights?
}

struct OKResponse: Decodable { var status: String? }
