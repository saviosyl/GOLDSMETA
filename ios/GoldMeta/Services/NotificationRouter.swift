import Foundation
import Combine
import UserNotifications

final class NotificationRouter: ObservableObject {
    private let localStore: LocalStore
    @Published private(set) var routedDecisionId: String?

    init(localStore: LocalStore = LocalStore()) {
        self.localStore = localStore
    }

    func requestPermission() async -> Bool {
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            var settings = localStore.loadSettings()
            settings.notificationsEnabled = granted
            localStore.saveSettings(settings)
            return granted
        } catch {
            return false
        }
    }

    func explainPurpose() -> String {
        "Notifications are used only to tell you when GoldMeta has a new XAUUSD decision-support update. They do not place trades."
    }

    func route(userInfo: [AnyHashable: Any]) {
        routedDecisionId = userInfo["decisionId"] as? String
            ?? userInfo["decision_id"] as? String
    }
}
