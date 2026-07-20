import Foundation

struct JournalEntry: Codable, Identifiable, Equatable {
    let id: UUID
    let decisionId: String
    let createdAt: Date
    var action: TradeAction
    var outcome: TradeOutcome
    var realizedR: Double?
    var notes: String
    var symbol: String
    var decision: DecisionType
    var ruleConfigVersion: String

    init(
        id: UUID = UUID(),
        decisionId: String,
        createdAt: Date = Date(),
        action: TradeAction,
        outcome: TradeOutcome,
        realizedR: Double? = nil,
        notes: String = "",
        symbol: String = "XAUUSD",
        decision: DecisionType,
        ruleConfigVersion: String
    ) {
        self.id = id
        self.decisionId = decisionId
        self.createdAt = createdAt
        self.action = action
        self.outcome = outcome
        self.realizedR = realizedR
        self.notes = notes
        self.symbol = symbol
        self.decision = decision
        self.ruleConfigVersion = ruleConfigVersion
    }
}

struct JournalMetrics: Equatable {
    let totalClosedTrades: Int
    let wins: Int
    let losses: Int
    let breakeven: Int
    let winRate: Double
    let averageR: Double
    let expectancy: Double

    var hasSmallSampleWarning: Bool { totalClosedTrades > 0 && totalClosedTrades < 20 }

    static let empty = JournalMetrics(
        totalClosedTrades: 0,
        wins: 0,
        losses: 0,
        breakeven: 0,
        winRate: 0,
        averageR: 0,
        expectancy: 0
    )

    static func calculate(entries: [JournalEntry]) -> JournalMetrics {
        let closed = entries.filter { $0.action == .taken && [.win, .loss, .breakeven].contains($0.outcome) }
        guard !closed.isEmpty else { return .empty }
        let wins = closed.filter { $0.outcome == .win }.count
        let losses = closed.filter { $0.outcome == .loss }.count
        let breakeven = closed.filter { $0.outcome == .breakeven }.count
        let rValues = closed.map { $0.realizedR ?? 0 }
        let averageR = rValues.reduce(0, +) / Double(closed.count)
        let winRate = Double(wins) / Double(closed.count)
        return JournalMetrics(
            totalClosedTrades: closed.count,
            wins: wins,
            losses: losses,
            breakeven: breakeven,
            winRate: winRate,
            averageR: averageR,
            expectancy: averageR
        )
    }
}
