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
                    Section("Trading mode") {
                        Picker("Mode", selection: Binding(
                            get: { viewModel.settings.tradingMode },
                            set: { mode in Task { await viewModel.setTradingMode(mode) } }
                        )) {
                            ForEach(TradingMode.allCases) { mode in
                                Text(mode.title).tag(mode)
                            }
                        }
                        Text(viewModel.settings.tradingMode.summary)
                            .font(.caption)
                        if viewModel.settings.tradingMode == .demoAuto || viewModel.settings.tradingMode == .liveAuto {
                            Toggle("Auto trading enabled", isOn: Binding(
                                get: { viewModel.settings.autoTradingEnabled },
                                set: { enabled in Task { await viewModel.setAutoTradingEnabled(enabled) } }
                            ))
                        }
                        Toggle("I understand profits are not guaranteed", isOn: Binding(
                            get: { viewModel.settings.tradingDisclaimerAcknowledged },
                            set: { viewModel.acknowledgeTradingDisclaimer($0) }
                        ))
                        Text(viewModel.tradingStatusText)
                            .font(.caption)
                        Text(viewModel.brokerPolicyText)
                            .font(.caption2)
                        if !viewModel.settings.liveAutoUnlocked {
                            Text("Live Auto unlock: \(viewModel.settings.demoClosedTrades)/\(viewModel.settings.demoRequiredClosedTrades) demo closes · \(viewModel.settings.demoRequiredDays) days required.")
                                .font(.caption2)
                        }
                    }

                    Section("Emergency controls") {
                        Button(role: .destructive) {
                            Task { await viewModel.emergencyStop() }
                        } label: {
                            Label("STOP AUTO TRADING", systemImage: "hand.raised.fill")
                                .font(.headline.weight(.bold))
                                .frame(maxWidth: .infinity)
                        }
                        .accessibilityLabel("Emergency stop auto trading")
                        if viewModel.settings.emergencyStopActive {
                            Button("Clear emergency stop") {
                                Task { await viewModel.clearEmergencyStop() }
                            }
                        }
                        Text("Immediately blocks new automated orders and asks the backend to cancel pending orders.")
                            .font(.caption)
                    }

                    Section("Risk controls") {
                        Stepper(
                            "Max risk / trade: \(viewModel.settings.riskControls.maxRiskPerTradePercent, format: .number.precision(.fractionLength(2)))%",
                            value: Binding(
                                get: { viewModel.settings.riskControls.maxRiskPerTradePercent },
                                set: { value in viewModel.updateRiskControls { $0.maxRiskPerTradePercent = min(value, 1) } }
                            ),
                            in: 0.05...1,
                            step: 0.05
                        )
                        Stepper(
                            "Max daily loss: \(viewModel.settings.riskControls.maxDailyLossPercent, format: .number.precision(.fractionLength(1)))%",
                            value: Binding(
                                get: { viewModel.settings.riskControls.maxDailyLossPercent },
                                set: { value in viewModel.updateRiskControls { $0.maxDailyLossPercent = value } }
                            ),
                            in: 0.5...10,
                            step: 0.5
                        )
                        Stepper(
                            "Max trades / day: \(viewModel.settings.riskControls.maxTradesPerDay)",
                            value: Binding(
                                get: { viewModel.settings.riskControls.maxTradesPerDay },
                                set: { value in viewModel.updateRiskControls { $0.maxTradesPerDay = value } }
                            ),
                            in: 1...20
                        )
                        Stepper(
                            "Min confidence: \(Int(viewModel.settings.riskControls.minConfidence))%",
                            value: Binding(
                                get: { viewModel.settings.riskControls.minConfidence },
                                set: { value in viewModel.updateRiskControls { $0.minConfidence = value } }
                            ),
                            in: 50...95,
                            step: 5
                        )
                        Toggle("Block stale data", isOn: Binding(
                            get: { viewModel.settings.riskControls.blockStaleData },
                            set: { value in viewModel.updateRiskControls { $0.blockStaleData = value } }
                        ))
                        Toggle("Block duplicate signals", isOn: Binding(
                            get: { viewModel.settings.riskControls.blockDuplicateSignals },
                            set: { value in viewModel.updateRiskControls { $0.blockDuplicateSignals = value } }
                        ))
                        Toggle("Block high-impact news", isOn: Binding(
                            get: { viewModel.settings.riskControls.blockHighImpactNews },
                            set: { value in viewModel.updateRiskControls { $0.blockHighImpactNews = value } }
                        ))
                        Text("Martingale, grid recovery, and averaging down are permanently disabled.")
                            .font(.caption)
                    }

                    Section("Risk size") {
                        Picker("Risk per idea", selection: Binding(
                            get: { viewModel.settings.riskPercent },
                            set: { viewModel.setRiskPercent($0) }
                        )) {
                            ForEach(UserSettings.defaultRiskOptions, id: \.self) { option in
                                Text(option.formatted(.number.precision(.fractionLength(2))) + "%").tag(option)
                            }
                        }
                        Text("Default options are capped at 1%. Size is never increased to recover losses.")
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
