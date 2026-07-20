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
    let isTestDecision: Bool?
    let environment: String?
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
    /// Optional volume-profile / structure levels for the dashboard.
    let marketStructure: MarketStructure?
    /// Optional explicit workflow actions; falls back to defaults when absent.
    let recommendedActions: [RecommendedTradeAction]?
    /// Optional short label for mock scenario pickers.
    let scenarioName: String?

    var id: String { decisionId }

    var isExpired: Bool { validUntil < Date() }
    var isStale: Bool { dataQuality == .stale || dataSourceLabel == .stale || dataSourceLabel == .offline }
    var shouldShowTestBadge: Bool { isTestDecision == true || environment == "TEST" }

    var display: DecisionDisplay { DecisionDisplay(decision: self) }

    var actionsForDisplay: [RecommendedTradeAction] {
        if let recommendedActions, !recommendedActions.isEmpty {
            return recommendedActions
        }
        return RecommendedTradeAction.defaults(
            for: decision,
            breakeven: breakeven.state,
            earlyExit: earlyExit.exitNow
        )
    }

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

struct MarketStructure: Codable, Equatable {
    let trend: String
    let poc: Double?
    let vah: Double?
    let val: Double?

    var trendDisplay: String {
        trend.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

/// Formatted values for the XAUUSD dashboard and unit tests.
struct DecisionDisplay: Equatable {
    let decisionLabel: String
    let confidenceText: String
    let confidenceDetail: String
    let currentPriceText: String
    let trendText: String
    let pocText: String
    let vahText: String
    let valText: String
    let entryText: String
    let stopLossText: String
    let tp1Text: String
    let tp2Text: String
    let tp3Text: String
    let riskRewardText: String
    let supportingReasons: [String]
    let opposingReasons: [String]
    let actionTitles: [String]
    let scenarioTitle: String

    init(decision: Decision) {
        decisionLabel = decision.decision.rawValue
        confidenceText = decision.confidence.percentText
        confidenceDetail = decision.confidenceLabel.displayName
        currentPriceText = decision.lastKnownPrice?.xauPrice ?? "—"
        trendText = decision.marketStructure?.trendDisplay
            ?? decision.higherTimeframeBias?.rawValue.capitalized
            ?? decision.marketRegime.displayName
        pocText = decision.marketStructure?.poc?.xauPrice ?? "—"
        vahText = decision.marketStructure?.vah?.xauPrice ?? "—"
        valText = decision.marketStructure?.val?.xauPrice ?? "—"
        entryText = decision.entry.displayPrice
        stopLossText = decision.stopLoss.price?.xauPrice ?? "—"
        let tpMap = Dictionary(uniqueKeysWithValues: decision.takeProfits.map { ($0.label.uppercased(), $0.price.xauPrice) })
        tp1Text = tpMap["TP1"] ?? "—"
        tp2Text = tpMap["TP2"] ?? "—"
        tp3Text = tpMap["TP3"] ?? "—"
        riskRewardText = decision.riskReward.bestAvailable?.ratioText ?? "—"
        supportingReasons = decision.decision == .sell ? decision.bearishEvidence : decision.bullishEvidence
        opposingReasons = decision.decision == .sell ? decision.bullishEvidence : decision.bearishEvidence
        actionTitles = decision.actionsForDisplay.map(\.title)
        scenarioTitle = decision.scenarioName
            ?? "\(decision.decision.rawValue) · \(decision.confidenceLabel.displayName)"
    }
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
