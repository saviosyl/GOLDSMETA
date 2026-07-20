import SwiftUI

struct DashboardView: View {
    @ObservedObject var viewModel: DashboardViewModel

    var body: some View {
        NavigationStack {
            ZStack {
                GoldMetaColor.atmosphere.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        header
                        scenarioPicker
                        content
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 14)
                }
                .refreshable { await viewModel.refresh() }
            }
            .navigationTitle("XAUUSD")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("GoldMeta")
                .font(GoldMetaFont.display(28, weight: .bold))
                .foregroundStyle(GoldMetaColor.gold)
            Text("XAUUSD decision support")
                .font(GoldMetaFont.rounded(.subheadline, weight: .medium))
                .foregroundStyle(GoldMetaColor.textSecondary)
            tradingModeBar
        }
        .accessibilityElement(children: .contain)
    }

    private var tradingModeBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(viewModel.tradingModeTitle)
                    .font(GoldMetaFont.rounded(.caption, weight: .bold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(GoldMetaColor.gold.opacity(0.2)))
                if viewModel.emergencyStopActive {
                    Text("STOPPED")
                        .font(GoldMetaFont.rounded(.caption, weight: .bold))
                        .foregroundStyle(GoldMetaColor.sell)
                }
                Spacer()
            }
            Button(role: .destructive) {
                Task { await viewModel.emergencyStopTrading() }
            } label: {
                Label("STOP AUTO TRADING", systemImage: "hand.raised.fill")
                    .font(GoldMetaFont.rounded(.subheadline, weight: .bold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 14).fill(GoldMetaColor.sell.opacity(0.9)))
                    .foregroundStyle(.white)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Emergency stop auto trading")
        }
    }

    private var scenarioPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Mock scenarios")
                .font(GoldMetaFont.caption)
                .foregroundStyle(GoldMetaColor.textSecondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(DashboardViewModel.mvpScenarioTitles.enumerated()), id: \.offset) { index, title in
                        Button {
                            Task { await viewModel.selectMVPScenario(index: index) }
                        } label: {
                            Text(title)
                                .font(GoldMetaFont.rounded(.caption, weight: .semibold))
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(
                                    Capsule()
                                        .fill(index == viewModel.selectedMVPScenarioIndex
                                              ? GoldMetaColor.gold.opacity(0.24)
                                              : GoldMetaColor.elevated)
                                )
                                .overlay(
                                    Capsule()
                                        .stroke(
                                            index == viewModel.selectedMVPScenarioIndex
                                            ? GoldMetaColor.gold.opacity(0.7)
                                            : GoldMetaColor.gold.opacity(0.15),
                                            lineWidth: 1
                                        )
                                )
                                .foregroundStyle(GoldMetaColor.textPrimary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Load \(title) scenario")
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            GoldCard {
                HStack(spacing: 12) {
                    ProgressView().tint(GoldMetaColor.gold)
                    Text("Loading latest decision...")
                        .foregroundStyle(GoldMetaColor.textSecondary)
                }
            }
        case .failed(let message):
            EmptyStateView(title: "Unable to load", message: message)
        case .offline(let cached):
            if let cached {
                statusBanner("OFFLINE", message: "Showing cached decision. Treat as decision support only and verify live price.")
                decisionCard(cached, sourceOverride: .offline)
            } else {
                EmptyStateView(title: "Offline", message: "No cached decision is available yet.")
            }
        case .loaded(let decision):
            if decision.isStale || (decision.dataSourceLabel != .live && decision.dataSourceLabel != .mock) {
                statusBanner(decision.dataSourceLabel.rawValue, message: "Data is not live. WAIT or verify externally before taking any action.")
            }
            decisionCard(decision)
        }
    }

    private func statusBanner(_ title: String, message: String) -> some View {
        GoldCard {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(GoldMetaColor.wait)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(GoldMetaFont.rounded(.headline, weight: .bold))
                    Text(message).foregroundStyle(GoldMetaColor.textSecondary)
                }
            }
        }
    }

    private func decisionCard(_ decision: Decision, sourceOverride: DataSourceLabel? = nil) -> some View {
        let display = decision.display

        return VStack(alignment: .leading, spacing: 16) {
            heroCard(decision, display: display, sourceOverride: sourceOverride)
            levelsCard(display)
            tradePlanCard(decision, display: display)
            evidenceCard(display)
            actionsCard(decision)
            DisclaimerBanner(compact: true)
            secondaryLinks(decision)
        }
    }

    private func heroCard(_ decision: Decision, display: DecisionDisplay, sourceOverride: DataSourceLabel?) -> some View {
        GoldCard {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(display.scenarioTitle)
                            .font(GoldMetaFont.caption)
                            .foregroundStyle(GoldMetaColor.textSecondary)
                        Text(display.decisionLabel)
                            .font(GoldMetaFont.display(48, weight: .bold))
                            .foregroundStyle(decision.decision.color)
                            .accessibilityLabel("Decision \(display.decisionLabel)")
                        if decision.isProvisional || decision.shouldShowTestBadge {
                            DecisionBadge(
                                decision: decision.decision,
                                isProvisional: decision.isProvisional,
                                isTestDecision: decision.shouldShowTestBadge
                            )
                        }
                    }
                    Spacer(minLength: 8)
                    DataQualityBadge(dataQuality: decision.dataQuality, source: sourceOverride ?? decision.dataSourceLabel)
                }

                Text(display.currentPriceText)
                    .font(GoldMetaFont.price)
                    .foregroundStyle(GoldMetaColor.textPrimary)
                    .accessibilityLabel("Current price \(display.currentPriceText)")

                HStack(spacing: 12) {
                    metricTile("Confidence", value: display.confidenceText, detail: display.confidenceDetail)
                    metricTile("Trend", value: display.trendText, detail: decision.marketRegime.displayName)
                    metricTile("Age", value: decision.generatedAt.relativeShort, detail: decision.currentSession ?? "Session")
                }
            }
        }
    }

    private func levelsCard(_ display: DecisionDisplay) -> some View {
        GoldCard {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader("Market structure", subtitle: "Volume profile levels")
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    levelCell("POC", value: display.pocText)
                    levelCell("VAH", value: display.vahText)
                    levelCell("VAL", value: display.valText)
                    levelCell("Trend", value: display.trendText)
                }
            }
        }
    }

    private func tradePlanCard(_ decision: Decision, display: DecisionDisplay) -> some View {
        GoldCard {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader("Trade plan", subtitle: decision.entry.condition)
                PriceRow("Entry", value: display.entryText, detail: decision.entry.type.displayName)
                PriceRow("Stop loss", value: display.stopLossText, detail: decision.stopLoss.reason)
                PriceRow("TP1", value: display.tp1Text, detail: decision.takeProfits.first(where: { $0.label.uppercased() == "TP1" })?.reason)
                PriceRow("TP2", value: display.tp2Text, detail: decision.takeProfits.first(where: { $0.label.uppercased() == "TP2" })?.reason)
                PriceRow("TP3", value: display.tp3Text, detail: decision.takeProfits.first(where: { $0.label.uppercased() == "TP3" })?.reason)
                PriceRow(
                    "Risk / reward",
                    value: display.riskRewardText,
                    detail: "TP1 \(decision.riskReward.tp1?.ratioText ?? "—") · TP2 \(decision.riskReward.tp2?.ratioText ?? "—") · TP3 \(decision.riskReward.tp3?.ratioText ?? "—")"
                )
            }
        }
    }

    private func evidenceCard(_ display: DecisionDisplay) -> some View {
        GoldCard {
            VStack(alignment: .leading, spacing: 14) {
                SectionHeader("Reasons")
                evidenceColumn(title: "Supporting", icon: "checkmark.circle.fill", color: GoldMetaColor.buy, items: display.supportingReasons)
                evidenceColumn(title: "Opposing", icon: "exclamationmark.circle.fill", color: GoldMetaColor.sell, items: display.opposingReasons)
            }
        }
    }

    private func evidenceColumn(title: String, icon: String, color: Color, items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: icon)
                .font(GoldMetaFont.rounded(.subheadline, weight: .semibold))
                .foregroundStyle(color)
            if items.isEmpty {
                Text("None listed")
                    .font(.caption)
                    .foregroundStyle(GoldMetaColor.textSecondary)
            } else {
                ForEach(items, id: \.self) { item in
                    Text(item)
                        .font(GoldMetaFont.rounded(.callout))
                        .foregroundStyle(GoldMetaColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func actionsCard(_ decision: Decision) -> some View {
        GoldCard {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader("Actions", subtitle: "Log the next step for this decision")
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    ForEach(decision.actionsForDisplay) { action in
                        Button {
                            viewModel.applyTradeAction(action)
                        } label: {
                            actionLabel(action)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(action.title)
                    }
                }
                if let message = viewModel.lastActionMessage {
                    Text(message)
                        .font(GoldMetaFont.caption)
                        .foregroundStyle(GoldMetaColor.gold)
                        .accessibilityLabel(message)
                }
            }
        }
    }

    private func secondaryLinks(_ decision: Decision) -> some View {
        VStack(spacing: 10) {
            NavigationLink {
                FullAnalysisView(viewModel: AnalysisViewModel(environment: viewModel.environment), suppliedDecision: decision)
            } label: {
                Label("Open full analysis", systemImage: "doc.text.magnifyingglass")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(GoldMetaColor.gold)

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

    private func metricTile(_ label: String, value: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption2).foregroundStyle(GoldMetaColor.textSecondary)
            Text(value).font(GoldMetaFont.rounded(.callout, weight: .bold))
            Text(detail)
                .font(.caption2)
                .foregroundStyle(GoldMetaColor.textSecondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func levelCell(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(GoldMetaFont.caption)
                .foregroundStyle(GoldMetaColor.textSecondary)
            Text(value)
                .font(GoldMetaFont.rounded(.title3, weight: .semibold))
                .foregroundStyle(GoldMetaColor.textPrimary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(GoldMetaColor.elevated.opacity(0.9))
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title) \(value)")
    }

    @ViewBuilder
    private func actionLabel(_ action: RecommendedTradeAction) -> some View {
        let content = VStack(alignment: .leading, spacing: 8) {
            Image(systemName: action.systemImage)
                .font(.title3)
            Text(action.title)
                .font(GoldMetaFont.rounded(.caption, weight: .semibold))
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 88, alignment: .topLeading)

        if action.isPrimary {
            content
                .foregroundStyle(Color.black.opacity(0.86))
                .background(
                    LinearGradient(
                        colors: [GoldMetaColor.gold, Color(red: 0.98, green: 0.78, blue: 0.33)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                )
        } else {
            content
                .foregroundStyle(GoldMetaColor.textPrimary)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(GoldMetaColor.elevated)
                        .overlay(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .stroke(GoldMetaColor.gold.opacity(0.18), lineWidth: 1)
                        )
                )
        }
    }
}
