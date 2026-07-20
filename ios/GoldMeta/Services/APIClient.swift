import Foundation

@MainActor
final class APIClient: DecisionServiceProtocol {
    private let baseURL: URL?
    private let session: URLSession
    private weak var authService: AuthService?

    init(baseURL: URL?, authService: AuthService? = nil, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.authService = authService
        self.session = session
    }

    func latestDecision() async throws -> Decision {
        try await request(
            path: "v1/decisions/latest",
            method: "GET",
            response: DecisionEnvelope.self
        ).decision
    }

    func decisionHistory() async throws -> [Decision] {
        try await history()
    }

    func history() async throws -> [Decision] {
        try await request(
            path: "v1/decisions",
            method: "GET",
            response: DecisionsEnvelope.self
        ).decisions
    }

    func decision(id: String) async throws -> Decision {
        try await request(
            path: "v1/decisions/\(id)",
            method: "GET",
            response: DecisionEnvelope.self
        ).decision
    }

    func cycleMockFixture() async throws -> Decision { throw DecisionServiceError.offline }
    func selectMockFixture(index: Int) async throws -> Decision { throw DecisionServiceError.offline }

    func registerDevice(_ requestBody: DeviceRegistrationRequest) async throws -> RegisteredDevice {
        try await request(
            path: "v1/devices/register",
            method: "POST",
            body: requestBody,
            response: DeviceEnvelope.self
        ).device
    }

    func deleteRegisteredDevice(deviceId: String) async throws {
        _ = try await request(
            path: "v1/devices/\(deviceId)",
            method: "DELETE",
            response: EmptyEnvelope.self
        )
    }

    func createTradingViewConnection() async throws -> TradingViewConnection {
        try await request(
            path: "v1/tradingview/connections",
            method: "POST",
            response: ConnectionEnvelope.self
        ).connection
    }

    func listTradingViewConnections() async throws -> [TradingViewConnection] {
        try await request(
            path: "v1/tradingview/connections",
            method: "GET",
            response: ConnectionsEnvelope.self
        ).connections
    }

    func sendTestAlert(connectionId: String? = nil) async throws -> TradingViewTestResponse {
        try await request(
            path: "v1/tradingview/test",
            method: "POST",
            body: TradingViewTestRequest(connectionId: connectionId),
            response: TradingViewTestResponse.self
        )
    }

    func getSettings() async throws -> BackendSettings {
        try await request(
            path: "v1/settings",
            method: "GET",
            response: SettingsEnvelope.self
        ).settings
    }

    func updateSettings(_ update: BackendSettingsUpdate) async throws -> BackendSettings {
        try await request(
            path: "v1/settings",
            method: "PATCH",
            body: update,
            response: SettingsEnvelope.self
        ).settings
    }

    private func request<Response: Decodable>(
        path: String,
        method: String,
        response: Response.Type,
        retryingAfterRefresh: Bool = false
    ) async throws -> Response {
        try await request(
            path: path,
            method: method,
            bodyData: nil,
            response: response,
            retryingAfterRefresh: retryingAfterRefresh
        )
    }

    private func request<Body: Encodable, Response: Decodable>(
        path: String,
        method: String,
        body: Body,
        response: Response.Type,
        retryingAfterRefresh: Bool = false
    ) async throws -> Response {
        let bodyData = try Decision.jsonEncoder.encode(body)
        return try await request(
            path: path,
            method: method,
            bodyData: bodyData,
            response: response,
            retryingAfterRefresh: retryingAfterRefresh
        )
    }

    private func request<Response: Decodable>(
        path: String,
        method: String,
        bodyData: Data?,
        response: Response.Type,
        retryingAfterRefresh: Bool
    ) async throws -> Response {
        guard let url = baseURL?.appending(path: path) else { throw DecisionServiceError.offline }
        guard let authService else { throw DecisionServiceError.unauthorized }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let bodyData {
            request.httpBody = bodyData
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        request.setValue(
            "Bearer \(try await authService.idToken(forceRefresh: retryingAfterRefresh))",
            forHTTPHeaderField: "Authorization"
        )

        do {
            let (data, urlResponse) = try await session.data(for: request)
            guard let httpResponse = urlResponse as? HTTPURLResponse else { throw DecisionServiceError.offline }

            if httpResponse.statusCode == 401, !retryingAfterRefresh {
                return try await self.request(
                    path: path,
                    method: method,
                    bodyData: bodyData,
                    response: response,
                    retryingAfterRefresh: true
                )
            }

            guard (200..<300).contains(httpResponse.statusCode) else {
                throw mapError(statusCode: httpResponse.statusCode, data: data)
            }

            if data.isEmpty, response == EmptyEnvelope.self {
                guard let emptyResponse = EmptyEnvelope() as? Response else {
                    throw DecisionServiceError.decodingFailed("Empty response type mismatch")
                }
                return emptyResponse
            }
            return try Decision.jsonDecoder.decode(response, from: data)
        } catch let error as DecisionServiceError {
            throw error
        } catch let error as URLError where Self.offlineCodes.contains(error.code) {
            throw DecisionServiceError.offline
        } catch let error as DecodingError {
            throw DecisionServiceError.decodingFailed(error.localizedDescription)
        }
    }

    private func mapError(statusCode: Int, data: Data) -> DecisionServiceError {
        let backendError = try? Decision.jsonDecoder.decode(ErrorEnvelope.self, from: data).error

        switch statusCode {
        case 401:
            return .unauthorized
        case 403:
            return .forbidden
        case 404:
            return .notFound
        case 429:
            return .rateLimited
        case 500...599:
            return .server(backendError?.message ?? "")
        default:
            if let backendError {
                return .apiError(code: backendError.code, message: backendError.message)
            }
            return .offline
        }
    }

    private static let offlineCodes: Set<URLError.Code> = [
        .notConnectedToInternet,
        .networkConnectionLost,
        .cannotConnectToHost,
        .cannotFindHost,
        .timedOut
    ]
}

private struct DecisionEnvelope: Decodable {
    let decision: Decision
}

private struct DecisionsEnvelope: Decodable {
    let decisions: [Decision]
}

private struct DeviceEnvelope: Decodable {
    let device: RegisteredDevice
}

private struct ConnectionEnvelope: Decodable {
    let connection: TradingViewConnection
}

private struct ConnectionsEnvelope: Decodable {
    let connections: [TradingViewConnection]
}

private struct SettingsEnvelope: Decodable {
    let settings: BackendSettings
}

private struct ErrorEnvelope: Decodable {
    let error: APIErrorPayload
}

private struct EmptyEnvelope: Decodable {
    init() {}
    init(from decoder: Decoder) throws {
        self.init()
    }
}
