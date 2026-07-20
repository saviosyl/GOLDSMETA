import Foundation

struct IndicatorSnapshot: Codable, Equatable {
    let timeframe: String
    let emaFast: Double?
    let emaSlow: Double?
    let rsi: Double?
    let atr: Double?
    let macdHistogram: Double?
    let support: Double?
    let resistance: Double?
    let trendBias: HigherTimeframeBias?
}
