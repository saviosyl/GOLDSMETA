import Foundation

@MainActor
final class AnalysisViewModel: ObservableObject {
    @Published private(set) var decision: Decision?
    @Published private(set) var errorMessage: String?

    private let environment: AppEnvironment

    init(environment: AppEnvironment) {
        self.environment = environment
    }

    func load() async {
        do {
            decision = try await environment.decisionService.latestDecision()
            errorMessage = nil
        } catch {
            decision = environment.localStore.loadCachedDecisions().first
            errorMessage = error.localizedDescription
        }
    }
}
