import SwiftUI
import UIKit

struct SettingsView: View {
    @ObservedObject var viewModel: SettingsViewModel
    @ObservedObject var dashboardViewModel: DashboardViewModel

    var body: some View {
        NavigationStack {
            ZStack {
                GoldMetaColor.atmosphere.ignoresSafeArea()
                Form {
                    Section("Risk") {
                        Picker("Risk per idea", selection: Binding(
                            get: { viewModel.settings.riskPercent },
                            set: { viewModel.setRiskPercent($0) }
                        )) {
                            ForEach(UserSettings.defaultRiskOptions, id: \.self) { option in
                                Text(option.formatted(.number.precision(.fractionLength(2))) + "%").tag(option)
                            }
                        }
                        Text("Default options are capped at 1%. Increase discipline before size.")
                            .font(.caption)
                    }
                    Section("Trading mode") {
                        Toggle("Paper trading mode", isOn: Binding(
                            get: { viewModel.settings.paperTradingMode },
                            set: { viewModel.togglePaperMode($0) }
                        ))
                        Text("Paper mode is recommended until live alerts and journaling are proven.")
                            .font(.caption)
                    }
                    Section("API and account") {
                        LabeledContent("API mode", value: viewModel.apiModeText)
                        Text(viewModel.authStatusText)
                            .font(.caption)
                        Button(role: .destructive) {
                            Task { await viewModel.signOut() }
                        } label: {
                            Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    }
                    Section("Notifications") {
                        LabeledContent("Push registration", value: viewModel.pushStatusText)
                        Text(viewModel.notificationExplanationText)
                            .font(.caption)
                        Button {
                            Task { await viewModel.requestPushRegistration() }
                        } label: {
                            Label("Register for push notifications", systemImage: "bell.badge")
                        }
                    }
                    Section("TradingView connection") {
                        Text(viewModel.copyLatestWebhookURL())
                            .font(.caption.monospaced())
                            .textSelection(.enabled)
                        Button {
                            Task { await viewModel.createTradingViewConnection() }
                        } label: {
                            Label("Create backend connection", systemImage: "link.badge.plus")
                        }
                        Button {
                            UIPasteboard.general.string = viewModel.copyLatestWebhookURL()
                        } label: {
                            Label("Copy webhook URL", systemImage: "doc.on.doc")
                        }
                        if !viewModel.copyLatestPayloadSecret().isEmpty {
                            Button {
                                UIPasteboard.general.string = viewModel.copyLatestPayloadSecret()
                            } label: {
                                Label("Copy payload secret", systemImage: "lock.doc")
                            }
                        }
                        Button {
                            UIPasteboard.general.string = viewModel.exampleJSON()
                        } label: {
                            Label("Copy example JSON", systemImage: "curlybraces")
                        }
                        Button {
                            Task { await viewModel.sendTestAlert() }
                        } label: {
                            Label("Send test alert", systemImage: "paperplane")
                        }
                        Text(viewModel.connectionStatusText)
                            .font(.caption)
                        if let testAlertStatusText = viewModel.testAlertStatusText {
                            Text(testAlertStatusText)
                                .font(.caption)
                        }
                        ForEach(viewModel.tradingViewConnections) { connection in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(connection.id).font(.caption.monospaced())
                                Text(connection.status ?? "ACTIVE").font(.caption2)
                            }
                        }
                    }
                    Section("Disclaimer") {
                        DisclaimerBanner(compact: true)
                    }
                    Section("Versions") {
                        LabeledContent("App", value: viewModel.appVersionText)
                        LabeledContent("Schema", value: "1.0")
                        LabeledContent("Bundle", value: Bundle.main.bundleIdentifier ?? "app.goldmeta.GoldMeta")
                    }
                    #if DEBUG
                    Section("Developer") {
                        Button("Cycle mock fixture") {
                            Task {
                                if await viewModel.cycleMockFixture() != nil {
                                    await dashboardViewModel.loadLatestDecision()
                                }
                            }
                        }
                        Picker("Fixture", selection: Binding(
                            get: { viewModel.settings.selectedMockFixtureIndex },
                            set: { index in
                                Task {
                                    if await viewModel.selectMockFixture(index: index) != nil {
                                        await dashboardViewModel.loadLatestDecision()
                                    }
                                }
                            }
                        )) {
                            ForEach(Array(MockDecisionService.fixtureNames.enumerated()), id: \.offset) { index, name in
                                Text(name.replacingOccurrences(of: "_", with: " ").capitalized).tag(index)
                            }
                        }
                        if let action = viewModel.lastDeveloperAction {
                            Text(action).font(.caption).foregroundStyle(GoldMetaColor.textSecondary)
                        }
                    }
                    #endif
                }
                .scrollContentBackground(.hidden)
                .background(Color.clear)
            }
            .navigationTitle("Settings")
            .task { await viewModel.refreshRemoteConfiguration() }
        }
    }
}
