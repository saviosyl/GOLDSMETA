import Foundation

struct UserSettings: Codable, Equatable {
    var hasCompletedOnboarding: Bool
    var paperTradingMode: Bool
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
        riskPercent: 0.5,
        notificationsEnabled: false,
        webhookId: "mock-webhook-\(UUID().uuidString.prefix(8))",
        selectedMockFixtureIndex: 0,
        lastDisclaimerAcceptedAt: nil
    )
}
