import SwiftUI

struct JournalView: View {
    @ObservedObject var viewModel: JournalViewModel
    @EnvironmentObject private var environment: AppEnvironment
    @State private var latestDecision: Decision?

    var body: some View {
        NavigationStack {
            ZStack {
                GoldMetaColor.atmosphere.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        metricsCard
                        recordCard
                        entriesList
                    }
                    .padding(18)
                }
            }
            .navigationTitle("Journal")
            .task { await loadLatestDecision(); viewModel.reload() }
        }
    }

    private var metricsCard: some View {
        GoldCard {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader("Performance metrics", subtitle: "Closed journaled trades only")
                HStack {
                    metric("Win rate", value: viewModel.metrics.winRate.formatted(.percent.precision(.fractionLength(0))))
                    metric("Avg R", value: viewModel.metrics.averageR.ratioText)
                    metric("Expectancy", value: viewModel.metrics.expectancy.ratioText)
                }
                Text("Closed: \(viewModel.metrics.totalClosedTrades)  Wins: \(viewModel.metrics.wins)  Losses: \(viewModel.metrics.losses)  BE: \(viewModel.metrics.breakeven)")
                    .font(.caption)
                    .foregroundStyle(GoldMetaColor.textSecondary)
                if viewModel.metrics.hasSmallSampleWarning {
                    Label("Small sample: treat metrics as directional only until at least 20 closed trades.", systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(GoldMetaColor.wait)
                }
            }
        }
    }

    private var recordCard: some View {
        GoldCard {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader("Record latest decision", subtitle: latestDecision?.decisionId ?? "No decision loaded")
                TextField("Notes", text: $viewModel.draftNotes, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                Picker("Outcome", selection: $viewModel.draftOutcome) {
                    ForEach(TradeOutcome.allCases) { Text($0.displayName).tag($0) }
                }
                .pickerStyle(.segmented)
                Stepper("Realized R: \(viewModel.draftRealizedR.ratioText)", value: $viewModel.draftRealizedR, in: -5...10, step: 0.25)
                HStack {
                    Button("Taken") { record(.taken) }
                        .buttonStyle(.borderedProminent)
                        .tint(GoldMetaColor.gold)
                    Button("Skipped") { record(.skipped) }
                        .buttonStyle(.bordered)
                        .tint(GoldMetaColor.textSecondary)
                }
                Text("Record taken or skipped decisions so metrics reflect your actual behavior, not signal frequency.")
                    .font(.caption)
                    .foregroundStyle(GoldMetaColor.textSecondary)
            }
        }
    }

    private var entriesList: some View {
        GoldCard {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader("Entries")
                if viewModel.entries.isEmpty {
                    Text("No journal entries yet.")
                        .foregroundStyle(GoldMetaColor.textSecondary)
                } else {
                    ForEach(viewModel.entries) { entry in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(entry.decision.rawValue)
                                    .font(GoldMetaFont.rounded(.headline, weight: .bold))
                                    .foregroundStyle(entry.decision.color)
                                Spacer()
                                Text(entry.createdAt.shortDateTime).font(.caption)
                            }
                            Text("\(entry.action.displayName) - \(entry.outcome.displayName) - \(entry.realizedR?.ratioText ?? "Open")")
                            Text("Rule \(entry.ruleConfigVersion) - \(entry.decisionId)")
                                .font(.caption)
                                .foregroundStyle(GoldMetaColor.textSecondary)
                            if !entry.notes.isEmpty { Text(entry.notes).foregroundStyle(GoldMetaColor.textSecondary) }
                            Divider().overlay(GoldMetaColor.gold.opacity(0.15))
                        }
                    }
                }
            }
        }
    }

    private func metric(_ label: String, value: String) -> some View {
        VStack(alignment: .leading) {
            Text(label).font(.caption).foregroundStyle(GoldMetaColor.textSecondary)
            Text(value).font(GoldMetaFont.rounded(.title3, weight: .bold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func record(_ action: TradeAction) {
        guard let latestDecision else { return }
        viewModel.addEntry(for: latestDecision, action: action)
    }

    private func loadLatestDecision() async {
        latestDecision = try? await environment.decisionService.latestDecision()
    }
}
