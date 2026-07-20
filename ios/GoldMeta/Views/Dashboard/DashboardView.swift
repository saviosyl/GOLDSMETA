import SwiftUI

struct DashboardView: View {
    @ObservedObject var viewModel: DashboardViewModel

    var body: some View {
        NavigationStack {
            ZStack {
                GoldMetaColor.atmosphere.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        header
                        content
                    }
                    .padding(18)
                }
                .refreshable { await viewModel.refresh() }
            }
            .navigationTitle("Dashboard")
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("XAUUSD")
                .font(GoldMetaFont.display(34, weight: .bold))
                .foregroundStyle(GoldMetaColor.textPrimary)
            Text("Gold spot decision support")
                .foregroundStyle(GoldMetaColor.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            GoldCard {
                HStack { ProgressView().tint(GoldMetaColor.gold); Text("Loading latest decision...") }
            }
        case .failed(let message):
            EmptyStateView(title: "Unable to load", message: message)
        case .offline(let cached):
            if let cached {
                statusBanner("OFFLINE", message: "Showing cached decision. Treat as decision support only and verify live price.")
                decisionCard(cached)
            } else {
                EmptyStateView(title: "Offline", message: "No cached decision is available yet.")
            }
        case .loaded(let decision):
            if decision.isStale || decision.dataSourceLabel != .live && decision.dataSourceLabel != .mock {
                statusBanner(decision.dataSourceLabel.rawValue, message: "Data is not live. WAIT or verify externally before taking any action.")
            }
            decisionCard(decision)
        }
    }

    private func statusBanner(_ title: String, message: String) -> some View {
        GoldCard {
            HStack(alignment: .top) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(GoldMetaColor.wait)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(GoldMetaFont.rounded(.headline, weight: .bold))
                    Text(message).foregroundStyle(GoldMetaColor.textSecondary)
                }
            }
        }
    }

    private func decisionCard(_ decision: Decision) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            GoldCard {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .center) {
                        DecisionBadge(decision: decision.decision, isProvisional: decision.isProvisional)
                        Spacer()
                        DataQualityBadge(dataQuality: decision.dataQuality, source: decision.dataSourceLabel)
                    }
                    Text(decision.lastKnownPrice?.xauPrice ?? "No price")
                        .font(GoldMetaFont.price)
                        .foregroundStyle(GoldMetaColor.textPrimary)
                        .accessibilityLabel("Last known price \(decision.lastKnownPrice?.xauPrice ?? "unavailable")")
                    HStack {
                        metric("Confidence", value: "\(decision.confidence.percentText) \(decision.confidenceLabel.displayName)")
                        metric("Age", value: decision.generatedAt.relativeShort)
                        metric("Score", value: String(format: "%.0f", decision.setupScore))
                    }
                    Divider().overlay(GoldMetaColor.gold.opacity(0.2))
                    PriceRow("Entry", value: decision.entry.displayPrice, detail: decision.entry.condition)
                    PriceRow("Stop loss", value: decision.stopLoss.price?.xauPrice ?? "N/A", detail: decision.stopLoss.reason)
                    ForEach(decision.takeProfits) { target in
                        PriceRow(target.label, value: target.price.xauPrice, detail: target.reason)
                    }
                    PriceRow("Risk/reward", value: decision.riskReward.bestAvailable?.ratioText ?? "N/A", detail: "TP1 \(decision.riskReward.tp1?.ratioText ?? "-") / TP2 \(decision.riskReward.tp2?.ratioText ?? "-") / TP3 \(decision.riskReward.tp3?.ratioText ?? "-")")
                    PriceRow("Session", value: decision.currentSession ?? "Unknown")
                    PriceRow("HTF bias", value: decision.higherTimeframeBias?.rawValue ?? "Unknown")
                }
            }

            GoldCard {
                VStack(alignment: .leading, spacing: 10) {
                    SectionHeader("Explanation")
                    ForEach(decision.reasonSummary, id: \.self) { reason in
                        Label(reason, systemImage: "sparkle.magnifyingglass")
                            .foregroundStyle(GoldMetaColor.textSecondary)
                    }
                    if !decision.warnings.isEmpty {
                        Divider().overlay(GoldMetaColor.gold.opacity(0.2))
                        ForEach(decision.warnings, id: \.self) { warning in
                            Label(warning, systemImage: "exclamationmark.triangle")
                                .foregroundStyle(GoldMetaColor.wait)
                        }
                    }
                }
            }

            HStack(spacing: 12) {
                NavigationLink {
                    FullAnalysisView(viewModel: AnalysisViewModel(environment: AppEnvironment.preview), suppliedDecision: decision)
                } label: {
                    Label("Open Full Analysis", systemImage: "doc.text.magnifyingglass")
                }
                .buttonStyle(.bordered)
                .tint(GoldMetaColor.gold)

                Button("Mark Trade Taken") { viewModel.markTradeTaken() }
                    .buttonStyle(.borderedProminent)
                    .tint(decision.decision.color)
                    .accessibilityLabel(decision.decision == .wait ? "Record skipped trade" : "Mark trade taken")
            }
            Button {
                Task { await viewModel.refresh() }
            } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(GoldMetaColor.gold)
        }
    }

    private func metric(_ label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(GoldMetaColor.textSecondary)
            Text(value).font(GoldMetaFont.rounded(.callout, weight: .semibold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
