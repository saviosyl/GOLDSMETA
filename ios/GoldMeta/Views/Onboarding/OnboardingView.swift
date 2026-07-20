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
                    Text("Phase 1 mock mode works without Firebase or live credentials.")
                        .foregroundStyle(GoldMetaColor.textSecondary)
                    #if DEBUG
                    Button("Use DEBUG mock sign-in") { viewModel.enableMockSignIn() }
                        .buttonStyle(.borderedProminent)
                        .tint(GoldMetaColor.gold)
                    Text(viewModel.signInState)
                        .font(.caption)
                        .foregroundStyle(GoldMetaColor.textSecondary)
                    #endif
                }
            }
        case 3:
            GoldCard {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Notifications")
                        .font(GoldMetaFont.title)
                    Text("GoldMeta can notify you when a new decision-support update is available. Notifications never execute trades.")
                        .foregroundStyle(GoldMetaColor.textSecondary)
                    Button("Request notification permission") {
                        Task { await viewModel.requestNotifications() }
                    }
                    .buttonStyle(.bordered)
                    .tint(GoldMetaColor.gold)
                }
            }
        case 4:
            GoldCard {
                VStack(alignment: .leading, spacing: 12) {
                    Text("TradingView webhook")
                        .font(GoldMetaFont.title)
                    Text("Use this URL when live backend setup is available. Keep it private.")
                        .foregroundStyle(GoldMetaColor.textSecondary)
                    Text(viewModel.settings.webhookURL)
                        .font(.footnote.monospaced())
                        .textSelection(.enabled)
                        .foregroundStyle(GoldMetaColor.gold)
                    Button {
                        UIPasteboard.general.string = viewModel.settings.webhookURL
                    } label: {
                        Label("Copy webhook URL", systemImage: "doc.on.doc")
                    }
                    ShareLink(item: viewModel.settings.webhookURL) {
                        Label("Share URL", systemImage: "square.and.arrow.up")
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
