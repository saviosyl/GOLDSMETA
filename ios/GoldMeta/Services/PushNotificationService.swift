import Foundation
import Combine
import FirebaseCore
import FirebaseMessaging
import UIKit
import UserNotifications

@MainActor
final class PushNotificationService: ObservableObject {
    static let shared = PushNotificationService()

    enum Status: Equatable {
        case notConfigured
        case firebaseMissingPlist
        case permissionNotRequested
        case permissionDenied
        case waitingForToken
        case registered(String)
        case failed(String)

        var displayText: String {
            switch self {
            case .notConfigured:
                return "Push service not configured"
            case .firebaseMissingPlist:
                return "Firebase plist missing"
            case .permissionNotRequested:
                return "Permission not requested"
            case .permissionDenied:
                return "Permission denied"
            case .waitingForToken:
                return "Waiting for APNs/FCM token"
            case .registered:
                return "Registered"
            case .failed(let message):
                return "Failed: \(message)"
            }
        }
    }

    @Published private(set) var status: Status = .notConfigured

    private weak var apiClient: APIClient?
    private weak var authService: AuthService?
    private var localStore: LocalStore?
    private var notificationRouter: NotificationRouter?
    private var config: AppConfig = .current
    private let defaults = UserDefaults.standard

    private enum Key {
        static let fcmToken = "goldmeta.push.fcmToken"
        static let deviceId = "goldmeta.push.deviceId"
    }

    private init() {}

    func configure(
        apiClient: APIClient,
        authService: AuthService,
        localStore: LocalStore,
        notificationRouter: NotificationRouter,
        config: AppConfig
    ) {
        self.apiClient = apiClient
        self.authService = authService
        self.localStore = localStore
        self.notificationRouter = notificationRouter
        self.config = config
        updateStatusForFirebaseConfiguration()
    }

    func configureFirebaseIfPossible() {
        guard FirebaseApp.app() == nil else {
            updateStatusForFirebaseConfiguration()
            return
        }

        guard Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil else {
            print("GoldMeta: GoogleService-Info.plist not found. Firebase push/auth is disabled; DEBUG mock auth can still be used for local UI.")
            status = .firebaseMissingPlist
            return
        }

        FirebaseApp.configure()
        Messaging.messaging().isAutoInitEnabled = true
        updateStatusForFirebaseConfiguration()
    }

    func requestPermissionAndRegister() async -> Bool {
        guard FirebaseApp.app() != nil else {
            status = .firebaseMissingPlist
            return false
        }

        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            if var settings = localStore?.loadSettings() {
                settings.notificationsEnabled = granted
                localStore?.saveSettings(settings)
            }
            guard granted else {
                status = .permissionDenied
                return false
            }
            status = .waitingForToken
            UIApplication.shared.registerForRemoteNotifications()
            await registerStoredTokenIfPossible()
            return true
        } catch {
            status = .failed(error.localizedDescription)
            return false
        }
    }

    func handleAPNSToken(_ deviceToken: Data) {
        guard FirebaseApp.app() != nil else {
            status = .firebaseMissingPlist
            return
        }
        Messaging.messaging().apnsToken = deviceToken
        Messaging.messaging().token { [weak self] token, error in
            Task { @MainActor in
                if let error {
                    self?.status = .failed(error.localizedDescription)
                } else {
                    self?.handleFCMToken(token)
                }
            }
        }
    }

    func handleFCMToken(_ token: String?) {
        guard let token, !token.isEmpty else {
            status = .waitingForToken
            return
        }
        defaults.set(token, forKey: Key.fcmToken)
        Task { await registerDevice(fcmToken: token) }
    }

    func routeNotification(userInfo: [AnyHashable: Any]) {
        notificationRouter?.route(userInfo: userInfo)
    }

    func unregisterDevice() async {
        guard let apiClient, let deviceId = defaults.string(forKey: Key.deviceId) else { return }
        do {
            try await apiClient.deleteRegisteredDevice(deviceId: deviceId)
            defaults.removeObject(forKey: Key.deviceId)
            defaults.removeObject(forKey: Key.fcmToken)
            status = .permissionNotRequested
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    func registerStoredTokenIfPossible() async {
        guard let token = defaults.string(forKey: Key.fcmToken) else { return }
        await registerDevice(fcmToken: token)
    }

    private func registerDevice(fcmToken: String) async {
        guard authService?.currentUser != nil else {
            status = .waitingForToken
            return
        }
        guard let apiClient else {
            status = .notConfigured
            return
        }

        do {
            let device = try await apiClient.registerDevice(
                DeviceRegistrationRequest(
                    deviceId: currentDeviceId(),
                    platform: "ios",
                    fcmToken: fcmToken,
                    appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
                )
            )
            defaults.set(device.id, forKey: Key.deviceId)
            status = .registered(device.id)
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    private func updateStatusForFirebaseConfiguration() {
        if FirebaseApp.app() == nil {
            status = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") == nil ? .firebaseMissingPlist : .permissionNotRequested
        } else if defaults.string(forKey: Key.fcmToken) == nil {
            status = .permissionNotRequested
        }
    }

    private func currentDeviceId() -> String {
        if let deviceId = defaults.string(forKey: Key.deviceId) {
            return deviceId
        }
        let deviceId = "ios-\(UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString)"
        defaults.set(deviceId, forKey: Key.deviceId)
        return deviceId
    }
}
