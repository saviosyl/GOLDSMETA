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

    private func fixture(_ name: String) throws -> Decision {
        let bundle = Bundle(for: Self.self)
        let url = try XCTUnwrap(
            bundle.url(forResource: name, withExtension: "json", subdirectory: "MockFixtures")
                ?? bundle.url(forResource: name, withExtension: "json")
        )
        return try Decision.jsonDecoder.decode(Decision.self, from: Data(contentsOf: url))
    }
}
