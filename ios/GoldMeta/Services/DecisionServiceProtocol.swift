import Foundation

@MainActor
protocol DecisionServiceProtocol: AnyObject {
    func latestDecision() async throws -> Decision
    func decisionHistory() async throws -> [Decision]
    func cycleMockFixture() async throws -> Decision
    func selectMockFixture(index: Int) async throws -> Decision
}

enum DecisionServiceError: LocalizedError, Equatable {
    case offline
    case noData
    case fixtureNotFound
    case decodingFailed(String)

    var errorDescription: String? {
        switch self {
        case .offline:
            return "GoldMeta is offline. Showing the most recent cached decision if available."
        case .noData:
            return "No decision is available yet."
        case .fixtureNotFound:
            return "The selected mock fixture could not be found."
        case .decodingFailed(let reason):
            return "Decision decoding failed: \(reason)"
        }
    }
}
