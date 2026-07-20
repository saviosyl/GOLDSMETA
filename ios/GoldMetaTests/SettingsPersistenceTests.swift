import XCTest
@testable import GoldMeta

final class SettingsPersistenceTests: XCTestCase {
    func testSettingsPersistThroughLocalStore() {
        let suiteName = "GoldMetaTests-\(UUID().uuidString)"
        let store = LocalStore(suiteName: suiteName)
        store.clearAll()

        var settings = UserSettings.default
        settings.hasCompletedOnboarding = true
        settings.paperTradingMode = false
        settings.riskPercent = 1.0
        settings.selectedMockFixtureIndex = 4
        store.saveSettings(settings)

        let loaded = store.loadSettings()
        XCTAssertEqual(loaded.hasCompletedOnboarding, true)
        XCTAssertEqual(loaded.paperTradingMode, false)
        XCTAssertEqual(loaded.riskPercent, 1.0)
        XCTAssertEqual(loaded.selectedMockFixtureIndex, 4)
        store.clearAll()
    }
}
