import Foundation
import SwiftUI

@MainActor
final class OnboardingViewModel: ObservableObject {
    @Published private(set) var hasCompletedOnboarding: Bool
    @Published var currentStep: Int = 0
    @Published var settings: UserSettings
    @Published var email: String = ""
    @Published var password: String = ""
    @Published var isCreatingAccount = false
    @Published private(set) var authStatus: String = "Sign in with Firebase email/password."
    @Published private(set) var notificationStatus: String
    @Published private(set) var connection: TradingViewConnection?
    @Published private(set) var connectionStatus: String = "Create a backend TradingView connection when you are signed in."
    @Published private(set) var testAlertStatus: String?
    @Published private(set) var isWorking = false

    private let environment: AppEnvironment

    let steps = ["Intro", "Risk", "Sign In", "Notifications", "Webhook", "Paper Trading"]

    init(environment: AppEnvironment) {
        self.environment = environment
        let loaded = environment.localStore.loadSettings()
        self.settings = loaded
        self.hasCompletedOnboarding = loaded.hasCompletedOnboarding
        self.notificationStatus = environment.pushNotificationService.status.displayText
        if let email = environment.authService.currentUser?.email {
            self.email = email
            self.authStatus = "Signed in as \(email)."
        } else if environment.config.useMockAuth {
            self.authStatus = "DEBUG mock auth is available for local UI."
        }
    }

    func next() {
        if currentStep < steps.count - 1 {
            currentStep += 1
        } else {
            completeOnboarding()
        }
    }

    func previous() {
        currentStep = max(0, currentStep - 1)
    }

    func completeOnboarding() {
        settings.hasCompletedOnboarding = true
        settings.paperTradingMode = true
        settings.lastDisclaimerAcceptedAt = Date()
        environment.saveSettings(settings)
        hasCompletedOnboarding = true
    }

    var signedInEmail: String? { environment.authService.currentUser?.email }
    var canUseDebugMockSignIn: Bool { environment.config.useMockAuth }
    var environmentNotificationExplanation: String { environment.notificationRouter.explainPurpose() }

    var webhookURL: String {
        connection?.webhookURL ?? settings.webhookURL
    }

    var payloadSecret: String {
        connection?.payloadSecret ?? ""
    }

    var exampleJSON: String {
        let now = ISO8601DateFormatter().string(from: Date())
        """
        {
          "schemaVersion": "1.0",
          "source": "tradingview",
          "eventId": "manual-test-\(UUID().uuidString)",
          "webhookSecret": "\(payloadSecret)",
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

    func submitAuth() async {
        guard !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, password.count >= 6 else {
            authStatus = "Enter an email address and a password of at least 6 characters."
            return
        }

        isWorking = true
        defer { isWorking = false }
        do {
            let user: AuthUser
            if isCreatingAccount {
                user = try await environment.authService.signUp(email: email, password: password)
            } else {
                user = try await environment.authService.signIn(email: email, password: password)
            }
            authStatus = "Signed in as \(user.email ?? user.uid)."
            await environment.pushNotificationService.registerStoredTokenIfPossible()
        } catch {
            authStatus = error.localizedDescription
        }
    }

    func enableMockSignIn() async {
        isCreatingAccount = false
        email = email.isEmpty ? "mock@goldmeta.local" : email
        password = password.isEmpty ? "mock-password" : password
        await submitAuth()
    }

    func requestNotifications() async {
        settings.notificationsEnabled = await environment.pushNotificationService.requestPermissionAndRegister()
        environment.saveSettings(settings)
        notificationStatus = environment.pushNotificationService.status.displayText
    }

    func createConnection() async {
        isWorking = true
        connectionStatus = "Creating backend TradingView connection..."
        defer { isWorking = false }
        do {
            connection = try await environment.apiClient.createTradingViewConnection()
            connectionStatus = "Connection ready. Copy the webhook URL and secret into TradingView."
        } catch {
            connectionStatus = error.localizedDescription
        }
    }

    func sendTestAlert() async {
        isWorking = true
        testAlertStatus = "Sending test alert..."
        defer { isWorking = false }
        do {
            let response = try await environment.apiClient.sendTestAlert(connectionId: connection?.id)
            testAlertStatus = response.message
        } catch {
            testAlertStatus = error.localizedDescription
        }
    }
}
