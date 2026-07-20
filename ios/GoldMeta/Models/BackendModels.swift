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

struct APIErrorPayload: Decodable, Equatable {
    let code: String
    let message: String
}
