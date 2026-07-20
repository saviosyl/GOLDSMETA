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
                    Section("Webhook") {
                        Text(viewModel.settings.webhookURL)
                            .font(.caption.monospaced())
                            .textSelection(.enabled)
                        Button {
                            UIPasteboard.general.string = viewModel.settings.webhookURL
                        } label: {
                            Label("Copy webhook URL", systemImage: "doc.on.doc")
                        }
                        ShareLink(item: viewModel.settings.webhookURL) {
                            Label("Share webhook URL", systemImage: "square.and.arrow.up")
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
        }
    }
}
