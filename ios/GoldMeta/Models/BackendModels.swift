import Foundation

struct DeviceRegistrationRequest: Encodable, Equatable {
    let deviceId: String
    let platform: String
    let fcmToken: String
    let appVersion: String?
}

struct RegisteredDevice: Codable, Identifiable, Equatable {
    let deviceId: String
    let userId: String?
    let platform: String?
    let fcmToken: String?
    let appVersion: String?
    let registeredAt: Date?

    var id: String { deviceId }
}

struct TradingViewConnection: Codable, Identifiable, Equatable {
    let id: String
    let webhookURL: String
    let payloadSecret: String?
    let status: String?
    let connected: Bool?
    let lastAlertAt: Date?
    let createdAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case webhookId
        case webhookURL
        case webhookUrl
        case payloadSecret
        case secret
        case status
        case connected
        case lastAlertAt
        case createdAt
    }

    init(
        id: String,
        webhookURL: String,
        payloadSecret: String?,
        status: String?,
        connected: Bool?,
        lastAlertAt: Date?,
        createdAt: Date?
    ) {
        self.id = id
        self.webhookURL = webhookURL
        self.payloadSecret = payloadSecret
        self.status = status
        self.connected = connected
        self.lastAlertAt = lastAlertAt
        self.createdAt = createdAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedId = try container.decodeIfPresent(String.self, forKey: .id)
            ?? container.decode(String.self, forKey: .webhookId)
        id = decodedId
        webhookURL = try container.decodeIfPresent(String.self, forKey: .webhookURL)
            ?? container.decodeIfPresent(String.self, forKey: .webhookUrl)
            ?? "\(AppConfig.current.apiBaseURL?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? "")/webhooks/tradingview/\(decodedId)"
        payloadSecret = try container.decodeIfPresent(String.self, forKey: .payloadSecret)
            ?? container.decodeIfPresent(String.self, forKey: .secret)
        status = try container.decodeIfPresent(String.self, forKey: .status)
        connected = try container.decodeIfPresent(Bool.self, forKey: .connected)
        lastAlertAt = try container.decodeIfPresent(Date.self, forKey: .lastAlertAt)
        createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(webhookURL, forKey: .webhookURL)
        try container.encodeIfPresent(payloadSecret, forKey: .payloadSecret)
        try container.encodeIfPresent(status, forKey: .status)
        try container.encodeIfPresent(connected, forKey: .connected)
        try container.encodeIfPresent(lastAlertAt, forKey: .lastAlertAt)
        try container.encodeIfPresent(createdAt, forKey: .createdAt)
    }
}

struct TradingViewTestRequest: Encodable, Equatable {
    let connectionId: String?
}

struct TradingViewTestResponse: Decodable, Equatable {
    let ok: Bool
    let message: String
    let connection: TradingViewConnection?
    let accepted: Bool?
    let duplicate: Bool?
    let eventId: String?
    let status: String?
    let jobId: String?
}

struct BackendSettings: Codable, Equatable {
    let aiEnabled: Bool?
    let notificationsEnabled: Bool?
    let provisionalSignalsEnabled: Bool?
    let riskProfile: String?
}

struct BackendSettingsUpdate: Encodable, Equatable {
    let aiEnabled: Bool?
    let notificationsEnabled: Bool?
    let provisionalSignalsEnabled: Bool?
    let riskProfile: String?
}

struct TradingControlsDTO: Codable, Equatable {
    let mode: TradingMode
    let autoTradingEnabled: Bool
    let emergencyStopActive: Bool
    let liveAutoUnlocked: Bool
    let liveAutoEnabledByUser: Bool
    let selectedBrokerId: String
    let riskControls: TradingRiskControls
    let disclaimerAcknowledged: Bool?
    let demoTesting: DemoTestingDTO?
}

struct DemoTestingDTO: Codable, Equatable {
    let requiredClosedTrades: Int?
    let closedTrades: Int?
    let requiredDays: Int?
    let startedAt: Date?
    let completedAt: Date?
}

struct TradingControlsEnvelope: Codable, Equatable {
    let controls: TradingControlsDTO
    let policy: TradingPolicyDTO?
}

struct TradingPolicyDTO: Codable, Equatable {
    let noGuaranteedProfits: Bool?
    let forbidMartingale: Bool?
    let forbidGridRecovery: Bool?
    let forbidAveragingDown: Bool?
    let trading212XauusdCfdApiSupported: Bool?
}

struct TradingControlsPatch: Encodable, Equatable {
    var mode: TradingMode?
    var autoTradingEnabled: Bool?
    var liveAutoEnabledByUser: Bool?
    var selectedBrokerId: String?
    var riskControls: TradingRiskControls?
    var disclaimerAcknowledged: Bool?
    var emergencyStopActive: Bool?
}

struct TradingProposeRequest: Encodable, Equatable {
    let decisionId: String
    let side: String
    let orderType: String
    let quantity: Double
    let entryPrice: Double?
    let stopLoss: Double?
    let takeProfits: [TradingTakeProfitDTO]
    let riskPercent: Double
    let confidence: Double
    let spread: Double?
    let dataQuality: String?
    let signalKey: String?
    let highImpactNewsActive: Bool?
    let confirmationToken: String?
}

struct TradingTakeProfitDTO: Codable, Equatable {
    let label: String
    let price: Double
    let closeFraction: Double
}

struct TradingProposalDTO: Codable, Equatable {
    let proposalId: String
    let status: String
    let instructions: [String]
    let blockedReasons: [String]?
    let mode: TradingMode?
}

struct TradingProposeResponse: Codable, Equatable {
    let proposal: TradingProposalDTO
}

struct EmergencyStopResponse: Codable, Equatable {
    let ok: Bool?
    let message: String?
    let controls: TradingControlsDTO?
}

struct APIErrorPayload: Decodable, Equatable {
    let code: String
    let message: String
}
