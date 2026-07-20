import Foundation

struct MarketSnapshot: Codable, Identifiable, Equatable {
    let id: String
    let symbol: String
    let price: Double
    let bid: Double?
    let ask: Double?
    let session: String
    let capturedAt: Date
    let source: DataSourceLabel
    let indicators: IndicatorSnapshot
}
