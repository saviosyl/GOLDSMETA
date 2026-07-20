import XCTest

final class GoldMetaUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testAppLaunches() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["GoldMeta"].exists || app.tabBars.firstMatch.exists)
    }
}
