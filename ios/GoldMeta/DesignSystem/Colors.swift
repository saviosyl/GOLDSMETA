import SwiftUI

struct GoldMetaColor {
    static let background = Color(red: 0.035, green: 0.039, blue: 0.047)
    static let surface = Color(red: 0.075, green: 0.082, blue: 0.096)
    static let elevated = Color(red: 0.105, green: 0.113, blue: 0.132)
    static let gold = Color(red: 0.788, green: 0.635, blue: 0.153)
    static let goldSoft = Color(red: 0.980, green: 0.780, blue: 0.300).opacity(0.22)
    static let textPrimary = Color(red: 0.945, green: 0.922, blue: 0.850)
    static let textSecondary = Color(red: 0.670, green: 0.660, blue: 0.620)
    static let buy = Color(red: 0.190, green: 0.800, blue: 0.455)
    static let sell = Color(red: 0.960, green: 0.280, blue: 0.320)
    static let wait = Color(red: 0.950, green: 0.640, blue: 0.180)
    static let stale = Color(red: 0.540, green: 0.560, blue: 0.610)

    static var atmosphere: LinearGradient {
        LinearGradient(
            colors: [background, Color(red: 0.090, green: 0.077, blue: 0.040), background],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

extension DecisionType {
    var color: Color {
        switch self {
        case .buy:
            return GoldMetaColor.buy
        case .sell:
            return GoldMetaColor.sell
        case .wait:
            return GoldMetaColor.wait
        }
    }
}

extension DataQuality {
    var color: Color {
        switch self {
        case .good:
            return GoldMetaColor.buy
        case .partial:
            return GoldMetaColor.wait
        case .stale, .invalid:
            return GoldMetaColor.stale
        case .conflicted:
            return GoldMetaColor.sell
        }
    }
}

extension DataSourceLabel {
    var color: Color {
        switch self {
        case .live:
            return GoldMetaColor.buy
        case .delayed, .mock:
            return GoldMetaColor.wait
        case .stale, .offline:
            return GoldMetaColor.stale
        }
    }
}
