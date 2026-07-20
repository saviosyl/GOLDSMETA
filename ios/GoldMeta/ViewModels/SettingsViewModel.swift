import Foundation

@MainActor
final class SettingsViewModel: ObservableObject {
    @Published var settings: UserSettings
    @Published var appVersionText: String = "GoldMeta iOS Phase 1+"
    @Published var lastDeveloperAction: String?

    private let environment: AppEnvironment

    init(environment: AppEnvironment) {
        self.environment = environment
        self.settings = environment.localStore.loadSettings()
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
}
