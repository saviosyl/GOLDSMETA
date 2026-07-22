import Foundation

@MainActor
final class AppEnvironment: ObservableObject {
    let decisionService: DecisionServiceProtocol
    let localStore: LocalStore
    let keychainStore: KeychainStore
    let notificationRouter: NotificationRouter
    let apiClient: APIClient
    let authService: AuthService
    let pushNotificationService: PushNotificationService
    let config: AppConfig

    @Published var settings: UserSettings
    @Published private(set) var authUser: AuthUser?

    private var authStateListener: AuthStateListening?

    init(
        decisionService: DecisionServiceProtocol,
        localStore: LocalStore,
        keychainStore: KeychainStore,
        notificationRouter: NotificationRouter,
        apiClient: APIClient,
        authService: AuthService,
        pushNotificationService: PushNotificationService = .shared,
        config: AppConfig
    ) {
        self.decisionService = decisionService
        self.localStore = localStore
        self.keychainStore = keychainStore
        self.notificationRouter = notificationRouter
        self.apiClient = apiClient
        self.authService = authService
        self.pushNotificationService = pushNotificationService
        self.config = config
        self.settings = localStore.loadSettings()
        self.authUser = authService.currentUser

        pushNotificationService.configure(
            apiClient: apiClient,
            authService: authService,
            localStore: localStore,
            notificationRouter: notificationRouter,
            config: config
        )
        authStateListener = authService.addAuthStateListener { [weak self] user in
            self?.authUser = user
            if user != nil {
                Task { await self?.pushNotificationService.registerStoredTokenIfPossible() }
            }
        }
    }

    static func makeDefault() -> AppEnvironment {
        let config = AppConfig.current
        let localStore = LocalStore()
        let keychainStore = KeychainStore()
        let authService: AuthService
        if config.useMockAuth {
            authService = MockAuthService()
        } else {
            authService = FirebaseAuthService()
        }
        let apiClient = APIClient(baseURL: config.apiBaseURL, authService: authService)
        let decisionService: DecisionServiceProtocol
        #if DEBUG
        decisionService = config.useMockAuth ? MockDecisionService(localStore: localStore) : apiClient
        #else
        decisionService = apiClient
        #endif
        return AppEnvironment(
            decisionService: decisionService,
            localStore: localStore,
            keychainStore: keychainStore,
            notificationRouter: NotificationRouter(localStore: localStore),
            apiClient: apiClient,
            authService: authService,
            config: config
        )
    }

    static var preview: AppEnvironment {
        let localStore = LocalStore(suiteName: "GoldMetaPreview")
        let authService = MockAuthService(user: AuthUser(uid: "preview-user", email: "preview@goldmeta.local"))
        return AppEnvironment(
            decisionService: MockDecisionService(localStore: localStore),
            localStore: localStore,
            keychainStore: KeychainStore(service: "GoldMetaPreview"),
            notificationRouter: NotificationRouter(localStore: localStore),
            apiClient: APIClient(baseURL: nil, authService: authService),
            authService: authService,
            config: AppConfig(bundle: .main)
        )
    }

    func saveSettings(_ settings: UserSettings) {
        self.settings = settings
        localStore.saveSettings(settings)
    }

    func signOut() async throws {
        await pushNotificationService.unregisterDevice()
        try authService.signOut()
    }
}
