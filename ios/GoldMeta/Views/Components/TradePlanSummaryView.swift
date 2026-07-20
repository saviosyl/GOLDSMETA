import SwiftUI

struct TradePlanSummaryView: View {
    let decision: Decision

    var body: some View {
        GoldCard {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader("Trade plan summary")
                PriceRow("Entry", value: decision.entry.displayPrice, detail: decision.entry.condition)
                PriceRow("Stop", value: decision.stopLoss.price?.xauPrice ?? "N/A", detail: decision.stopLoss.reason)
                PriceRow("Best RR", value: decision.riskReward.bestAvailable?.ratioText ?? "N/A")
            }
        }
    }
}
