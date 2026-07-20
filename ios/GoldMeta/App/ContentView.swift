import SwiftUI

struct ContentView: View {
    @StateObject private var dashboardViewModel: DashboardViewModel
    @StateObject private var historyViewModel: HistoryViewModel
    @StateObject private var journalViewModel: JournalViewModel
    @StateObject private var settingsViewModel: SettingsViewModel
    @StateObject private var onboardingViewModel: OnboardingViewModel
    @StateObject private var analysisViewModel: AnalysisViewModel

    init(environment: AppEnvironment = .preview) {
        _dashboardViewModel = StateObject(wrappedValue: DashboardViewModel(environment: environment))
        _historyViewModel = StateObject(wrappedValue: HistoryViewModel(environment: environment))
        _journalViewModel = StateObject(wrappedValue: JournalViewModel(environment: environment))
        _settingsViewModel = StateObject(wrappedValue: SettingsViewModel(environment: environment))
        _onboardingViewModel = StateObject(wrappedValue: OnboardingViewModel(environment: environment))
        _analysisViewModel = StateObject(wrappedValue: AnalysisViewModel(environment: environment))
    }

    var body: some View {
        Group {
            if onboardingViewModel.hasCompletedOnboarding {
                TabView {
                    DashboardView(viewModel: dashboardViewModel)
                        .tabItem { Label("Dashboard", systemImage: "chart.line.uptrend.xyaxis") }
                    FullAnalysisView(viewModel: analysisViewModel)
                        .tabItem { Label("Analysis", systemImage: "doc.text.magnifyingglass") }
                    SignalHistoryView(viewModel: historyViewModel)
                        .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }
                    JournalView(viewModel: journalViewModel)
                        .tabItem { Label("Journal", systemImage: "book.closed") }
                    SettingsView(viewModel: settingsViewModel, dashboardViewModel: dashboardViewModel)
                        .tabItem { Label("Settings", systemImage: "gearshape") }
                }
                .tint(GoldMetaColor.gold)
                .task { await dashboardViewModel.loadLatestDecision() }
            } else {
                OnboardingView(viewModel: onboardingViewModel)
            }
        }
        .background(GoldMetaColor.background.ignoresSafeArea())
    }
}

#Preview {
    let environment = AppEnvironment.preview
    ContentView(environment: environment)
        .environmentObject(environment)
}
