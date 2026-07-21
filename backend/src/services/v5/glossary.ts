import type { GlossaryEntry } from "./types";

/** Offline glossary — no external internet required. */
export const GLOSSARY: GlossaryEntry[] = [
  {
    term: "POC",
    slug: "poc",
    whatItIs: "Point of Control — the price level with the highest traded volume in a volume profile session.",
    whyItMatters: "Price often reacts around the POC because it marks the fairest price where most volume accepted value.",
    howGoldMetaUsesIt: "V4 uses XAUUSD session POC for value context, breakout/retest logic, and position-vs-value briefing. Missing or stale profiles reduce setup quality."
  },
  {
    term: "ATR",
    slug: "atr",
    whatItIs: "Average True Range — a measure of recent price volatility.",
    whyItMatters: "Stops and targets need enough distance to survive normal noise without being reckless.",
    howGoldMetaUsesIt: "V4 stop geometry requires max(structural, ATR minimum, spread×safety, absolute XAUUSD floor). Tiny stops are rejected as NO_TRADE_INVALID_RISK_GEOMETRY."
  },
  {
    term: "VAH",
    slug: "vah",
    whatItIs: "Value Area High — upper bound of the session value area (typically ~70% of volume).",
    whyItMatters: "Moves above VAH can signal acceptance of higher prices or failed breakouts if rejected.",
    howGoldMetaUsesIt: "Strategy A (value breakout/retest) and Strategy B (failed auction) reference VAH/VAL structure with multi-bar confirmation."
  },
  {
    term: "VAL",
    slug: "val",
    whatItIs: "Value Area Low — lower bound of the session value area.",
    whyItMatters: "Acceptance below VAL or rejection back into value changes directional odds and invalidation.",
    howGoldMetaUsesIt: "V4 records VAL on every shadow analysis and uses it for structural invalidation and quality scoring."
  },
  {
    term: "VWAP",
    slug: "vwap",
    whatItIs: "Volume-Weighted Average Price — average price weighted by volume over a session.",
    whyItMatters: "Institutions often benchmark execution quality against VWAP; it can act as a dynamic mean.",
    howGoldMetaUsesIt: "GoldMeta may display VWAP when present in verified payload fields. It does not invent VWAP if missing."
  },
  {
    term: "Volume Profile",
    slug: "volume-profile",
    whatItIs: "A histogram of volume traded at each price over a chosen window.",
    whyItMatters: "Shows where the market accepted or rejected value, beyond simple OHLC candles.",
    howGoldMetaUsesIt: "Primary XAUUSD TV profile drives V4 gates. COMEX GC confirmation is optional; when unavailable, quality is penalised honestly."
  },
  {
    term: "Liquidity",
    slug: "liquidity",
    whatItIs: "Pools of resting orders above highs / below lows that can attract sweeps.",
    whyItMatters: "Sweeps can trap breakout traders and fuel reversals (failed auctions).",
    howGoldMetaUsesIt: "Strategy B looks for failed auction / rejection after probing beyond value. Screenshots may note possible sweeps but never alone create trades."
  },
  {
    term: "Breakout",
    slug: "breakout",
    whatItIs: "Price leaving a defined range or value area with intent to continue.",
    whyItMatters: "False breakouts are common; confirmation separates noise from acceptance.",
    howGoldMetaUsesIt: "Strategy A requires value breakout and retest continuation with multi-bar confirmation — no one-candle shadow plans."
  },
  {
    term: "Acceptance",
    slug: "acceptance",
    whatItIs: "Evidence that the market is willing to trade and hold at new prices (time + volume).",
    whyItMatters: "Without acceptance, breakouts often fail.",
    howGoldMetaUsesIt: "Confirmation bars and profile validity gates encode acceptance requirements before a locked shadow plan."
  },
  {
    term: "Failed Auction",
    slug: "failed-auction",
    whatItIs: "Price probes beyond value/structure then rejects back, leaving trapped participants.",
    whyItMatters: "Often seeds mean-reversion or reversal setups.",
    howGoldMetaUsesIt: "Strategy B (FAILED_AUCTION_REVERSAL) is one of two allowed V4 families."
  },
  {
    term: "Confirmation",
    slug: "confirmation",
    whatItIs: "Additional closed bars that validate a candidate before plan lock.",
    whyItMatters: "Reduces one-candle noise and premature entries.",
    howGoldMetaUsesIt: "V4 requires configured multi-bar confirmation; candidates expire or cancel if structure/regime/news fails."
  },
  {
    term: "Trend",
    slug: "trend",
    whatItIs: "Directional bias of successive swings or higher-timeframe structure.",
    whyItMatters: "Aligning setups with trend improves geometry and expectancy in many regimes.",
    howGoldMetaUsesIt: "V4 regime engine classifies trend/range/volatility and HTF context; conflicts lower quality."
  },
  {
    term: "Momentum",
    slug: "momentum",
    whatItIs: "Speed and persistence of directional price change.",
    whyItMatters: "Weak momentum breakouts often fail; strong momentum can overrun tight stops.",
    howGoldMetaUsesIt: "Contributes to GoldMeta Score and regime notes. Never treated as a standalone trade trigger."
  },
  {
    term: "News",
    slug: "news",
    whatItIs: "Scheduled economic events that can spike volatility and invalidate structure.",
    whyItMatters: "Spreads widen and stop geometry becomes unreliable.",
    howGoldMetaUsesIt: "V4 applies a news blackout window when events are supplied. If no verified calendar is present, briefing reports News: None / unavailable honestly."
  },
  {
    term: "GoldMeta Score",
    slug: "goldmeta-score",
    whatItIs: "A transparent 0–100 rules-based setup quality score.",
    whyItMatters: "Replaces misleading Confidence % with explainable components.",
    howGoldMetaUsesIt: "Sum of weighted components (trend, structure, profile, risk geometry, ATR, session, confirmation, liquidity, momentum, news). Not win probability."
  },
  {
    term: "Shadow Plan",
    slug: "shadow-plan",
    whatItIs: "An immutable V4 research plan tracked in SHADOW mode without broker execution.",
    whyItMatters: "Collects real lifecycle evidence before any manual forward testing discussion.",
    howGoldMetaUsesIt: "Created only when all mandatory gates pass. Never shows BUY NOW / SELL NOW. Broker remains DISABLED."
  }
];

export function getGlossaryEntry(slugOrTerm: string): GlossaryEntry | null {
  const key = slugOrTerm.trim().toLowerCase();
  return (
    GLOSSARY.find((g) => g.slug === key || g.term.toLowerCase() === key) ?? null
  );
}
