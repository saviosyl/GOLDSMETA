import Foundation

@MainActor
final class HistoryViewModel: ObservableObject {
    @Published private(set) var decisions: [Decision] = []
    @Published var selectedDecision: DecisionType?
    @Published var selectedQuality: DataQuality?
    @Published private(set) var errorMessage: String?

    private let environment: AppEnvironment

    init(environment: AppEnvironment) {
        self.environment = environment
    }

    var filteredDecisions: [Decision] {
        decisions.filter { decision in
            (selectedDecision == nil || decision.decision == selectedDecision) &&
            (selectedQuality == nil || decision.dataQuality == selectedQuality)
        }
    }

    func loadHistory() async {
        do {
            let history = try await environment.decisionService.decisionHistory()
            decisions = history
            environment.localStore.saveCachedDecisions(history)
            errorMessage = nil
        } catch {
            decisions = environment.localStore.loadCachedDecisions()
            errorMessage = error.localizedDescription
        }
    }
}
