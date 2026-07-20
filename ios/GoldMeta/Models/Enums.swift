import Foundation

enum DecisionType: String, Codable, CaseIterable, Identifiable {
    case buy = "BUY"
    case sell = "SELL"
    case wait = "WAIT"

    var id: String { rawValue }
    var accessibilityLabel: String { rawValue.lowercased() }
}

enum ConfidenceLabel: String, Codable, CaseIterable {
    case low = "LOW"
    case moderate = "MODERATE"
    case high = "HIGH"
    case veryHigh = "VERY_HIGH"

    var displayName: String { rawValue.replacingOccurrences(of: "_", with: " ").capitalized }
}

enum MarketRegime: String, Codable, CaseIterable {
    case trendingUp = "TRENDING_UP"
    case trendingDown = "TRENDING_DOWN"
    case ranging = "RANGING"
    case transition = "TRANSITION"
    case unknown = "UNKNOWN"

    var displayName: String { rawValue.replacingOccurrences(of: "_", with: " ").capitalized }
}

enum DataQuality: String, Codable, CaseIterable {
    case good = "GOOD"
    case partial = "PARTIAL"
    case stale = "STALE"
    case conflicted = "CONFLICTED"
    case invalid = "INVALID"
}

enum EntryType: String, Codable, CaseIterable {
    case market = "MARKET"
    case limit = "LIMIT"
    case entryZone = "ENTRY_ZONE"
    case waitForConfirmation = "WAIT_FOR_CONFIRMATION"
    case none = "NONE"

    var displayName: String { rawValue.replacingOccurrences(of: "_", with: " ").capitalized }
}

enum BreakevenState: String, Codable, CaseIterable {
    case notApplicable = "NOT_APPLICABLE"
    case holdOriginalStop = "HOLD_ORIGINAL_STOP"
    case moveToBreakeven = "MOVE_TO_BREAKEVEN"
    case lockPartialProfit = "LOCK_PARTIAL_PROFIT"

    var displayName: String { rawValue.replacingOccurrences(of: "_", with: " ").capitalized }
}

enum LifecycleState: String, Codable, CaseIterable {
    case received = "RECEIVED"
    case normalising = "NORMALISING"
    case incomplete = "INCOMPLETE"
    case analysing = "ANALYSING"
    case active = "ACTIVE"
    case superseded = "SUPERSEDED"
    case invalidated = "INVALIDATED"
    case expired = "EXPIRED"
    case closed = "CLOSED"
}

enum DataSourceLabel: String, Codable, CaseIterable {
    case live = "LIVE"
    case delayed = "DELAYED"
    case stale = "STALE"
    case mock = "MOCK"
    case offline = "OFFLINE"
}

enum HigherTimeframeBias: String, Codable, CaseIterable {
    case bullish = "BULLISH"
    case bearish = "BEARISH"
    case neutral = "NEUTRAL"
}

enum TradeAction: String, Codable, CaseIterable, Identifiable {
    case taken
    case skipped

    var id: String { rawValue }
    var displayName: String { rawValue.capitalized }
}

enum TradeOutcome: String, Codable, CaseIterable, Identifiable {
    case open
    case win
    case loss
    case breakeven
    case skipped

    var id: String { rawValue }
    var displayName: String { rawValue.capitalized }
}
