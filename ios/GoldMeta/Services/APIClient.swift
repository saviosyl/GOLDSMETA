import Foundation

final class APIClient: DecisionServiceProtocol {
    private let baseURL: URL?
    private let session: URLSession

    init(baseURL: URL?, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func latestDecision() async throws -> Decision {
        guard let url = baseURL?.appending(path: "v1/decisions/latest") else { throw DecisionServiceError.offline }
        return try await fetch(url)
    }

    func decisionHistory() async throws -> [Decision] {
        guard let url = baseURL?.appending(path: "v1/decisions") else { throw DecisionServiceError.offline }
        return try await fetch(url)
    }

    func cycleMockFixture() async throws -> Decision { throw DecisionServiceError.offline }
    func selectMockFixture(index: Int) async throws -> Decision { throw DecisionServiceError.offline }

    private func fetch<T: Decodable>(_ url: URL) async throws -> T {
        let (data, response) = try await session.data(from: url)
        guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
            throw DecisionServiceError.offline
        }
        return try Decision.jsonDecoder.decode(T.self, from: data)
    }
}
