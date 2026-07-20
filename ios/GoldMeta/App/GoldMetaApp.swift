import SwiftUI

@main
@MainActor
struct GoldMetaApp: App {
    @StateObject private var environment = AppEnvironment.makeDefault()

    var body: some Scene {
        WindowGroup {
            ContentView(environment: environment)
                .environmentObject(environment)
                .preferredColorScheme(.dark)
        }
    }
}
