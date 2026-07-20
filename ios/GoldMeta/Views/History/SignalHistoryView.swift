import SwiftUI

struct SignalHistoryView: View {
    @ObservedObject var viewModel: HistoryViewModel

    var body: some View {
        NavigationStack {
            ZStack {
                GoldMetaColor.atmosphere.ignoresSafeArea()
                VStack(spacing: 12) {
                    filters
                    List(viewModel.filteredDecisions) { decision in
                        historyRow(decision)
                            .listRowBackground(GoldMetaColor.surface)
                    }
                    .scrollContentBackground(.hidden)
                    .overlay {
                        if viewModel.filteredDecisions.isEmpty {
                            EmptyStateView(title: "No signals", message: "Adjust filters or refresh mock history.")
                                .padding()
                        }
                    }
                }
                .padding(.top, 8)
            }
            .navigationTitle("History")
            .task { await viewModel.loadHistory() }
            .toolbar { Button("Refresh") { Task { await viewModel.loadHistory() } } }
        }
    }

    private var filters: some View {
        VStack(alignment: .leading, spacing: 10) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    Button("All") { viewModel.selectedDecision = nil }
                    ForEach(DecisionType.allCases) { type in
                        Button(type.rawValue) { viewModel.selectedDecision = type }
                            .foregroundStyle(type.color)
                    }
                }
                .buttonStyle(.bordered)
                .tint(GoldMetaColor.gold)
                .padding(.horizontal)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    Button("Any quality") { viewModel.selectedQuality = nil }
                    ForEach(DataQuality.allCases, id: \.rawValue) { quality in
                        Button(quality.rawValue) { viewModel.selectedQuality = quality }
                    }
                }
                .buttonStyle(.bordered)
                .tint(GoldMetaColor.gold)
                .padding(.horizontal)
            }
        }
    }

    private func historyRow(_ decision: Decision) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                DecisionBadge(decision: decision.decision, isProvisional: decision.isProvisional)
                Spacer()
                Text(decision.generatedAt.shortDateTime)
                    .font(.caption)
                    .foregroundStyle(GoldMetaColor.textSecondary)
            }
            Text(decision.reasonSummary.first ?? "No summary")
                .foregroundStyle(GoldMetaColor.textPrimary)
            HStack {
                Text("Rule \(decision.ruleConfigVersion)")
                Text(decision.dataSourceLabel.rawValue)
                Text(decision.dataQuality.rawValue)
            }
            .font(.caption)
            .foregroundStyle(GoldMetaColor.textSecondary)
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
    }
}
