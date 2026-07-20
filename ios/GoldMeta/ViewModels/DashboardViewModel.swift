import Foundation

@MainActor
final class DashboardViewModel: ObservableObject {
    enum State: Equatable {
        case idle
        case loading
        case loaded(Decision)
        case offline(cached: Decision?)
        case failed(String)
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var decision: Decision?
    @Published var showAnalysis = false

    private let environment: AppEnvironment

    init(environment: AppEnvironment) {
        self.environment = environment
    }

    func loadLatestDecision() async {
        state = .loading
        do {
            let latest = try await environment.decisionService.latestDecision()
            decision = latest
            environment.localStore.saveCachedDecisions([latest] + environment.localStore.loadCachedDecisions().filter { $0.decisionId != latest.decisionId })
            state = state(for: latest)
        } catch DecisionServiceError.offline {
            let cached = environment.localStore.loadCachedDecisions().first
            decision = cached
            state = .offline(cached: cached)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func refresh() async {
        await loadLatestDecision()
    }

    func cycleMockFixture() async {
        do {
            let next = try await environment.decisionService.cycleMockFixture()
            decision = next
            state = state(for: next)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func markTradeTaken() {
        guard let decision else { return }
        let entry = JournalEntry(
            decisionId: decision.decisionId,
            action: decision.decision == .wait ? .skipped : .taken,
            outcome: decision.decision == .wait ? .skipped : .open,
            notes: decision.decision == .wait ? "No trade: WAIT decision." : "Trade marked from dashboard.",
            decision: decision.decision,
            ruleConfigVersion: decision.ruleConfigVersion
        )
        var entries = environment.localStore.loadJournalEntries()
        entries.insert(entry, at: 0)
        environment.localStore.saveJournalEntries(entries)
    }

    nonisolated static func state(for decision: Decision) -> State {
        if decision.dataSourceLabel == .offline { return .offline(cached: decision) }
        if decision.isStale { return .loaded(decision) }
        return .loaded(decision)
    }

    private func state(for decision: Decision) -> State { Self.state(for: decision) }

    var statusLabel: String {
        switch state {
        case .idle:
            return "Ready"
        case .loading:
            return "Refreshing"
        case .loaded(let decision):
            return decision.dataSourceLabel.rawValue
        case .offline:
            return "OFFLINE"
        case .failed:
            return "ERROR"
        }
    }
}
