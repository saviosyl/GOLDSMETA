import Foundation

struct UserSettings: Codable, Equatable {
    var hasCompletedOnboarding: Bool
    /// Legacy flag retained for older installs; prefer `tradingMode`.
    var paperTradingMode: Bool
    var tradingMode: TradingMode
    var autoTradingEnabled: Bool
    var emergencyStopActive: Bool
    var liveAutoUnlocked: Bool
    var liveAutoEnabledByUser: Bool
    var riskControls: TradingRiskControls
    var demoClosedTrades: Int
    var demoRequiredClosedTrades: Int
    var demoRequiredDays: Int
    var demoStartedAt: Date?
    var tradingDisclaimerAcknowledged: Bool
    var selectedBrokerId: String
    var riskPercent: Double
    var notificationsEnabled: Bool
    var webhookId: String
    var selectedMockFixtureIndex: Int
    var lastDisclaimerAcceptedAt: Date?

    var webhookURL: String {
        let base = AppConfig.current.apiBaseURL?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            ?? "https://YOUR_CLOUD_FUNCTIONS_URL"
        return "\(base)/webhooks/tradingview/\(webhookId)"
    }

    static let defaultRiskOptions: [Double] = [0.25, 0.5, 1.0]

    static let `default` = UserSettings(
        hasCompletedOnboarding: false,
        paperTradingMode: true,
        tradingMode: .manual,
        autoTradingEnabled: false,
        emergencyStopActive: false,
        liveAutoUnlocked: false,
        liveAutoEnabledByUser: false,
        riskControls: .default,
        demoClosedTrades: 0,
        demoRequiredClosedTrades: 20,
        demoRequiredDays: 7,
        demoStartedAt: nil,
        tradingDisclaimerAcknowledged: false,
        selectedBrokerId: "trading212_manual",
        riskPercent: 0.5,
        notificationsEnabled: false,
        webhookId: "mock-webhook-\(UUID().uuidString.prefix(8))",
        selectedMockFixtureIndex: 0,
        lastDisclaimerAcceptedAt: nil
    )

    var liveAutoLockReason: String? {
        guard tradingMode == .liveAuto || liveAutoEnabledByUser else {
            if !liveAutoUnlocked {
                return "Live Auto unlocks after \(demoRequiredClosedTrades) closed demo trades and \(demoRequiredDays) days of Demo Auto testing."
            }
            return nil
        }
        if !liveAutoUnlocked {
            return "Live Auto is locked. Demo progress: \(demoClosedTrades)/\(demoRequiredClosedTrades) trades."
        }
        return nil
    }

    enum CodingKeys: String, CodingKey {
        case hasCompletedOnboarding
        case paperTradingMode
        case tradingMode
        case autoTradingEnabled
        case emergencyStopActive
        case liveAutoUnlocked
        case liveAutoEnabledByUser
        case riskControls
        case demoClosedTrades
        case demoRequiredClosedTrades
        case demoRequiredDays
        case demoStartedAt
        case tradingDisclaimerAcknowledged
        case selectedBrokerId
        case riskPercent
        case notificationsEnabled
        case webhookId
        case selectedMockFixtureIndex
        case lastDisclaimerAcceptedAt
    }

    init(
        hasCompletedOnboarding: Bool,
        paperTradingMode: Bool,
        tradingMode: TradingMode,
        autoTradingEnabled: Bool,
        emergencyStopActive: Bool,
        liveAutoUnlocked: Bool,
        liveAutoEnabledByUser: Bool,
        riskControls: TradingRiskControls,
        demoClosedTrades: Int,
        demoRequiredClosedTrades: Int,
        demoRequiredDays: Int,
        demoStartedAt: Date?,
        tradingDisclaimerAcknowledged: Bool,
        selectedBrokerId: String,
        riskPercent: Double,
        notificationsEnabled: Bool,
        webhookId: String,
        selectedMockFixtureIndex: Int,
        lastDisclaimerAcceptedAt: Date?
    ) {
        self.hasCompletedOnboarding = hasCompletedOnboarding
        self.paperTradingMode = paperTradingMode
        self.tradingMode = tradingMode
        self.autoTradingEnabled = autoTradingEnabled
        self.emergencyStopActive = emergencyStopActive
        self.liveAutoUnlocked = liveAutoUnlocked
        self.liveAutoEnabledByUser = liveAutoEnabledByUser
        self.riskControls = riskControls
        self.demoClosedTrades = demoClosedTrades
        self.demoRequiredClosedTrades = demoRequiredClosedTrades
        self.demoRequiredDays = demoRequiredDays
        self.demoStartedAt = demoStartedAt
        self.tradingDisclaimerAcknowledged = tradingDisclaimerAcknowledged
        self.selectedBrokerId = selectedBrokerId
        self.riskPercent = riskPercent
        self.notificationsEnabled = notificationsEnabled
        self.webhookId = webhookId
        self.selectedMockFixtureIndex = selectedMockFixtureIndex
        self.lastDisclaimerAcceptedAt = lastDisclaimerAcceptedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        hasCompletedOnboarding = try container.decodeIfPresent(Bool.self, forKey: .hasCompletedOnboarding) ?? false
        paperTradingMode = try container.decodeIfPresent(Bool.self, forKey: .paperTradingMode) ?? true
        if let mode = try container.decodeIfPresent(TradingMode.self, forKey: .tradingMode) {
            tradingMode = mode
        } else {
            tradingMode = paperTradingMode ? .manual : .confirm
        }
        autoTradingEnabled = try container.decodeIfPresent(Bool.self, forKey: .autoTradingEnabled) ?? false
        emergencyStopActive = try container.decodeIfPresent(Bool.self, forKey: .emergencyStopActive) ?? false
        liveAutoUnlocked = try container.decodeIfPresent(Bool.self, forKey: .liveAutoUnlocked) ?? false
        liveAutoEnabledByUser = try container.decodeIfPresent(Bool.self, forKey: .liveAutoEnabledByUser) ?? false
        riskControls = try container.decodeIfPresent(TradingRiskControls.self, forKey: .riskControls) ?? .default
        demoClosedTrades = try container.decodeIfPresent(Int.self, forKey: .demoClosedTrades) ?? 0
        demoRequiredClosedTrades = try container.decodeIfPresent(Int.self, forKey: .demoRequiredClosedTrades) ?? 20
        demoRequiredDays = try container.decodeIfPresent(Int.self, forKey: .demoRequiredDays) ?? 7
        demoStartedAt = try container.decodeIfPresent(Date.self, forKey: .demoStartedAt)
        tradingDisclaimerAcknowledged = try container.decodeIfPresent(Bool.self, forKey: .tradingDisclaimerAcknowledged) ?? false
        selectedBrokerId = try container.decodeIfPresent(String.self, forKey: .selectedBrokerId) ?? "trading212_manual"
        riskPercent = try container.decodeIfPresent(Double.self, forKey: .riskPercent) ?? 0.5
        notificationsEnabled = try container.decodeIfPresent(Bool.self, forKey: .notificationsEnabled) ?? false
        webhookId = try container.decodeIfPresent(String.self, forKey: .webhookId) ?? "mock-webhook"
        selectedMockFixtureIndex = try container.decodeIfPresent(Int.self, forKey: .selectedMockFixtureIndex) ?? 0
        lastDisclaimerAcceptedAt = try container.decodeIfPresent(Date.self, forKey: .lastDisclaimerAcceptedAt)
    }
}
