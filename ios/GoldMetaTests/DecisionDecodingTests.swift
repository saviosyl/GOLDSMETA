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
        XCTAssertNotNil(decision.entry.price)
        XCTAssertGreaterThanOrEqual(decision.takeProfits.count, 3)
        XCTAssertGreaterThan(decision.riskReward.tp1 ?? 0, 1)
        XCTAssertEqual(decision.marketStructure?.poc, 2409.40)
        XCTAssertEqual(decision.marketStructure?.vah, 2418.60)
        XCTAssertEqual(decision.marketStructure?.val, 2404.90)
        XCTAssertEqual(decision.recommendedActions?.first, .enterTrade)
    }

    func testStrongSellFixtureParsesBearishStructure() throws {
        let decision = try loadFixture("strong_sell")
        XCTAssertEqual(decision.decision, .sell)
        XCTAssertEqual(decision.scenarioName, "Bearish SELL setup")
        XCTAssertEqual(decision.marketStructure?.trend, "BEARISH")
        XCTAssertEqual(decision.takeProfits.map(\.label), ["TP1", "TP2", "TP3"])
    }

    func testWaitNearResistanceFixtureParses() throws {
        let decision = try loadFixture("conflicted_wait")
        XCTAssertEqual(decision.decision, .wait)
        XCTAssertEqual(decision.scenarioName, "WAIT near resistance")
        XCTAssertEqual(decision.marketStructure?.vah, 2418.50)
        XCTAssertEqual(decision.recommendedActions, [.waitForCandleClose, .hold])
        XCTAssertTrue(decision.takeProfits.isEmpty)
    }

    func testDecisionDisplayFormatsBuyScenario() throws {
        let decision = try loadFixture("strong_buy")
        let display = DecisionDisplay(decision: decision)

        XCTAssertEqual(display.decisionLabel, "BUY")
        XCTAssertEqual(display.confidenceText, "88%")
        XCTAssertEqual(display.currentPriceText, "2412.35")
        XCTAssertEqual(display.trendText, "Bullish")
        XCTAssertEqual(display.pocText, "2409.40")
        XCTAssertEqual(display.vahText, "2418.60")
        XCTAssertEqual(display.valText, "2404.90")
        XCTAssertEqual(display.entryText, "2412.35")
        XCTAssertEqual(display.stopLossText, "2403.80")
        XCTAssertEqual(display.tp1Text, "2423.20")
        XCTAssertEqual(display.tp2Text, "2432.70")
        XCTAssertEqual(display.tp3Text, "2446.00")
        XCTAssertEqual(display.riskRewardText, "3.94R")
        XCTAssertFalse(display.supportingReasons.isEmpty)
        XCTAssertFalse(display.opposingReasons.isEmpty)
        XCTAssertTrue(display.actionTitles.contains("Enter trade"))
        XCTAssertTrue(display.actionTitles.contains("Wait for candle close"))
    }

    func testDecisionDisplayFormatsSellAndWaitScenarios() throws {
        let sell = DecisionDisplay(decision: try loadFixture("strong_sell"))
        XCTAssertEqual(sell.decisionLabel, "SELL")
        XCTAssertEqual(sell.confidenceText, "91%")
        XCTAssertTrue(sell.supportingReasons.contains(where: { $0.contains("lower high") }))

        let wait = DecisionDisplay(decision: try loadFixture("conflicted_wait"))
        XCTAssertEqual(wait.decisionLabel, "WAIT")
        XCTAssertEqual(wait.entryText, "2414.00 - 2418.50")
        XCTAssertEqual(wait.stopLossText, "—")
        XCTAssertEqual(wait.tp1Text, "—")
        XCTAssertEqual(wait.actionTitles, ["Wait for candle close", "Hold"])
        XCTAssertEqual(wait.scenarioTitle, "WAIT near resistance")
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
