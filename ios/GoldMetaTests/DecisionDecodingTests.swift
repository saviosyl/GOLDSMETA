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
        XCTAssertNotNil(decision.entry.price)
        XCTAssertGreaterThanOrEqual(decision.takeProfits.count, 3)
        XCTAssertGreaterThan(decision.riskReward.tp1 ?? 0, 1)
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
