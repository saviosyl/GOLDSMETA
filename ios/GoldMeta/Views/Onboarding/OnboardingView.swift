import SwiftUI
import UIKit

struct OnboardingView: View {
    @ObservedObject var viewModel: OnboardingViewModel

    var body: some View {
        ZStack {
            GoldMetaColor.atmosphere.ignoresSafeArea()
            VStack(spacing: 20) {
                ProgressView(value: Double(viewModel.currentStep + 1), total: Double(viewModel.steps.count))
                    .tint(GoldMetaColor.gold)
                    .accessibilityLabel("Onboarding step \(viewModel.currentStep + 1) of \(viewModel.steps.count)")

                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        Text("GoldMeta")
                            .font(GoldMetaFont.display(42, weight: .bold))
                            .foregroundStyle(GoldMetaColor.gold)
                        Text(viewModel.steps[viewModel.currentStep])
                            .font(GoldMetaFont.title)
                            .foregroundStyle(GoldMetaColor.textPrimary)
                        stepContent
                    }
                    .padding(24)
                }

                HStack {
                    if viewModel.currentStep > 0 {
                        Button("Back") { viewModel.previous() }
                            .foregroundStyle(GoldMetaColor.textSecondary)
                    }
                    Spacer()
                    GoldPrimaryButton(viewModel.currentStep == viewModel.steps.count - 1 ? "Finish" : "Continue") {
                        viewModel.next()
                    }
                    .frame(maxWidth: 220)
                    .disabled(viewModel.isWorking)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 20)
            }
        }
    }

    @ViewBuilder
    private var stepContent: some View {
        switch viewModel.currentStep {
        case 0:
            GoldCard {
                VStack(alignment: .leading, spacing: 12) {
                    Text("XAUUSD decision support for disciplined trading.")
                        .font(GoldMetaFont.rounded(.title3, weight: .semibold))
                    Text("GoldMeta summarizes deterministic market analysis into BUY, SELL, or WAIT decisions with risk levels, invalidation, and evidence.")
                        .foregroundStyle(GoldMetaColor.textSecondary)
                }
            }
        case 1:
            DisclaimerBanner()
        case 2:
            GoldCard {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Sign in")
                        .font(GoldMetaFont.title)
                    Text("Use the Firebase email/password account that owns your GoldMeta backend data.")
                        .foregroundStyle(GoldMetaColor.textSecondary)
                    TextField("Email", text: $viewModel.email)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        .textContentType(.username)
                        .autocorrectionDisabled()
                    SecureField("Password", text: $viewModel.password)
                        .textContentType(viewModel.isCreatingAccount ? .newPassword : .password)
                    Toggle("Create a new account", isOn: $viewModel.isCreatingAccount)
                    Button {
                        Task { await viewModel.submitAuth() }
                    } label: {
                        Label(viewModel.isCreatingAccount ? "Create account" : "Sign in", systemImage: "person.crop.circle.badge.checkmark")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(GoldMetaColor.gold)
                    #if DEBUG
                    if viewModel.canUseDebugMockSignIn {
                        Button("Use DEBUG mock sign-in") {
                            Task { await viewModel.enableMockSignIn() }
                        }
                        .buttonStyle(.bordered)
                        .tint(GoldMetaColor.gold)
                    }
                    #endif
                    Text(viewModel.authStatus)
                        .font(.caption)
                        .foregroundStyle(GoldMetaColor.textSecondary)
                }
            }
        case 3:
            GoldCard {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Notifications")
                        .font(GoldMetaFont.title)
                    Text("GoldMeta can notify you when a new decision-support update is available. Notifications never execute trades.")
                        .foregroundStyle(GoldMetaColor.textSecondary)
                    Text(viewModel.environmentNotificationExplanation)
                        .font(.caption)
                        .foregroundStyle(GoldMetaColor.textSecondary)
                    Button("Request notification permission") {
                        Task { await viewModel.requestNotifications() }
                    }
                    .buttonStyle(.bordered)
                    .tint(GoldMetaColor.gold)
                    Text(viewModel.notificationStatus)
                        .font(.caption)
                        .foregroundStyle(GoldMetaColor.textSecondary)
                }
            }
        case 4:
            GoldCard {
                VStack(alignment: .leading, spacing: 12) {
                    Text("TradingView webhook")
                        .font(GoldMetaFont.title)
                    Text("Create this in the backend, then paste the URL into your TradingView alert. Keep the URL and secret private.")
                        .foregroundStyle(GoldMetaColor.textSecondary)
                    Text(viewModel.webhookURL)
                        .font(.footnote.monospaced())
                        .textSelection(.enabled)
                        .foregroundStyle(GoldMetaColor.gold)
                    Button {
                        Task { await viewModel.createConnection() }
                    } label: {
                        Label("Create backend connection", systemImage: "link.badge.plus")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(GoldMetaColor.gold)
                    Button {
                        UIPasteboard.general.string = viewModel.webhookURL
                    } label: {
                        Label("Copy webhook URL", systemImage: "doc.on.doc")
                    }
                    if !viewModel.payloadSecret.isEmpty {
                        Button {
                            UIPasteboard.general.string = viewModel.payloadSecret
                        } label: {
                            Label("Copy payload secret", systemImage: "lock.doc")
                        }
                    }
                    Button {
                        UIPasteboard.general.string = viewModel.exampleJSON
                    } label: {
                        Label("Copy example JSON", systemImage: "curlybraces")
                    }
                    Button {
                        Task { await viewModel.sendTestAlert() }
                    } label: {
                        Label("Send test alert", systemImage: "paperplane")
                    }
                    .buttonStyle(.bordered)
                    .tint(GoldMetaColor.gold)
                    Text(viewModel.connectionStatus)
                        .font(.caption)
                        .foregroundStyle(GoldMetaColor.textSecondary)
                    if let testAlertStatus = viewModel.testAlertStatus {
                        Text(testAlertStatus)
                            .font(.caption)
                            .foregroundStyle(GoldMetaColor.textSecondary)
                    }
                }
            }
        default:
            GoldCard {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Start in paper mode")
                        .font(GoldMetaFont.title)
                    Text("Paper trading is recommended while you validate setup quality, alerts, and personal execution discipline.")
                        .foregroundStyle(GoldMetaColor.textSecondary)
                    Label("Risk defaults never exceed 1% per idea.", systemImage: "checkmark.shield")
                        .foregroundStyle(GoldMetaColor.buy)
                    DisclaimerBanner(compact: true)
                }
            }
        }
    }
}
