import XCTest
@testable import GoldMeta

final class DashboardStateTests: XCTestCase {
    func testDashboardStatesForBuySellWait() throws {
        let buy = try fixture("strong_buy")
        let sell = try fixture("strong_sell")
        let wait = try fixture("conflicted_wait")

        XCTAssertEqual(DashboardViewModel.state(for: buy), .loaded(buy))
        XCTAssertEqual(DashboardViewModel.state(for: sell), .loaded(sell))
        XCTAssertEqual(DashboardViewModel.state(for: wait), .loaded(wait))
    }

    func testDashboardStateForOffline() throws {
        let offline = try fixture("offline_recovery")
        XCTAssertEqual(DashboardViewModel.state(for: offline), .offline(cached: offline))
    }

    func testDashboardStaleDecisionRemainsLoadedButFlagged() throws {
        let stale = try fixture("stale_wait")
        XCTAssertTrue(stale.isStale)
        XCTAssertEqual(DashboardViewModel.state(for: stale), .loaded(stale))
    }

    func testMVPScenariosExposeRequiredDashboardFields() throws {
        for name in MockDecisionService.mvpFixtureNames {
            let decision = try fixture(name)
            let display = decision.display

            XCTAssertTrue(["BUY", "SELL", "WAIT"].contains(display.decisionLabel))
            XCTAssertFalse(display.confidenceText.isEmpty)
            XCTAssertFalse(display.currentPriceText.isEmpty)
            XCTAssertFalse(display.trendText.isEmpty)
            XCTAssertFalse(display.pocText.isEmpty)
            XCTAssertFalse(display.vahText.isEmpty)
            XCTAssertFalse(display.valText.isEmpty)
            XCTAssertFalse(display.actionTitles.isEmpty)

            let requiredActionOptions: Set<String> = [
                "Wait for candle close",
                "Enter trade",
                "Hold",
                "Take partial profit",
                "Move stop to breakeven",
                "Exit early"
            ]
            XCTAssertTrue(Set(display.actionTitles).isSubset(of: requiredActionOptions))
        }
    }

    func testRecommendedActionDefaultsCoverWorkflow() {
        let waitDefaults = RecommendedTradeAction.defaults(for: .wait, breakeven: .notApplicable, earlyExit: false)
        XCTAssertEqual(waitDefaults, [.waitForCandleClose, .hold])

        let buyDefaults = RecommendedTradeAction.defaults(for: .buy, breakeven: .moveToBreakeven, earlyExit: false)
        XCTAssertTrue(buyDefaults.contains(.enterTrade))
        XCTAssertTrue(buyDefaults.contains(.moveStopToBreakeven))
        XCTAssertTrue(buyDefaults.contains(.takePartialProfit))
        XCTAssertTrue(buyDefaults.contains(.exitEarly))
    }

    private func fixture(_ name: String) throws -> Decision {
        let bundle = Bundle(for: Self.self)
        let url = try XCTUnwrap(
            bundle.url(forResource: name, withExtension: "json", subdirectory: "MockFixtures")
                ?? bundle.url(forResource: name, withExtension: "json")
        )
        return try Decision.jsonDecoder.decode(Decision.self, from: Data(contentsOf: url))
    }
}
