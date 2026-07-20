import Foundation

@MainActor
final class AppEnvironment: ObservableObject {
    let decisionService: DecisionServiceProtocol
    let localStore: LocalStore
    let keychainStore: KeychainStore
    let notificationRouter: NotificationRouter
    let apiClient: APIClient

    @Published var settings: UserSettings

    init(
        decisionService: DecisionServiceProtocol,
        localStore: LocalStore,
        keychainStore: KeychainStore,
        notificationRouter: NotificationRouter,
        apiClient: APIClient
    ) {
        self.decisionService = decisionService
        self.localStore = localStore
        self.keychainStore = keychainStore
        self.notificationRouter = notificationRouter
        self.apiClient = apiClient
        self.settings = localStore.loadSettings()
    }

    static func makeDefault() -> AppEnvironment {
        let localStore = LocalStore()
        let keychainStore = KeychainStore()
        let apiClient = APIClient(baseURL: URL(string: "https://api.goldmeta.app"))
        let decisionService: DecisionServiceProtocol
        #if DEBUG
        decisionService = MockDecisionService(localStore: localStore)
        #else
        decisionService = apiClient
        #endif
        return AppEnvironment(
            decisionService: decisionService,
            localStore: localStore,
            keychainStore: keychainStore,
            notificationRouter: NotificationRouter(localStore: localStore),
            apiClient: apiClient
        )
    }

    static var preview: AppEnvironment {
        let localStore = LocalStore(suiteName: "GoldMetaPreview")
        return AppEnvironment(
            decisionService: MockDecisionService(localStore: localStore),
            localStore: localStore,
            keychainStore: KeychainStore(service: "GoldMetaPreview"),
            notificationRouter: NotificationRouter(localStore: localStore),
            apiClient: APIClient(baseURL: nil)
        )
    }

    func saveSettings(_ settings: UserSettings) {
        self.settings = settings
        localStore.saveSettings(settings)
    }
}
