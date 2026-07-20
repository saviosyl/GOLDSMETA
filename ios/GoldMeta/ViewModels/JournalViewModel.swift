import Foundation

@MainActor
final class JournalViewModel: ObservableObject {
    @Published private(set) var entries: [JournalEntry] = []
    @Published var draftNotes = ""
    @Published var draftOutcome: TradeOutcome = .open
    @Published var draftRealizedR: Double = 0

    private let environment: AppEnvironment

    init(environment: AppEnvironment) {
        self.environment = environment
        self.entries = environment.localStore.loadJournalEntries()
    }

    var metrics: JournalMetrics { JournalMetrics.calculate(entries: entries) }

    func reload() {
        entries = environment.localStore.loadJournalEntries()
    }

    func addEntry(for decision: Decision, action: TradeAction) {
        let outcome: TradeOutcome = action == .skipped ? .skipped : draftOutcome
        let entry = JournalEntry(
            decisionId: decision.decisionId,
            action: action,
            outcome: outcome,
            realizedR: outcome == .open || outcome == .skipped ? nil : draftRealizedR,
            notes: draftNotes,
            decision: decision.decision,
            ruleConfigVersion: decision.ruleConfigVersion
        )
        entries.insert(entry, at: 0)
        persist()
        draftNotes = ""
        draftOutcome = .open
        draftRealizedR = 0
    }

    func update(entry: JournalEntry, outcome: TradeOutcome, realizedR: Double?) {
        guard let index = entries.firstIndex(where: { $0.id == entry.id }) else { return }
        entries[index].outcome = outcome
        entries[index].realizedR = realizedR
        persist()
    }

    private func persist() {
        environment.localStore.saveJournalEntries(entries)
    }
}
