import Foundation

final class MockDecisionService: DecisionServiceProtocol {
    static let fixtureNames = [
        "strong_buy",
        "weak_buy_wait_rr",
        "strong_sell",
        "conflicted_wait",
        "stale_wait",
        "missing_confirmation",
        "provisional_buy",
        "active_trade_tp1",
        "invalidation_wait",
        "offline_recovery"
    ]

    private let localStore: LocalStore
    private var cachedDecisions: [Decision]?

    init(localStore: LocalStore = LocalStore()) {
        self.localStore = localStore
    }

    func latestDecision() async throws -> Decision {
        let decisions = try loadDecisions()
        let settings = localStore.loadSettings()
        let index = min(max(settings.selectedMockFixtureIndex, 0), decisions.count - 1)
        return decisions[index]
    }

    func decisionHistory() async throws -> [Decision] {
        try loadDecisions().sorted { $0.generatedAt > $1.generatedAt }
    }

    func cycleMockFixture() async throws -> Decision {
        let decisions = try loadDecisions()
        var settings = localStore.loadSettings()
        settings.selectedMockFixtureIndex = (settings.selectedMockFixtureIndex + 1) % decisions.count
        localStore.saveSettings(settings)
        return decisions[settings.selectedMockFixtureIndex]
    }

    func selectMockFixture(index: Int) async throws -> Decision {
        let decisions = try loadDecisions()
        guard decisions.indices.contains(index) else { throw DecisionServiceError.fixtureNotFound }
        var settings = localStore.loadSettings()
        settings.selectedMockFixtureIndex = index
        localStore.saveSettings(settings)
        return decisions[index]
    }

    private func loadDecisions() throws -> [Decision] {
        if let cachedDecisions { return cachedDecisions }
        let decisions = try Self.fixtureNames.map { name in
            try Self.loadFixture(named: name)
        }
        cachedDecisions = decisions
        return decisions
    }

    static func loadFixture(named name: String) throws -> Decision {
        guard let url = Bundle.main.url(forResource: name, withExtension: "json", subdirectory: "MockFixtures")
            ?? Bundle.main.url(forResource: name, withExtension: "json")
            ?? Bundle(for: BundleToken.self).url(forResource: name, withExtension: "json", subdirectory: "MockFixtures")
            ?? Bundle(for: BundleToken.self).url(forResource: name, withExtension: "json")
        else {
            throw DecisionServiceError.fixtureNotFound
        }
        do {
            let data = try Data(contentsOf: url)
            return try Decision.jsonDecoder.decode(Decision.self, from: data)
        } catch let error as DecodingError {
            throw DecisionServiceError.decodingFailed(error.localizedDescription)
        } catch {
            throw error
        }
    }
}

private final class BundleToken {}
