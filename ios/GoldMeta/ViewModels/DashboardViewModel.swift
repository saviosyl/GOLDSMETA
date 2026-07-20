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
    @Published private(set) var selectedMVPScenarioIndex = 0
    @Published private(set) var lastActionMessage: String?
    @Published var showAnalysis = false

    let environment: AppEnvironment

    static let mvpScenarioTitles = [
        "Bullish BUY",
        "Bearish SELL",
        "WAIT near resistance"
    ]

    init(environment: AppEnvironment) {
        self.environment = environment
        selectedMVPScenarioIndex = min(
            max(environment.localStore.loadSettings().selectedMockFixtureIndex, 0),
            Self.mvpScenarioTitles.count - 1
        )
    }

    func loadLatestDecision() async {
        state = .loading
        do {
            let latest = try await environment.decisionService.latestDecision()
            decision = latest
            environment.localStore.saveCachedDecisions([latest] + environment.localStore.loadCachedDecisions().filter { $0.decisionId != latest.decisionId })
            syncMVPIndex(with: latest)
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
            syncMVPIndex(with: next)
            state = state(for: next)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func selectMVPScenario(index: Int) async {
        guard MockDecisionService.mvpFixtureNames.indices.contains(index) else { return }
        do {
            let next = try await environment.decisionService.selectMockFixture(index: index)
            decision = next
            selectedMVPScenarioIndex = index
            lastActionMessage = nil
            state = state(for: next)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func applyTradeAction(_ action: RecommendedTradeAction) {
        guard let decision else { return }
        let journalAction: TradeAction
        let outcome: TradeOutcome
        switch action {
        case .enterTrade:
            journalAction = .taken
            outcome = .open
        case .waitForCandleClose, .hold:
            journalAction = .skipped
            outcome = .skipped
        case .takePartialProfit, .moveStopToBreakeven:
            journalAction = .taken
            outcome = .open
        case .exitEarly:
            journalAction = .taken
            outcome = .breakeven
        }

        let entry = JournalEntry(
            decisionId: decision.decisionId,
            action: journalAction,
            outcome: outcome,
            notes: "Dashboard action: \(action.title)",
            decision: decision.decision,
            ruleConfigVersion: decision.ruleConfigVersion
        )
        var entries = environment.localStore.loadJournalEntries()
        entries.insert(entry, at: 0)
        environment.localStore.saveJournalEntries(entries)
        lastActionMessage = "Logged: \(action.title)"
    }

    func markTradeTaken() {
        applyTradeAction(decision?.decision == .wait ? .waitForCandleClose : .enterTrade)
    }

    nonisolated static func state(for decision: Decision) -> State {
        if decision.dataSourceLabel == .offline { return .offline(cached: decision) }
        if decision.isStale { return .loaded(decision) }
        return .loaded(decision)
    }

    private func state(for decision: Decision) -> State { Self.state(for: decision) }

    private func syncMVPIndex(with decision: Decision) {
        let mvpIds = [
            "gm-001-strong-buy",
            "gm-003-strong-sell",
            "gm-004-wait-near-resistance"
        ]
        if let index = mvpIds.firstIndex(of: decision.decisionId) {
            selectedMVPScenarioIndex = index
        }
    }

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
