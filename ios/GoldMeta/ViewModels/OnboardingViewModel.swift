import Foundation
import SwiftUI

@MainActor
final class OnboardingViewModel: ObservableObject {
    @Published private(set) var hasCompletedOnboarding: Bool
    @Published var currentStep: Int = 0
    @Published var settings: UserSettings
    @Published var signInState: String = "Mock mode ready"

    private let environment: AppEnvironment

    let steps = ["Intro", "Risk", "Sign In", "Notifications", "Webhook", "Paper Trading"]

    init(environment: AppEnvironment) {
        self.environment = environment
        let loaded = environment.localStore.loadSettings()
        self.settings = loaded
        self.hasCompletedOnboarding = loaded.hasCompletedOnboarding
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

    func enableMockSignIn() {
        signInState = "Signed in for DEBUG mock mode"
    }

    func requestNotifications() async {
        settings.notificationsEnabled = await environment.notificationRouter.requestPermission()
        environment.saveSettings(settings)
    }
}
