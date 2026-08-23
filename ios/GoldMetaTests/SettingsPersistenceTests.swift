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
        settings.tradingMode = .confirm
        settings.riskPercent = 1.0
        settings.selectedMockFixtureIndex = 4
        settings.riskControls.maxTradesPerDay = 3
        settings.emergencyStopActive = true
        store.saveSettings(settings)

        let loaded = store.loadSettings()
        XCTAssertEqual(loaded.hasCompletedOnboarding, true)
        XCTAssertEqual(loaded.paperTradingMode, false)
        XCTAssertEqual(loaded.tradingMode, .confirm)
        XCTAssertEqual(loaded.riskPercent, 1.0)
        XCTAssertEqual(loaded.selectedMockFixtureIndex, 4)
        XCTAssertEqual(loaded.riskControls.maxTradesPerDay, 3)
        XCTAssertTrue(loaded.emergencyStopActive)
        store.clearAll()
    }

    func testTradingModeSummariesAndLiveLockCopy() {
        XCTAssertEqual(TradingMode.manual.title, "Manual")
        XCTAssertFalse(TradingMode.manual.allowsOrderSubmission)
        XCTAssertTrue(TradingMode.confirm.allowsOrderSubmission)
        XCTAssertTrue(TradingMode.demoAuto.summary.lowercased().contains("simulated"))
        XCTAssertTrue(TradingMode.liveAuto.summary.lowercased().contains("locked"))

        var settings = UserSettings.default
        settings.liveAutoUnlocked = false
        XCTAssertNotNil(settings.liveAutoLockReason)
        XCTAssertLessThanOrEqual(TradingRiskControls.default.maxRiskPerTradePercent, 1)
    }

    func testLegacySettingsWithoutTradingModeStillDecode() throws {
        let legacy = """
        {"hasCompletedOnboarding":true,"paperTradingMode":true,"riskPercent":0.5,"notificationsEnabled":false,"webhookId":"abc","selectedMockFixtureIndex":0}
        """.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(UserSettings.self, from: legacy)
        XCTAssertEqual(decoded.tradingMode, .manual)
        XCTAssertEqual(decoded.riskControls.maxTradesPerDay, TradingRiskControls.default.maxTradesPerDay)
    }
}
