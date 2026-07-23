import Foundation
import FirebaseAuth
import FirebaseCore

@MainActor
final class FirebaseAuthService: AuthService {
    var currentUser: AuthUser? {
        Auth.auth().currentUser.map { AuthUser(uid: $0.uid, email: $0.email) }
    }

    /// Public self-registration is permanently disabled.
    func signUp(email: String, password: String) async throws -> AuthUser {
        _ = email
        _ = password
        throw AuthServiceError.registrationClosed
    }

    func signIn(email: String, password: String) async throws -> AuthUser {
        guard FirebaseApp.app() != nil else { throw AuthServiceError.missingFirebaseConfiguration }
        let result = try await Auth.auth().signIn(withEmail: email, password: password)
        return AuthUser(uid: result.user.uid, email: result.user.email)
    }

    func signOut() throws {
        guard FirebaseApp.app() != nil else { return }
        try Auth.auth().signOut()
    }

    func idToken(forceRefresh: Bool) async throws -> String {
        guard FirebaseApp.app() != nil else { throw AuthServiceError.missingFirebaseConfiguration }
        guard let user = Auth.auth().currentUser else { throw AuthServiceError.notSignedIn }
        return try await withCheckedThrowingContinuation { continuation in
            user.getIDTokenForcingRefresh(forceRefresh) { token, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let token {
                    continuation.resume(returning: token)
                } else {
                    continuation.resume(throwing: AuthServiceError.notSignedIn)
                }
            }
        }
    }

    @discardableResult
    func addAuthStateListener(_ listener: @escaping (AuthUser?) -> Void) -> AuthStateListening {
        guard FirebaseApp.app() != nil else {
            listener(nil)
            return NoopAuthStateListening()
        }
        let handle = Auth.auth().addStateDidChangeListener { _, user in
            listener(user.map { AuthUser(uid: $0.uid, email: $0.email) })
        }
        return FirebaseAuthStateListening(handle: handle)
    }
}

private final class FirebaseAuthStateListening: AuthStateListening {
    private let handle: AuthStateDidChangeListenerHandle

    init(handle: AuthStateDidChangeListenerHandle) {
        self.handle = handle
    }

    func remove() {
        Auth.auth().removeStateDidChangeListener(handle)
    }
}

private final class NoopAuthStateListening: AuthStateListening {
    func remove() {}
}
