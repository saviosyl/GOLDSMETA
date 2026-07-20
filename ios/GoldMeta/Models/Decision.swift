import Foundation

struct Decision: Codable, Identifiable, Equatable {
    let schemaVersion: String
    let decisionId: String
    let symbol: String
    let generatedAt: Date
    let marketDataTime: Date
    let validUntil: Date
    let decision: DecisionType
    let confidence: Double
    let confidenceLabel: ConfidenceLabel
    let marketRegime: MarketRegime
    let dataQuality: DataQuality
    let isProvisional: Bool
    let setupScore: Double
    let entry: EntryPlan
    let stopLoss: StopLossPlan
    let takeProfits: [TakeProfitPlan]
    let riskReward: RiskReward
    let breakeven: BreakevenPlan
    let earlyExit: EarlyExitPlan
    let bullishEvidence: [String]
    let bearishEvidence: [String]
    let reasonCodes: [String]
    let reasonSummary: [String]
    let warnings: [String]
    let missingInputs: [String]
    let invalidation: String
    let disclaimer: String
    let lifecycleState: LifecycleState
    let snapshotId: String?
    let ruleConfigVersion: String
    let pineScriptVersion: String?
    let backendVersion: String
    let aiModelId: String?
    let aiPromptVersion: String?
    let aiSafetyDowngraded: Bool
    let notificationSent: Bool
    let currentSession: String?
    let higherTimeframeBias: HigherTimeframeBias?
    let lastKnownPrice: Double?
    let dataSourceLabel: DataSourceLabel

    var id: String { decisionId }

    var isExpired: Bool { validUntil < Date() }
    var isStale: Bool { dataQuality == .stale || dataSourceLabel == .stale || dataSourceLabel == .offline }

    static let jsonDecoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()

    static let jsonEncoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }()
}

struct EntryPlan: Codable, Equatable {
    let type: EntryType
    let price: Double?
    let zoneLow: Double?
    let zoneHigh: Double?
    let condition: String?

    var displayPrice: String {
        if let price { return price.xauPrice }
        if let zoneLow, let zoneHigh { return "\(zoneLow.xauPrice) - \(zoneHigh.xauPrice)" }
        return "Wait"
    }
}

struct StopLossPlan: Codable, Equatable {
    let price: Double?
    let reason: String?
}

struct TakeProfitPlan: Codable, Equatable, Identifiable {
    let label: String
    let price: Double
    let reason: String

    var id: String { label }
}

struct RiskReward: Codable, Equatable {
    let tp1: Double?
    let tp2: Double?
    let tp3: Double?

    var bestAvailable: Double? { [tp3, tp2, tp1].compactMap { $0 }.first }
}

struct BreakevenPlan: Codable, Equatable {
    let state: BreakevenState
    let trigger: String?
    let newStop: Double?
    let reason: String?
}

struct EarlyExitPlan: Codable, Equatable {
    let exitNow: Bool
    let conditions: [String]
}

extension Double {
    var xauPrice: String { String(format: "%.2f", self) }
    var percentText: String { String(format: "%.0f%%", self) }
    var ratioText: String { String(format: "%.2fR", self) }
}

extension Date {
    var relativeShort: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: self, relativeTo: Date())
    }

    var shortDateTime: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: self)
    }
}
