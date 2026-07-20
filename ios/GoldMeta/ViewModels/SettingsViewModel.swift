import Foundation
import Combine
import LocalAuthentication

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
    @Published private(set) var tradingStatusText: String = "Manual mode — analysis only."
    @Published private(set) var brokerPolicyText: String =
        "Trading 212 Public API does not support XAUUSD CFD automation. Use it for manual execution only."

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
        refreshTradingStatusText()
    }

    var notificationExplanationText: String {
        environment.notificationRouter.explainPurpose()
    }

    func setRiskPercent(_ value: Double) {
        settings.riskPercent = min(value, settings.riskControls.maxRiskPerTradePercent)
        settings.riskControls.maxRiskPerTradePercent = min(settings.riskControls.maxRiskPerTradePercent, 1)
        save()
    }

    func togglePaperMode(_ enabled: Bool) {
        settings.paperTradingMode = enabled
        settings.tradingMode = enabled ? .demoAuto : .manual
        settings.autoTradingEnabled = enabled
        save()
        refreshTradingStatusText()
        Task { await syncTradingControls() }
    }

    func setTradingMode(_ mode: TradingMode) async {
        if mode == .liveAuto && !settings.liveAutoUnlocked {
            tradingStatusText = settings.liveAutoLockReason ?? "Live Auto is locked."
            return
        }
        if mode == .liveAuto && settings.selectedBrokerId == "trading212_manual" {
            tradingStatusText = "Live Auto cannot use Trading 212 for XAUUSD CFD. Keep Manual/Confirm for Trading 212, or add a compatible CFD broker later."
            return
        }
        settings.tradingMode = mode
        settings.paperTradingMode = mode == .demoAuto || mode == .manual
        settings.autoTradingEnabled = mode == .demoAuto
        if mode == .demoAuto, settings.demoStartedAt == nil {
            settings.demoStartedAt = Date()
            settings.selectedBrokerId = "demo_simulated"
        }
        if mode == .manual || mode == .confirm {
            settings.selectedBrokerId = "trading212_manual"
            settings.liveAutoEnabledByUser = false
            settings.autoTradingEnabled = false
        }
        save()
        refreshTradingStatusText()
        await syncTradingControls()
    }

    func setAutoTradingEnabled(_ enabled: Bool) async {
        if settings.tradingMode == .liveAuto {
            guard settings.liveAutoUnlocked else {
                tradingStatusText = "Live Auto is still locked."
                return
            }
            guard settings.tradingDisclaimerAcknowledged else {
                tradingStatusText = "Acknowledge the no-guaranteed-profits disclaimer first."
                return
            }
            settings.liveAutoEnabledByUser = enabled
        }
        settings.autoTradingEnabled = enabled
        save()
        refreshTradingStatusText()
        await syncTradingControls()
    }

    func acknowledgeTradingDisclaimer(_ acknowledged: Bool) {
        settings.tradingDisclaimerAcknowledged = acknowledged
        if acknowledged {
            settings.lastDisclaimerAcceptedAt = Date()
        }
        save()
    }

    func updateRiskControls(_ mutate: (inout TradingRiskControls) -> Void) {
        mutate(&settings.riskControls)
        settings.riskControls.maxRiskPerTradePercent = min(settings.riskControls.maxRiskPerTradePercent, 1)
        settings.riskPercent = min(settings.riskPercent, settings.riskControls.maxRiskPerTradePercent)
        save()
        Task { await syncTradingControls() }
    }

    func emergencyStop() async {
        settings.emergencyStopActive = true
        settings.autoTradingEnabled = false
        settings.liveAutoEnabledByUser = false
        save()
        refreshTradingStatusText()
        do {
            let response = try await environment.apiClient.emergencyStopTrading()
            tradingStatusText = response.message ?? "Emergency stop active. New automated orders are blocked."
            if let controls = response.controls {
                applyRemoteControls(controls)
            }
        } catch {
            tradingStatusText = "Local emergency stop on. Backend sync failed: \(error.localizedDescription)"
        }
    }

    func clearEmergencyStop() async {
        settings.emergencyStopActive = false
        save()
        refreshTradingStatusText()
        await syncTradingControls(emergencyStopActive: false)
    }

    /// Face ID / device auth for Confirm-mode submission. Never stores broker secrets.
    func confirmWithBiometrics(reason: String = "Confirm GoldMeta proposed order") async -> String? {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            tradingStatusText = "Device authentication unavailable. Use explicit confirmation."
            return UUID().uuidString
        }
        do {
            let success = try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
            return success ? "confirmed-\(UUID().uuidString)" : nil
        } catch {
            tradingStatusText = "Confirmation cancelled."
            return nil
        }
    }

    func resetOnboarding() {
        settings.hasCompletedOnboarding = false
        save()
    }

    func refreshRemoteConfiguration() async {
        await loadTradingViewConnections()
        await syncBackendSettings()
        await refreshTradingControlsFromBackend()
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
        refreshTradingStatusText()
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

    private func refreshTradingControlsFromBackend() async {
        do {
            let envelope = try await environment.apiClient.getTradingControls()
            applyRemoteControls(envelope.controls)
            if envelope.policy?.trading212XauusdCfdApiSupported == false {
                brokerPolicyText = "Trading 212 Public API does not support XAUUSD CFD automation. Manual execution only."
            }
        } catch {
            tradingStatusText = "Using local trading controls. Backend sync pending: \(error.localizedDescription)"
        }
    }

    private func syncTradingControls(emergencyStopActive: Bool? = nil) async {
        do {
            let controls = try await environment.apiClient.updateTradingControls(
                TradingControlsPatch(
                    mode: settings.tradingMode,
                    autoTradingEnabled: settings.autoTradingEnabled,
                    liveAutoEnabledByUser: settings.liveAutoEnabledByUser,
                    selectedBrokerId: settings.selectedBrokerId,
                    riskControls: settings.riskControls,
                    disclaimerAcknowledged: settings.tradingDisclaimerAcknowledged,
                    emergencyStopActive: emergencyStopActive ?? settings.emergencyStopActive
                )
            )
            applyRemoteControls(controls)
        } catch {
            tradingStatusText = "Saved locally. Backend sync failed: \(error.localizedDescription)"
        }
    }

    private func applyRemoteControls(_ controls: TradingControlsDTO) {
        settings.tradingMode = controls.mode
        settings.autoTradingEnabled = controls.autoTradingEnabled
        settings.emergencyStopActive = controls.emergencyStopActive
        settings.liveAutoUnlocked = controls.liveAutoUnlocked
        settings.liveAutoEnabledByUser = controls.liveAutoEnabledByUser
        settings.selectedBrokerId = controls.selectedBrokerId
        settings.riskControls = controls.riskControls
        settings.tradingDisclaimerAcknowledged = controls.disclaimerAcknowledged ?? settings.tradingDisclaimerAcknowledged
        if let demo = controls.demoTesting {
            settings.demoClosedTrades = demo.closedTrades ?? settings.demoClosedTrades
            settings.demoRequiredClosedTrades = demo.requiredClosedTrades ?? settings.demoRequiredClosedTrades
            settings.demoRequiredDays = demo.requiredDays ?? settings.demoRequiredDays
            settings.demoStartedAt = demo.startedAt ?? settings.demoStartedAt
        }
        environment.saveSettings(settings)
        refreshTradingStatusText()
    }

    private func refreshTradingStatusText() {
        if settings.emergencyStopActive {
            tradingStatusText = "EMERGENCY STOP ACTIVE — new automated orders blocked."
            return
        }
        tradingStatusText = "\(settings.tradingMode.title): \(settings.tradingMode.summary)"
    }

    private static func authStatusText(for user: AuthUser?, mode: String) -> String {
        if let user {
            return "Signed in as \(user.email ?? user.uid) (\(mode))."
        }
        return "Signed out (\(mode))."
    }
}
