import Foundation

struct AuthUser: Equatable {
    let uid: String
    let email: String?
}

protocol AuthStateListening: AnyObject {
    func remove()
}

@MainActor
protocol AuthService: AnyObject {
    var currentUser: AuthUser? { get }

    @discardableResult
    func signUp(email: String, password: String) async throws -> AuthUser

    @discardableResult
    func signIn(email: String, password: String) async throws -> AuthUser

    func signOut() throws
    func idToken(forceRefresh: Bool) async throws -> String

    @discardableResult
    func addAuthStateListener(_ listener: @escaping (AuthUser?) -> Void) -> AuthStateListening
}

extension AuthService {
    var currentUserId: String? { currentUser?.uid }
    var currentUserEmail: String? { currentUser?.email }
}

enum AuthServiceError: LocalizedError, Equatable {
    case missingFirebaseConfiguration
    case notSignedIn
    case invalidCredentials

    var errorDescription: String? {
        switch self {
        case .missingFirebaseConfiguration:
            return "Firebase is not configured. Add GoogleService-Info.plist locally or use DEBUG mock mode."
        case .notSignedIn:
            return "Sign in to continue."
        case .invalidCredentials:
            return "Enter a valid email and password."
        }
    }
}

final class MockAuthService: AuthService {
    private var listeners: [UUID: (AuthUser?) -> Void] = [:]
    private(set) var user: AuthUser?

    var currentUser: AuthUser? { user }

    init(user: AuthUser? = nil) {
        self.user = user
    }

    func signUp(email: String, password: String) async throws -> AuthUser {
        try validate(email: email, password: password)
        return signInMockUser(email: email)
    }

    func signIn(email: String, password: String) async throws -> AuthUser {
        try validate(email: email, password: password)
        return signInMockUser(email: email)
    }

    func signOut() throws {
        user = nil
        notify()
    }

    func idToken(forceRefresh: Bool) async throws -> String {
        guard let user else { throw AuthServiceError.notSignedIn }
        return "mock-id-token-\(user.uid)"
    }

    @discardableResult
    func addAuthStateListener(_ listener: @escaping (AuthUser?) -> Void) -> AuthStateListening {
        let id = UUID()
        listeners[id] = listener
        listener(user)
        return MockAuthStateListening { [weak self] in
            self?.listeners[id] = nil
        }
    }

    private func validate(email: String, password: String) throws {
        guard email.contains("@"), password.count >= 6 else { throw AuthServiceError.invalidCredentials }
    }

    private func signInMockUser(email: String) -> AuthUser {
        let user = AuthUser(uid: "mock-user", email: email)
        self.user = user
        notify()
        return user
    }

    private func notify() {
        listeners.values.forEach { $0(user) }
    }
}

private final class MockAuthStateListening: AuthStateListening {
    private let onRemove: () -> Void

    init(onRemove: @escaping () -> Void) {
        self.onRemove = onRemove
    }

    func remove() {
        onRemove()
    }
}
