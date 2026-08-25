import XCTest
@testable import GoldMeta

final class DecisionDecodingTests: XCTestCase {
    func testAllMockFixturesDecode() throws {
        for name in MockDecisionService.fixtureNames {
            let decision = try loadFixture(name)
            XCTAssertEqual(decision.schemaVersion, "1.0")
            XCTAssertEqual(decision.symbol, "XAUUSD")
            XCTAssertFalse(decision.decisionId.isEmpty)
            XCTAssertEqual(decision.disclaimer, AppCopy.disclaimer)
        }
    }

    func testStrongBuyFixtureContainsTradePlan() throws {
        let decision = try loadFixture("strong_buy")
        XCTAssertEqual(decision.decision, .buy)
        XCTAssertEqual(decision.dataSourceLabel, .mock)
        XCTAssertEqual(decision.scenarioName, "Bullish BUY setup")
        XCTAssertEqual(decision.setupGrade, "A")
        XCTAssertEqual(decision.tradeScore, 81)
        XCTAssertEqual(decision.analysisOnly, true)
        XCTAssertEqual(decision.recommendedManagementAction, "ENTER")
        XCTAssertNotNil(decision.entry.price)
        XCTAssertGreaterThanOrEqual(decision.takeProfits.count, 3)
        XCTAssertGreaterThan(decision.riskReward.tp1 ?? 0, 1)
        XCTAssertEqual(decision.marketStructure?.poc, 2409)
        XCTAssertEqual(decision.marketStructure?.vah, 2418)
        XCTAssertEqual(decision.marketStructure?.val, 2404)
        XCTAssertEqual(decision.recommendedActions?.first, .enterTrade)
        XCTAssertFalse(decision.scoreBreakdown?.isEmpty ?? true)
    }

    func testStrongSellFixtureParsesBearishStructure() throws {
        let decision = try loadFixture("strong_sell")
        XCTAssertEqual(decision.decision, .sell)
        XCTAssertEqual(decision.scenarioName, "Bearish SELL setup")
        XCTAssertEqual(decision.marketStructure?.trend, "BEARISH")
        XCTAssertEqual(decision.setupGrade, "A")
        XCTAssertEqual(decision.takeProfits.map(\.label), ["TP1", "TP2", "TP3"])
        XCTAssertEqual(decision.analysisOnly, true)
    }

    func testWaitNearResistanceFixtureParses() throws {
        let decision = try loadFixture("conflicted_wait")
        XCTAssertEqual(decision.decision, .wait)
        XCTAssertEqual(decision.scenarioName, "WAIT near resistance")
        XCTAssertEqual(decision.setupGrade, "No Trade")
        XCTAssertEqual(decision.marketStructure?.vah, 2418)
        XCTAssertEqual(decision.recommendedActions, [.waitForCandleClose, .hold])
        XCTAssertTrue(decision.takeProfits.isEmpty)
        XCTAssertEqual(decision.recommendedManagementAction, "WAIT_FOR_CLOSE")
        XCTAssertFalse(decision.safetyFlags?.isEmpty ?? true)
    }

    func testDecisionDisplayFormatsBuyScenario() throws {
        let decision = try loadFixture("strong_buy")
        let display = DecisionDisplay(decision: decision)

        XCTAssertEqual(display.decisionLabel, "BUY")
        XCTAssertEqual(display.confidenceText, "80%")
        XCTAssertEqual(display.currentPriceText, "2421.00")
        XCTAssertEqual(display.trendText, "Bullish")
        XCTAssertEqual(display.pocText, "2409.00")
        XCTAssertEqual(display.vahText, "2418.00")
        XCTAssertEqual(display.valText, "2404.00")
        XCTAssertEqual(display.entryText, "2421.00")
        XCTAssertEqual(display.stopLossText, "2416.75")
        XCTAssertEqual(display.tp1Text, "2430.00")
        XCTAssertEqual(display.tp2Text, "2440.00")
        XCTAssertEqual(display.tp3Text, "2455.00")
        XCTAssertEqual(display.riskRewardText, "8.00R")
        XCTAssertEqual(display.setupGradeText, "A")
        XCTAssertEqual(display.tradeScoreText, "81")
        XCTAssertEqual(display.managementText, "ENTER")
        XCTAssertTrue(display.analysisOnlyText.contains("Analysis only"))
        XCTAssertFalse(display.supportingReasons.isEmpty)
        XCTAssertFalse(display.scoreBreakdownLines.isEmpty)
        XCTAssertTrue(display.actionTitles.contains("Enter trade"))
        XCTAssertTrue(display.actionTitles.contains("Wait for candle close"))
    }

    func testDecisionDisplayFormatsSellAndWaitScenarios() throws {
        let sell = DecisionDisplay(decision: try loadFixture("strong_sell"))
        XCTAssertEqual(sell.decisionLabel, "SELL")
        XCTAssertEqual(sell.confidenceText, "80%")
        XCTAssertTrue(sell.supportingReasons.contains(where: { $0.localizedCaseInsensitiveContains("bearish") }))

        let wait = DecisionDisplay(decision: try loadFixture("conflicted_wait"))
        XCTAssertEqual(wait.decisionLabel, "WAIT")
        XCTAssertEqual(wait.entryText, "Wait")
        XCTAssertEqual(wait.stopLossText, "—")
        XCTAssertEqual(wait.tp1Text, "—")
        XCTAssertEqual(wait.setupGradeText, "No Trade")
        XCTAssertEqual(wait.actionTitles, ["Wait for candle close", "Hold"])
        XCTAssertEqual(wait.scenarioTitle, "WAIT near resistance")
        XCTAssertFalse(wait.safetyFlagTexts.isEmpty)
    }

    private func loadFixture(_ name: String) throws -> Decision {
        let bundle = Bundle(for: Self.self)
        let url = try XCTUnwrap(
            bundle.url(forResource: name, withExtension: "json", subdirectory: "MockFixtures")
                ?? bundle.url(forResource: name, withExtension: "json")
        )
        let data = try Data(contentsOf: url)
        return try Decision.jsonDecoder.decode(Decision.self, from: data)
    }
}
