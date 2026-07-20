import XCTest
@testable import GoldMeta

final class JournalMetricsTests: XCTestCase {
    func testJournalMetricsCalculateWinRateAverageRAndExpectancy() {
        let entries = [
            JournalEntry(decisionId: "1", action: .taken, outcome: .win, realizedR: 2.0, decision: .buy, ruleConfigVersion: "rules-1"),
            JournalEntry(decisionId: "2", action: .taken, outcome: .loss, realizedR: -1.0, decision: .sell, ruleConfigVersion: "rules-1"),
            JournalEntry(decisionId: "3", action: .taken, outcome: .breakeven, realizedR: 0, decision: .buy, ruleConfigVersion: "rules-1"),
            JournalEntry(decisionId: "4", action: .skipped, outcome: .skipped, decision: .wait, ruleConfigVersion: "rules-1")
        ]

        let metrics = JournalMetrics.calculate(entries: entries)

        XCTAssertEqual(metrics.totalClosedTrades, 3)
        XCTAssertEqual(metrics.wins, 1)
        XCTAssertEqual(metrics.losses, 1)
        XCTAssertEqual(metrics.breakeven, 1)
        XCTAssertEqual(metrics.winRate, 1.0 / 3.0, accuracy: 0.0001)
        XCTAssertEqual(metrics.averageR, 1.0 / 3.0, accuracy: 0.0001)
        XCTAssertEqual(metrics.expectancy, metrics.averageR, accuracy: 0.0001)
        XCTAssertTrue(metrics.hasSmallSampleWarning)
    }

    func testEmptyJournalMetricsAreZero() {
        XCTAssertEqual(JournalMetrics.calculate(entries: []), .empty)
    }
}
