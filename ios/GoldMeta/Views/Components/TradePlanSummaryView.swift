import SwiftUI

struct TradePlanSummaryView: View {
    let decision: Decision

    var body: some View {
        let display = decision.display
        GoldCard {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader("Trade plan summary")
                PriceRow("Decision", value: display.decisionLabel)
                PriceRow("Entry", value: display.entryText, detail: decision.entry.condition)
                PriceRow("Stop", value: display.stopLossText, detail: decision.stopLoss.reason)
                PriceRow("POC / VAH / VAL", value: "\(display.pocText) / \(display.vahText) / \(display.valText)")
                PriceRow("Best RR", value: display.riskRewardText)
            }
        }
    }
}
