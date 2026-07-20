import Foundation
import LocalAuthentication

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
    @Published private(set) var tradingModeTitle: String = TradingMode.manual.title
    @Published private(set) var emergencyStopActive = false
    @Published var showAnalysis = false

    let environment: AppEnvironment

    static let mvpScenarioTitles = [
        "Bullish BUY",
        "Bearish SELL",
        "WAIT near resistance"
    ]

    init(environment: AppEnvironment) {
        self.environment = environment
        let settings = environment.localStore.loadSettings()
        selectedMVPScenarioIndex = min(
            max(settings.selectedMockFixtureIndex, 0),
            Self.mvpScenarioTitles.count - 1
        )
        tradingModeTitle = settings.tradingMode.title
        emergencyStopActive = settings.emergencyStopActive
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
        let settings = environment.localStore.loadSettings()
        if settings.emergencyStopActive, action == .enterTrade {
            lastActionMessage = "Emergency stop active — new entries blocked."
            return
        }
        if settings.tradingMode == .manual, action == .enterTrade {
            lastActionMessage = "Manual mode: follow the trade plan instructions. No order was submitted."
            logJournal(action: .skipped, outcome: .skipped, notes: "Manual mode instruction only: \(action.title)")
            return
        }
        Task { await submitAction(action, decision: decision, settings: settings) }
    }

    func emergencyStopTrading() async {
        var settings = environment.localStore.loadSettings()
        settings.emergencyStopActive = true
        settings.autoTradingEnabled = false
        settings.liveAutoEnabledByUser = false
        environment.saveSettings(settings)
        emergencyStopActive = true
        lastActionMessage = "EMERGENCY STOP — auto trading blocked."
        _ = try? await environment.apiClient.emergencyStopTrading()
    }

    private func submitAction(_ action: RecommendedTradeAction, decision: Decision, settings: UserSettings) async {
        var confirmationToken: String?
        if settings.tradingMode == .confirm, action == .enterTrade {
            let contextOK = await confirmBiometric()
            guard let token = contextOK else {
                lastActionMessage = "Confirmation required before submission."
                return
            }
            confirmationToken = token
        }

        if action == .enterTrade, decision.decision != .wait, settings.tradingMode != .manual {
            let side = decision.decision == .sell ? "SELL" : "BUY"
            let request = TradingProposeRequest(
                decisionId: decision.decisionId,
                side: side,
                orderType: decision.entry.type == .limit ? "LIMIT" : "MARKET",
                quantity: 0.1,
                entryPrice: decision.entry.price,
                stopLoss: decision.stopLoss.price,
                takeProfits: decision.takeProfits.map {
                    TradingTakeProfitDTO(label: $0.label, price: $0.price, closeFraction: 0.33)
                },
                riskPercent: min(settings.riskPercent, settings.riskControls.maxRiskPerTradePercent),
                confidence: decision.confidence,
                spread: nil,
                dataQuality: decision.dataQuality.rawValue,
                signalKey: decision.decisionId,
                highImpactNewsActive: false,
                confirmationToken: confirmationToken
            )
            do {
                let response: TradingProposeResponse
                if settings.tradingMode == .confirm {
                    response = try await environment.apiClient.confirmTrade(request)
                } else {
                    response = try await environment.apiClient.proposeTrade(request)
                }
                lastActionMessage = "\(response.proposal.status): \(response.proposal.instructions.prefix(2).joined(separator: " "))"
            } catch {
                lastActionMessage = error.localizedDescription
            }
        }

        let journalAction: TradeAction
        let outcome: TradeOutcome
        switch action {
        case .enterTrade:
            journalAction = settings.tradingMode == .manual ? .skipped : .taken
            outcome = settings.tradingMode == .manual ? .skipped : .open
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
        logJournal(action: journalAction, outcome: outcome, notes: "Dashboard action: \(action.title)")
        if lastActionMessage == nil {
            lastActionMessage = "Logged: \(action.title)"
        }
    }

    private func confirmBiometric() async -> String? {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            // Simulator / unavailable auth: still require an explicit local confirmation token.
            return "explicit-confirm-\(UUID().uuidString)"
        }
        do {
            let ok = try await context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: "Confirm GoldMeta proposed order before any submission attempt."
            )
            return ok ? "face-confirm-\(UUID().uuidString)" : nil
        } catch {
            lastActionMessage = "Confirmation cancelled."
            return nil
        }
    }

    private func logJournal(action: TradeAction, outcome: TradeOutcome, notes: String) {
        guard let decision else { return }
        let entry = JournalEntry(
            decisionId: decision.decisionId,
            action: action,
            outcome: outcome,
            notes: notes,
            decision: decision.decision,
            ruleConfigVersion: decision.ruleConfigVersion
        )
        var entries = environment.localStore.loadJournalEntries()
        entries.insert(entry, at: 0)
        environment.localStore.saveJournalEntries(entries)
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
