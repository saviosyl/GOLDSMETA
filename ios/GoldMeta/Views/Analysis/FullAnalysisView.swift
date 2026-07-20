import SwiftUI

struct FullAnalysisView: View {
    @ObservedObject var viewModel: AnalysisViewModel
    let suppliedDecision: Decision?

    init(viewModel: AnalysisViewModel, suppliedDecision: Decision? = nil) {
        self.viewModel = viewModel
        self.suppliedDecision = suppliedDecision
    }

    private var decision: Decision? { suppliedDecision ?? viewModel.decision }

    var body: some View {
        NavigationStack {
            ZStack {
                GoldMetaColor.atmosphere.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if let decision {
                            analysis(decision)
                        } else {
                            EmptyStateView(title: "No analysis yet", message: viewModel.errorMessage ?? "Load the latest decision to see a full breakdown.")
                        }
                    }
                    .padding(18)
                }
            }
            .navigationTitle("Full Analysis")
            .task { if suppliedDecision == nil { await viewModel.load() } }
        }
    }

    private func analysis(_ decision: Decision) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            GoldCard {
                VStack(alignment: .leading, spacing: 12) {
                    HStack { DecisionBadge(decision: decision.decision, isProvisional: decision.isProvisional); Spacer(); DataQualityBadge(dataQuality: decision.dataQuality, source: decision.dataSourceLabel) }
                    PriceRow("Decision ID", value: decision.decisionId)
                    PriceRow("Lifecycle", value: decision.lifecycleState.rawValue)
                    PriceRow("Rule config", value: decision.ruleConfigVersion)
                    PriceRow("Backend", value: decision.backendVersion)
                    PriceRow("Generated", value: decision.generatedAt.shortDateTime)
                    PriceRow("Valid until", value: decision.validUntil.shortDateTime)
                }
            }
            section("Market context", rows: [
                ("Symbol", decision.symbol),
                ("Price", decision.lastKnownPrice?.xauPrice ?? "N/A"),
                ("Session", decision.currentSession ?? "Unknown"),
                ("HTF bias", decision.higherTimeframeBias?.rawValue ?? "Unknown"),
                ("Regime", decision.marketRegime.displayName),
                ("Market data time", decision.marketDataTime.shortDateTime)
            ])
            tradePlan(decision)
            listSection("Bullish evidence", items: decision.bullishEvidence, empty: "No bullish evidence recorded.", color: GoldMetaColor.buy)
            listSection("Bearish evidence", items: decision.bearishEvidence, empty: "No bearish evidence recorded.", color: GoldMetaColor.sell)
            listSection("Reason summary", items: decision.reasonSummary, empty: "No summary available.", color: GoldMetaColor.gold)
            listSection("Reason codes", items: decision.reasonCodes, empty: "No reason codes.", color: GoldMetaColor.textSecondary)
            listSection("Warnings", items: decision.warnings, empty: "No warnings.", color: GoldMetaColor.wait)
            listSection("Missing inputs", items: decision.missingInputs, empty: "No missing inputs.", color: GoldMetaColor.stale)
            section("Invalidation and exits", rows: [
                ("Invalidation", decision.invalidation),
                ("Early exit now", decision.earlyExit.exitNow ? "Yes" : "No"),
                ("Exit conditions", decision.earlyExit.conditions.joined(separator: ", ")),
                ("Breakeven", decision.breakeven.state.displayName),
                ("Breakeven trigger", decision.breakeven.trigger ?? "N/A"),
                ("New stop", decision.breakeven.newStop?.xauPrice ?? "N/A")
            ])
            section("AI and safety", rows: [
                ("AI model", decision.aiModelId ?? "Not used"),
                ("AI prompt", decision.aiPromptVersion ?? "N/A"),
                ("Safety downgraded", decision.aiSafetyDowngraded ? "Yes" : "No"),
                ("Notification sent", decision.notificationSent ? "Yes" : "No")
            ])
            DisclaimerBanner(compact: true)
        }
    }

    private func tradePlan(_ decision: Decision) -> some View {
        GoldCard {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader("Trade plan", subtitle: "Prices are support information, not order instructions.")
                PriceRow("Entry", value: decision.entry.displayPrice, detail: decision.entry.condition)
                PriceRow("Stop", value: decision.stopLoss.price?.xauPrice ?? "N/A", detail: decision.stopLoss.reason)
                ForEach(decision.takeProfits) { PriceRow($0.label, value: $0.price.xauPrice, detail: $0.reason) }
                PriceRow("RR TP1", value: decision.riskReward.tp1?.ratioText ?? "N/A")
                PriceRow("RR TP2", value: decision.riskReward.tp2?.ratioText ?? "N/A")
                PriceRow("RR TP3", value: decision.riskReward.tp3?.ratioText ?? "N/A")
            }
        }
    }

    private func section(_ title: String, rows: [(String, String)]) -> some View {
        GoldCard {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title)
                ForEach(rows, id: \.0) { PriceRow($0.0, value: $0.1) }
            }
        }
    }

    private func listSection(_ title: String, items: [String], empty: String, color: Color) -> some View {
        GoldCard {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title)
                if items.isEmpty {
                    Text(empty).foregroundStyle(GoldMetaColor.textSecondary)
                } else {
                    ForEach(items, id: \.self) { item in
                        Label(item, systemImage: "circle.fill")
                            .font(GoldMetaFont.body)
                            .foregroundStyle(color)
                    }
                }
            }
        }
    }
}
