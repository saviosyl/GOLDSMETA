import Foundation

@MainActor
protocol DecisionServiceProtocol: AnyObject {
    func latestDecision() async throws -> Decision
    func decisionHistory() async throws -> [Decision]
    func decision(id: String) async throws -> Decision
    func cycleMockFixture() async throws -> Decision
    func selectMockFixture(index: Int) async throws -> Decision
}

enum DecisionServiceError: LocalizedError, Equatable {
    case offline
    case unauthorized
    case forbidden
    case notFound
    case rateLimited
    case server(String)
    case apiError(code: String, message: String)
    case noData
    case fixtureNotFound
    case decodingFailed(String)

    var errorDescription: String? {
        switch self {
        case .offline:
            return "GoldMeta is offline. Showing the most recent cached decision if available."
        case .unauthorized:
            return "Sign in again to continue."
        case .forbidden:
            return "Your account does not have access to this resource."
        case .notFound:
            return "The requested GoldMeta resource was not found."
        case .rateLimited:
            return "Too many requests. Please wait and try again."
        case .server(let message):
            return message.isEmpty ? "GoldMeta backend is unavailable. Please try again shortly." : message
        case .apiError(_, let message):
            return message
        case .noData:
            return "No decision is available yet."
        case .fixtureNotFound:
            return "The selected mock fixture could not be found."
        case .decodingFailed(let reason):
            return "Decision decoding failed: \(reason)"
        }
    }
}
