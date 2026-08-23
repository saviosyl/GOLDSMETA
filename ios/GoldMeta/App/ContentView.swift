import SwiftUI

struct ContentView: View {
    private enum AppTab: Hashable {
        case dashboard
        case analysis
        case history
        case journal
        case settings
    }

    @StateObject private var dashboardViewModel: DashboardViewModel
    @StateObject private var historyViewModel: HistoryViewModel
    @StateObject private var journalViewModel: JournalViewModel
    @StateObject private var settingsViewModel: SettingsViewModel
    @StateObject private var onboardingViewModel: OnboardingViewModel
    @StateObject private var analysisViewModel: AnalysisViewModel
    @State private var selectedTab: AppTab = .dashboard
    @State private var routedDecision: Decision?

    init(environment: AppEnvironment) {
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
                TabView(selection: $selectedTab) {
                    DashboardView(viewModel: dashboardViewModel)
                        .tabItem { Label("Dashboard", systemImage: "chart.line.uptrend.xyaxis") }
                        .tag(AppTab.dashboard)
                    FullAnalysisView(viewModel: analysisViewModel)
                        .tabItem { Label("Analysis", systemImage: "doc.text.magnifyingglass") }
                        .tag(AppTab.analysis)
                    SignalHistoryView(viewModel: historyViewModel)
                        .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }
                        .tag(AppTab.history)
                    JournalView(viewModel: journalViewModel)
                        .tabItem { Label("Journal", systemImage: "book.closed") }
                        .tag(AppTab.journal)
                    SettingsView(viewModel: settingsViewModel, dashboardViewModel: dashboardViewModel)
                        .tabItem { Label("Settings", systemImage: "gearshape") }
                        .tag(AppTab.settings)
                }
                .tint(GoldMetaColor.gold)
                .task { await dashboardViewModel.loadLatestDecision() }
                .onReceive(dashboardViewModel.environment.notificationRouter.$routedDecisionId.compactMap { $0 }) { decisionId in
                    Task { await openRoutedDecision(decisionId) }
                }
                .sheet(item: $routedDecision) { decision in
                    FullAnalysisView(viewModel: analysisViewModel, suppliedDecision: decision)
                }
            } else {
                OnboardingView(viewModel: onboardingViewModel)
            }
        }
        .background(GoldMetaColor.background.ignoresSafeArea())
    }

    private func openRoutedDecision(_ decisionId: String) async {
        do {
            routedDecision = try await dashboardViewModel.environment.decisionService.decision(id: decisionId)
        } catch {
            selectedTab = .history
            await historyViewModel.loadHistory()
        }
    }
}

#Preview {
    let environment = AppEnvironment.preview
    ContentView(environment: environment)
        .environmentObject(environment)
}
