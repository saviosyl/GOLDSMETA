import Foundation

struct AppConfig {
    let apiBaseURL: URL?
    let apiBaseURLRawValue: String?
    let useMockAuth: Bool
    let firebasePlistPresent: Bool

    static let current = AppConfig(bundle: .main)

    init(bundle: Bundle) {
        firebasePlistPresent = bundle.path(forResource: "GoogleService-Info", ofType: "plist") != nil

        let rawValue = bundle.object(forInfoDictionaryKey: "APIBaseURL") as? String
        let trimmed = rawValue?.trimmingCharacters(in: .whitespacesAndNewlines)
        apiBaseURLRawValue = trimmed
        if let trimmed, !trimmed.isEmpty, !trimmed.contains("YOUR_CLOUD_FUNCTIONS_URL") {
            apiBaseURL = URL(string: trimmed)
        } else {
            apiBaseURL = nil
        }

        if let configuredMockAuth = Self.boolValue(bundle.object(forInfoDictionaryKey: "UseMockAuth")) {
            useMockAuth = configuredMockAuth
        } else {
            #if DEBUG
            useMockAuth = !firebasePlistPresent
            #else
            useMockAuth = false
            #endif
        }
    }

    var apiModeDescription: String {
        guard let apiBaseURL else { return "Not configured" }
        if apiBaseURL.host == "127.0.0.1" || apiBaseURL.host == "localhost" {
            return "Local backend (\(apiBaseURL.absoluteString))"
        }
        return "Remote backend (\(apiBaseURL.absoluteString))"
    }

    var authModeDescription: String {
        useMockAuth ? "DEBUG mock auth" : "Firebase email/password"
    }

    private static func boolValue(_ value: Any?) -> Bool? {
        if let bool = value as? Bool { return bool }
        if let string = value as? String {
            switch string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
            case "yes", "true", "1":
                return true
            case "no", "false", "0":
                return false
            default:
                return nil
            }
        }
        return nil
    }
}
