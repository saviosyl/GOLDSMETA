import Foundation
import Combine

@MainActor
final class SettingsViewModel: ObservableObject {
    @Published var settings: UserSettings
    @Published var appVersionText: String = "GoldMeta iOS Phase 1+"
    @Published var lastDeveloperAction: String?
    @Published private(set) var apiModeText: String
    @Published private(set) var authStatusText: String
    @Published private(set) var pushStatusText: String
    @Published private(set) var tradingViewConnections: [TradingViewConnection] = []
    @Published private(set) var connectionStatusText: String = "No backend connection loaded yet."
    @Published private(set) var testAlertStatusText: String?

    private let environment: AppEnvironment
    private var pushStatusCancellable: AnyCancellable?
    private var authStateListener: AuthStateListening?

    init(environment: AppEnvironment) {
        self.environment = environment
        self.settings = environment.localStore.loadSettings()
        self.apiModeText = environment.config.apiModeDescription
        self.authStatusText = Self.authStatusText(for: environment.authService.currentUser, mode: environment.config.authModeDescription)
        self.pushStatusText = environment.pushNotificationService.status.displayText
        self.pushStatusCancellable = environment.pushNotificationService.$status.sink { [weak self] status in
            Task { @MainActor in
                self?.pushStatusText = status.displayText
            }
        }
        self.authStateListener = environment.authService.addAuthStateListener { [weak self] user in
            Task { @MainActor in
                self?.authStatusText = Self.authStatusText(for: user, mode: environment.config.authModeDescription)
            }
        }
    }

    var notificationExplanationText: String {
        environment.notificationRouter.explainPurpose()
    }

    func setRiskPercent(_ value: Double) {
        settings.riskPercent = min(value, 1.0)
        save()
    }

    func togglePaperMode(_ enabled: Bool) {
        settings.paperTradingMode = enabled
        save()
    }

    func resetOnboarding() {
        settings.hasCompletedOnboarding = false
        save()
    }

    func refreshRemoteConfiguration() async {
        await loadTradingViewConnections()
        await syncBackendSettings()
    }

    func requestPushRegistration() async {
        settings.notificationsEnabled = await environment.pushNotificationService.requestPermissionAndRegister()
        save()
        pushStatusText = environment.pushNotificationService.status.displayText
        await syncBackendSettings()
    }

    func createTradingViewConnection() async {
        connectionStatusText = "Creating backend connection..."
        do {
            let connection = try await environment.apiClient.createTradingViewConnection()
            tradingViewConnections.insert(connection, at: 0)
            connectionStatusText = "Created connection \(connection.id). Copy the URL and secret into TradingView."
        } catch {
            connectionStatusText = error.localizedDescription
        }
    }

    func copyLatestWebhookURL() -> String {
        tradingViewConnections.first?.webhookURL ?? settings.webhookURL
    }

    func copyLatestPayloadSecret() -> String {
        tradingViewConnections.first?.payloadSecret ?? ""
    }

    func exampleJSON() -> String {
        let now = ISO8601DateFormatter().string(from: Date())
        return """
        {
          "schemaVersion": "1.0",
          "source": "tradingview",
          "eventId": "manual-test-\(UUID().uuidString)",
          "webhookSecret": "\(copyLatestPayloadSecret())",
          "symbol": "XAUUSD",
          "exchange": "OANDA",
          "timeframe": "15",
          "eventType": "TEST",
          "barTime": "\(now)",
          "sentAt": "\(now)",
          "isConfirmedBar": true,
          "indicatorName": "GoldMetaBridge",
          "ohlcv": {
            "open": 2400,
            "high": 2412,
            "low": 2396,
            "close": 2408,
            "volume": 1
          },
          "levels": null,
          "sessionVolumeProfile": null,
          "marketProfile": null,
          "trend": {
            "direction": "NEUTRAL",
            "strength": 50,
            "components": []
          },
          "confirmationCandle": null,
          "optionalIndicators": null,
          "metadata": {
            "source": "goldmeta-ios-example"
          }
        }
        """
    }

    func sendTestAlert() async {
        testAlertStatusText = "Sending test alert..."
        do {
            let response = try await environment.apiClient.sendTestAlert(connectionId: tradingViewConnections.first?.id)
            testAlertStatusText = response.message
        } catch {
            testAlertStatusText = error.localizedDescription
        }
    }

    func signOut() async {
        do {
            try await environment.signOut()
            authStatusText = Self.authStatusText(for: nil, mode: environment.config.authModeDescription)
        } catch {
            authStatusText = error.localizedDescription
        }
    }

    func cycleMockFixture() async -> Decision? {
        do {
            let decision = try await environment.decisionService.cycleMockFixture()
            settings = environment.localStore.loadSettings()
            lastDeveloperAction = "Loaded \(decision.decisionId)"
            return decision
        } catch {
            lastDeveloperAction = error.localizedDescription
            return nil
        }
    }

    func selectMockFixture(index: Int) async -> Decision? {
        do {
            let decision = try await environment.decisionService.selectMockFixture(index: index)
            settings = environment.localStore.loadSettings()
            lastDeveloperAction = "Loaded \(decision.decisionId)"
            return decision
        } catch {
            lastDeveloperAction = error.localizedDescription
            return nil
        }
    }

    private func save() {
        environment.saveSettings(settings)
    }

    private func loadTradingViewConnections() async {
        do {
            tradingViewConnections = try await environment.apiClient.listTradingViewConnections()
            connectionStatusText = tradingViewConnections.isEmpty
                ? "No TradingView connection yet."
                : "\(tradingViewConnections.count) TradingView connection(s) loaded."
        } catch {
            connectionStatusText = error.localizedDescription
        }
    }

    private func syncBackendSettings() async {
        do {
            _ = try await environment.apiClient.updateSettings(
                BackendSettingsUpdate(
                    aiEnabled: nil,
                    notificationsEnabled: settings.notificationsEnabled,
                    provisionalSignalsEnabled: nil,
                    riskProfile: nil
                )
            )
        } catch {
            lastDeveloperAction = "Backend settings sync failed: \(error.localizedDescription)"
        }
    }

    private static func authStatusText(for user: AuthUser?, mode: String) -> String {
        if let user {
            return "Signed in as \(user.email ?? user.uid) (\(mode))."
        }
        return "Signed out (\(mode))."
    }
}
