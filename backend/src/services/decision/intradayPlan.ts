/**
 * Issue #50 — build structured intraday plan from quote + complete strategy signal.
 * Never invent levels without structured reasons. Preserve PR #47 market-structure modes.
 * Range invariant: stretchLow <= probableLow <= currentPrice <= probableHigh <= stretchHigh
 * when a range is available — never silently sort labels into the wrong meaning.
 */

import type { DecisionRecord } from "../../models/types";
import type { MarketStructureMode } from "./strategySignal";
import type {
  ExpectedRange,
  ImportantLevel,
  ImportantLevelReason,
  IntradayAction,
  IntradayPlan,
  LevelKind,
  LevelProximity,
  LevelRoleAtPrice,
  LevelSide,
  LevelStrength,
  ManualTradePlanCard,
  ScenarioPlan,
  SetupChecklistItem,
  ValueLocation,
  ZoneGuide
} from "./intradayPlanTypes";

const ESTIMATE_DISCLAIMER =
  "Probable and stretch prices are estimates only — never guarantees. Markets can move beyond any projected range.";

const NEAR_POINTS = 1.5;

function positive(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dist(price: number, live: number | null): { points: number | null; percent: number | null } {
  if (live == null || !Number.isFinite(live) || live <= 0) {
    return { points: null, percent: null };
  }
  const points = round2(price - live);
  const percent = round2((points / live) * 100);
  return { points, percent };
}

export function valueLocationOf(
  live: number | null,
  val: number | null,
  vah: number | null
): ValueLocation {
  if (live == null || val == null || vah == null) return "UNKNOWN";
  if (live < val) return "BELOW_VALUE";
  if (live > vah) return "ABOVE_VALUE";
  return "INSIDE_VALUE";
}

export function sideFromPrice(price: number, live: number | null): LevelSide {
  if (live == null) return "UPSIDE";
  if (Math.abs(price - live) <= NEAR_POINTS) return "AT_PRICE";
  return price > live ? "UPSIDE" : "DOWNSIDE";
}

export function proximityFromPrice(price: number, live: number | null): LevelProximity {
  if (live == null) return "ABOVE";
  if (Math.abs(price - live) <= NEAR_POINTS) return "NEAR";
  return price > live ? "ABOVE" : "BELOW";
}

/** BUY: stop < entry < TP1 <= TP2 <= TP3. SELL: TP3 <= TP2 <= TP1 < entry < stop. */
export function validatePlanOrdering(args: {
  direction: "BUY" | "SELL";
  entry: number;
  stop: number;
  tp1: number;
  tp2?: number | null;
  tp3?: number | null;
}): { valid: boolean; note: string | null } {
  const { direction, entry, stop, tp1 } = args;
  const tp2 = args.tp2 ?? null;
  const tp3 = args.tp3 ?? null;
  if (direction === "BUY") {
    if (!(stop < entry && entry < tp1)) {
      return { valid: false, note: "BUY ordering requires stop < entry < TP1" };
    }
    if (tp2 != null && !(tp1 <= tp2)) {
      return { valid: false, note: "BUY ordering requires TP1 <= TP2" };
    }
    if (tp3 != null && tp2 != null && !(tp2 <= tp3)) {
      return { valid: false, note: "BUY ordering requires TP2 <= TP3" };
    }
    if (tp3 != null && tp2 == null && !(tp1 <= tp3)) {
      return { valid: false, note: "BUY ordering requires TP1 <= TP3" };
    }
    return { valid: true, note: null };
  }
  if (!(tp1 < entry && entry < stop)) {
    return { valid: false, note: "SELL ordering requires TP1 < entry < stop" };
  }
  if (tp2 != null && !(tp2 <= tp1)) {
    return { valid: false, note: "SELL ordering requires TP2 <= TP1" };
  }
  if (tp3 != null && tp2 != null && !(tp3 <= tp2)) {
    return { valid: false, note: "SELL ordering requires TP3 <= TP2" };
  }
  if (tp3 != null && tp2 == null && !(tp3 <= tp1)) {
    return { valid: false, note: "SELL ordering requires TP3 <= TP1" };
  }
  return { valid: true, note: null };
}

function actionLabel(action: IntradayAction): string {
  switch (action) {
    case "BUY_NOW":
      return "BUY NOW";
    case "BUY_ON_PULLBACK":
      return "BUY ON PULLBACK";
    case "BUY_ABOVE":
      return "BUY ABOVE";
    case "SELL_NOW":
      return "SELL NOW";
    case "SELL_ON_REJECTION":
      return "SELL ON REJECTION";
    case "SELL_BELOW":
      return "SELL BELOW";
    case "RANGE_TRADE":
      return "RANGE TRADE";
    case "PREPARE":
      return "PREPARE — SETUP FORMING";
    case "NO_TRADE":
      return "NO TRADE";
    default:
      return action;
  }
}

function biasFromTrend(
  trend: string | null | undefined,
  decision: string | null | undefined
): IntradayPlan["directionBias"] {
  const t = (trend ?? "").toUpperCase();
  if (t.includes("BULL")) return "BULLISH";
  if (t.includes("BEAR")) return "BEARISH";
  if (decision === "BUY") return "SLIGHTLY_BULLISH";
  if (decision === "SELL") return "SLIGHTLY_BEARISH";
  return "NEUTRAL";
}

function marketTypeFrom(
  trend: string | null | undefined,
  confirmation: string | null | undefined
): IntradayPlan["marketType"] {
  const c = (confirmation ?? "").toUpperCase();
  if (c === "BREAKOUT") return "BREAKOUT";
  if (c === "RETEST" || c === "REJECTION") return "PULLBACK";
  const t = (trend ?? "").toUpperCase();
  if (t === "RANGE" || t === "NEUTRAL") return "RANGE";
  if (t.includes("BULL") || t.includes("BEAR")) return "TREND";
  return "UNKNOWN";
}

function reason(
  code: ImportantLevelReason["code"],
  label: string,
  explanation: string,
  sourceTimeframe?: string | null
): ImportantLevelReason {
  return { code, label, explanation, sourceTimeframe: sourceTimeframe ?? null };
}

function makeLevel(args: {
  id: string;
  side: LevelSide;
  kind: LevelKind;
  roleAtCurrentPrice: LevelRoleAtPrice;
  proximity: LevelProximity;
  price: number;
  zoneLow?: number | null;
  zoneHigh?: number | null;
  strength: LevelStrength;
  live: number | null;
  shortMeaning: string;
  reasons: ImportantLevelReason[];
  whatToWatch: string[];
  ifHolds: string;
  ifBreaks: string;
  confirmationRequired: string[];
  nextLevelId: string | null;
  simpleExplanation: string;
  confidence: number;
}): ImportantLevel | null {
  if (!args.reasons.length) return null;
  // Reject impossible plain SUPPORT above / plain RESISTANCE below.
  if (
    args.roleAtCurrentPrice === "SUPPORT" &&
    args.proximity === "ABOVE" &&
    args.live != null
  ) {
    return null;
  }
  if (
    args.roleAtCurrentPrice === "RESISTANCE" &&
    args.proximity === "BELOW" &&
    args.live != null
  ) {
    return null;
  }
  const d = dist(args.price, args.live);
  return {
    id: args.id,
    side: args.side,
    kind: args.kind,
    roleAtCurrentPrice: args.roleAtCurrentPrice,
    proximity: args.proximity,
    price: args.price,
    zoneLow: args.zoneLow ?? null,
    zoneHigh: args.zoneHigh ?? null,
    strength: args.strength,
    distancePoints: d.points,
    distancePercent: d.percent,
    shortMeaning: args.shortMeaning,
    reasons: args.reasons,
    whatToWatch: args.whatToWatch,
    ifHolds: args.ifHolds,
    ifBreaks: args.ifBreaks,
    confirmationRequired: args.confirmationRequired,
    nextLevelId: args.nextLevelId,
    riskWarning:
      "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
    simpleExplanation: args.simpleExplanation,
    confidence: args.confidence
  };
}

function classifyValueLevel(
  name: "VAL" | "VAH" | "POC",
  price: number,
  live: number | null,
  location: ValueLocation
): { role: LevelRoleAtPrice; kind: LevelKind; shortMeaning: string; ifHolds: string; ifBreaks: string; explanation: string } {
  const prox = proximityFromPrice(price, live);
  if (name === "VAL") {
    if (location === "BELOW_VALUE" || prox === "ABOVE") {
      return {
        role: "RECLAIM_LEVEL",
        kind: "RECLAIM",
        shortMeaning: "VAL — first reclaim / overhead resistance until recovered",
        ifHolds: "As resistance overhead, a hold below VAL keeps price outside value.",
        ifBreaks: "A reclaim and hold above VAL can reopen the value area toward POC/VAH.",
        explanation:
          "Price is currently below VAL. VAL is previous support that now acts as a reclaim/resistance level until price closes above and holds."
      };
    }
    return {
      role: "SUPPORT",
      kind: "SUPPORT",
      shortMeaning: "Value-area low — floor under value",
      ifHolds: "Price may bounce from this floor back toward POC/VAH.",
      ifBreaks: "A break and hold below VAL can open lower downside targets.",
      explanation:
        "VAL is the lower edge of the value area. While price is at or above VAL, it can act as a floor (support)."
    };
  }
  if (name === "VAH") {
    if (location === "ABOVE_VALUE" || prox === "BELOW") {
      return {
        role: "PREVIOUS_RESISTANCE_NOW_SUPPORT",
        kind: "SUPPORT",
        shortMeaning: "VAH — previous ceiling, potential support after retest",
        ifHolds: "A hold above VAH after breakout can turn it into support.",
        ifBreaks: "A failed hold that closes back below VAH can trap breakout buyers.",
        explanation:
          "Price is currently above VAH. VAH is previous resistance that may become support only after a valid hold/retest."
      };
    }
    return {
      role: "RESISTANCE",
      kind: "RESISTANCE",
      shortMeaning: "Value-area high — ceiling above value",
      ifHolds: "Price may stall or reverse lower from this ceiling.",
      ifBreaks: "A break and hold above VAH can open higher upside targets.",
      explanation:
        "VAH is the upper edge of the value area. While price is at or below VAH, it can act as a ceiling (resistance)."
    };
  }
  // POC
  if (prox === "ABOVE") {
    return {
      role: "MAGNET",
      kind: "MAGNET",
      shortMeaning: "POC — overhead magnet / decision resistance",
      ifHolds: "Price may rotate back toward value around POC.",
      ifBreaks: "Acceptance through POC can continue toward VAH or beyond.",
      explanation: "POC is the busiest traded price — currently above price, acting as an overhead magnet."
    };
  }
  if (prox === "BELOW") {
    return {
      role: "MAGNET",
      kind: "MAGNET",
      shortMeaning: "POC — below-price magnet / support decision",
      ifHolds: "Price may bounce from the POC magnet zone.",
      ifBreaks: "Leaving POC lower can open a move toward VAL or below.",
      explanation: "POC is the busiest traded price — currently below price, acting as a magnet/support decision."
    };
  }
  return {
    role: "MAGNET",
    kind: "MAGNET",
    shortMeaning: "POC — centre-of-value decision point",
    ifHolds: "Mid-value around POC is often a no-trade / chop zone without confirmation.",
    ifBreaks: "A decisive leave of POC can start a directional leg.",
    explanation: "POC is the centre of value — a magnet and decision point, not an automatic entry."
  };
}

function buildImportantLevels(args: {
  live: number | null;
  poc: number | null;
  vah: number | null;
  val: number | null;
  barHigh: number | null;
  barLow: number | null;
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  atr: number | null;
  timeframe: string | null;
  mode: MarketStructureMode;
  decision: string;
  location: ValueLocation;
}): ImportantLevel[] {
  if (args.mode === "MISMATCH" || args.mode === "UNAVAILABLE") return [];
  const live = args.live;
  const tf = args.timeframe;
  const levels: ImportantLevel[] = [];
  const dir = args.decision.toUpperCase();

  if (args.mode === "COMPLETE") {
    if (args.val != null) {
      const c = classifyValueLevel("VAL", args.val, live, args.location);
      const L = makeLevel({
        id: "lvl-val",
        side: sideFromPrice(args.val, live),
        kind: c.kind,
        roleAtCurrentPrice: c.role,
        proximity: proximityFromPrice(args.val, live),
        price: args.val,
        strength: "STRONG",
        live,
        shortMeaning: c.shortMeaning,
        reasons: [reason("VAL", "Value Area Low (VAL)", c.explanation, tf)],
        whatToWatch:
          c.role === "RECLAIM_LEVEL"
            ? ["Reclaim and hold above VAL", "Failed reclaim / rejection back below VAL"]
            : ["Rejection bounce near VAL", "Break and hold below VAL"],
        ifHolds: c.ifHolds,
        ifBreaks: c.ifBreaks,
        confirmationRequired:
          c.role === "RECLAIM_LEVEL"
            ? ["Confirmed close above VAL", "Hold on a subsequent bar"]
            : ["Confirmed bounce candle", "Or confirmed close below for breakdown"],
        nextLevelId: args.poc != null ? "lvl-poc" : args.vah != null ? "lvl-vah" : null,
        simpleExplanation: c.explanation,
        confidence: 78
      });
      if (L) levels.push(L);
    }

    if (args.poc != null) {
      const c = classifyValueLevel("POC", args.poc, live, args.location);
      const L = makeLevel({
        id: "lvl-poc",
        side: sideFromPrice(args.poc, live),
        kind: c.kind,
        roleAtCurrentPrice: c.role,
        proximity: proximityFromPrice(args.poc, live),
        price: args.poc,
        strength: "MAJOR",
        live,
        shortMeaning: c.shortMeaning,
        reasons: [reason("POC", "Point of Control (POC)", c.explanation, tf)],
        whatToWatch: ["Acceptance through POC", "Rejection away from POC"],
        ifHolds: c.ifHolds,
        ifBreaks: c.ifBreaks,
        confirmationRequired: ["Confirmed close through POC"],
        nextLevelId: proximityFromPrice(args.poc, live) === "ABOVE" ? "lvl-vah" : "lvl-val",
        simpleExplanation: c.explanation,
        confidence: 82
      });
      if (L) levels.push(L);
    }

    if (args.vah != null) {
      const c = classifyValueLevel("VAH", args.vah, live, args.location);
      const L = makeLevel({
        id: "lvl-vah",
        side: sideFromPrice(args.vah, live),
        kind: c.kind,
        roleAtCurrentPrice: c.role,
        proximity: proximityFromPrice(args.vah, live),
        price: args.vah,
        strength: "STRONG",
        live,
        shortMeaning: c.shortMeaning,
        reasons: [reason("VAH", "Value Area High (VAH)", c.explanation, tf)],
        whatToWatch:
          c.role === "PREVIOUS_RESISTANCE_NOW_SUPPORT"
            ? ["Retest hold above VAH", "Failed retest back below VAH"]
            : ["Rejection at VAH", "Break and hold above VAH"],
        ifHolds: c.ifHolds,
        ifBreaks: c.ifBreaks,
        confirmationRequired:
          c.role === "PREVIOUS_RESISTANCE_NOW_SUPPORT"
            ? ["Hold above VAH on retest"]
            : ["Confirmed close above VAH for breakout", "Or rejection wick for fade"],
        nextLevelId: null,
        simpleExplanation: c.explanation,
        confidence: 78
      });
      if (L) levels.push(L);
    }
  }

  if (args.barHigh != null) {
    const L = makeLevel({
      id: "lvl-bar-high",
      side: sideFromPrice(args.barHigh, live),
      kind: "RESISTANCE",
      roleAtCurrentPrice: proximityFromPrice(args.barHigh, live) === "BELOW" ? "PREVIOUS_RESISTANCE_NOW_SUPPORT" : "RESISTANCE",
      proximity: proximityFromPrice(args.barHigh, live),
      price: args.barHigh,
      strength: "MODERATE",
      live,
      shortMeaning:
        proximityFromPrice(args.barHigh, live) === "BELOW"
          ? "Recent bar high — previous ceiling now below price"
          : "Recent bar high — short-term ceiling",
      reasons: [
        reason(
          "SESSION_HIGH",
          "Recent bar / session high",
          "The latest verified bar high marks a nearby short-term reference until broken and held.",
          tf
        )
      ],
      whatToWatch: ["Break and hold above the high", "Rejection back into the range"],
      ifHolds: "Sellers may defend this short-term ceiling when it is still overhead.",
      ifBreaks: "Break and hold can extend toward the next upside level.",
      confirmationRequired: ["Confirmed close beyond the high"],
      nextLevelId: args.vah != null ? "lvl-vah" : null,
      simpleExplanation: "The recent high is a nearby reference until buyers or sellers prove control.",
      confidence: 60
    });
    if (L) levels.push(L);
  }

  if (args.barLow != null) {
    const L = makeLevel({
      id: "lvl-bar-low",
      side: sideFromPrice(args.barLow, live),
      kind: "SUPPORT",
      roleAtCurrentPrice:
        proximityFromPrice(args.barLow, live) === "ABOVE"
          ? "PREVIOUS_SUPPORT_NOW_RESISTANCE"
          : "SUPPORT",
      proximity: proximityFromPrice(args.barLow, live),
      price: args.barLow,
      strength: "MODERATE",
      live,
      shortMeaning:
        proximityFromPrice(args.barLow, live) === "ABOVE"
          ? "Recent bar low — previous floor now overhead"
          : "Recent bar low — nearest verified support",
      reasons: [
        reason(
          "SESSION_LOW",
          "Recent bar / session low",
          "The latest verified bar low marks a nearby short-term floor or reclaim reference.",
          tf
        )
      ],
      whatToWatch: ["Hold above the low", "Break and hold below the low"],
      ifHolds: "Buyers may defend this short-term floor when it is still below price.",
      ifBreaks: "Break and hold can extend toward the next downside level.",
      confirmationRequired: ["Confirmed close beyond the low"],
      nextLevelId: args.stop != null ? "lvl-stop" : null,
      simpleExplanation: "The recent low is the nearest verified support when it sits at or below current price.",
      confidence: 60
    });
    if (L) levels.push(L);
  }

  // Plan levels — side/role from price + direction
  if (args.tp1 != null && args.mode === "COMPLETE") {
    const prox = proximityFromPrice(args.tp1, live);
    const role: LevelRoleAtPrice = "TARGET";
    const L = makeLevel({
      id: "lvl-tp1",
      side: sideFromPrice(args.tp1, live),
      kind: "TARGET",
      roleAtCurrentPrice: role,
      proximity: prox,
      price: args.tp1,
      strength: "MODERATE",
      live,
      shortMeaning:
        dir === "SELL"
          ? "Take-profit 1 — first downside target"
          : "Take-profit 1 — first upside target",
      reasons: [
        reason("PLAN_TARGET", "Trade-plan target TP1", "TP1 from the latest valid complete strategy signal.", tf)
      ],
      whatToWatch: ["Progress toward TP1 after a confirmed entry"],
      ifHolds: "Reaching TP1 often invites partial profit-taking.",
      ifBreaks: "Beyond TP1, next target or stretch may become relevant.",
      confirmationRequired: ["Valid entry first", "Plan still active"],
      nextLevelId: args.tp2 != null ? "lvl-tp2" : null,
      simpleExplanation: "TP1 is the first planned take-profit — not a guarantee.",
      confidence: 70
    });
    if (L) levels.push(L);
  }

  if (args.tp2 != null && args.mode === "COMPLETE") {
    const L = makeLevel({
      id: "lvl-tp2",
      side: sideFromPrice(args.tp2, live),
      kind: "TARGET",
      roleAtCurrentPrice: "TARGET",
      proximity: proximityFromPrice(args.tp2, live),
      price: args.tp2,
      strength: "STRONG",
      live,
      shortMeaning: dir === "SELL" ? "Take-profit 2 — extended downside target" : "Take-profit 2 — extended upside target",
      reasons: [
        reason("PLAN_TARGET", "Trade-plan target TP2", "TP2 from the latest valid complete strategy signal.", tf)
      ],
      whatToWatch: ["Extension after TP1"],
      ifHolds: "Holding near TP2 can mean momentum is slowing after the extension.",
      ifBreaks: "May allow further manual scaling out.",
      confirmationRequired: ["Valid entry first"],
      nextLevelId: args.tp3 != null ? "lvl-tp3" : null,
      simpleExplanation: "TP2 is a further planned profit area if the move continues.",
      confidence: 65
    });
    if (L) levels.push(L);
  }

  if (args.tp3 != null && args.mode === "COMPLETE") {
    const L = makeLevel({
      id: "lvl-tp3",
      side: sideFromPrice(args.tp3, live),
      kind: "STRETCH",
      roleAtCurrentPrice: "TARGET",
      proximity: proximityFromPrice(args.tp3, live),
      price: args.tp3,
      strength: "MAJOR",
      live,
      shortMeaning: dir === "SELL" ? "Stretch downside target (TP3)" : "Stretch upside target (TP3)",
      reasons: [
        reason("PLAN_TARGET", "Trade-plan target TP3", "TP3 is the stretch target from the verified strategy plan.", tf)
      ],
      whatToWatch: ["Momentum continuation"],
      ifHolds: "Reaching TP3 often marks an extended move where profit-taking is common.",
      ifBreaks: "Stretch target only — uncommon to reach every session.",
      confirmationRequired: ["Strong trend continuation"],
      nextLevelId: null,
      simpleExplanation: "TP3 is an optimistic stretch target, not a promise.",
      confidence: 55
    });
    if (L) levels.push(L);
  }

  if (args.stop != null && args.mode === "COMPLETE") {
    const L = makeLevel({
      id: "lvl-stop",
      side: sideFromPrice(args.stop, live),
      kind: "INVALIDATION",
      roleAtCurrentPrice: "INVALIDATION",
      proximity: proximityFromPrice(args.stop, live),
      price: args.stop,
      strength: "MAJOR",
      live,
      shortMeaning: "Plan invalidation / stop region",
      reasons: [
        reason(
          "PLAN_STOP",
          "Trade-plan stop / invalidation",
          "Stop comes from the latest valid complete strategy signal. A sustained break invalidates the plan.",
          tf
        )
      ],
      whatToWatch: ["Close through stop region", "Fast spike that reverses (false break)"],
      ifHolds: "Plan may still be valid if price holds on the correct side of invalidation.",
      ifBreaks: "Manual plan is invalidated — do not average down.",
      confirmationRequired: ["Confirmed close beyond stop for invalidation"],
      nextLevelId: null,
      simpleExplanation: "If price breaks and holds beyond this area, the trade idea is wrong.",
      confidence: 80
    });
    if (L) levels.push(L);
  }

  if (args.atr != null && live != null) {
    const stretchHigh = round2(live + args.atr);
    const stretchLow = round2(live - args.atr);
    const hi = makeLevel({
      id: "lvl-atr-high",
      side: "UPSIDE",
      kind: "STRETCH",
      roleAtCurrentPrice: "STRETCH_ESTIMATE",
      proximity: "ABOVE",
      price: stretchHigh,
      strength: "MINOR",
      live,
      shortMeaning: "ATR stretch high (estimate)",
      reasons: [
        reason(
          "ATR_PROJECTION",
          "ATR projection",
          `Projected roughly one ATR (${args.atr}) above the current verified price. Estimate only.`,
          tf
        )
      ],
      whatToWatch: ["Whether momentum can extend a full ATR"],
      ifHolds: "Holding near the ATR stretch often means an extended session move is stalling.",
      ifBreaks: "Stretch estimates are frequently not reached.",
      confirmationRequired: ["Strong directional continuation"],
      nextLevelId: null,
      simpleExplanation: "An ATR stretch is a statistical reach estimate, not a guaranteed high.",
      confidence: 45
    });
    const lo = makeLevel({
      id: "lvl-atr-low",
      side: "DOWNSIDE",
      kind: "STRETCH",
      roleAtCurrentPrice: "STRETCH_ESTIMATE",
      proximity: "BELOW",
      price: stretchLow,
      strength: "MINOR",
      live,
      shortMeaning: "ATR stretch low (estimate)",
      reasons: [
        reason(
          "ATR_PROJECTION",
          "ATR projection",
          `Projected roughly one ATR (${args.atr}) below the current verified price. Estimate only.`,
          tf
        )
      ],
      whatToWatch: ["Whether a selloff can extend a full ATR"],
      ifHolds: "Holding near the ATR stretch low often means downside extension is exhausting.",
      ifBreaks: "Stretch estimates are frequently not reached.",
      confirmationRequired: ["Strong downside continuation"],
      nextLevelId: null,
      simpleExplanation: "An ATR stretch is a statistical reach estimate, not a guaranteed low.",
      confidence: 45
    });
    if (hi) levels.push(hi);
    if (lo) levels.push(lo);
  }

  return levels.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
}

export function buildExpectedRange(args: {
  live: number | null;
  vah: number | null;
  val: number | null;
  barHigh: number | null;
  barLow: number | null;
  atr: number | null;
  mode: MarketStructureMode;
  location: ValueLocation;
}): ExpectedRange {
  const live = args.live;
  const empty = (reasonText: string): ExpectedRange => ({
    rangeAvailable: false,
    unavailableReason: reasonText,
    valueLocation: args.location,
    probableLow: null,
    probableHigh: null,
    stretchLow: null,
    stretchHigh: null,
    currentPrice: live,
    remainingAbovePoints: null,
    remainingBelowPoints: null,
    remainingAbovePercent: null,
    remainingBelowPercent: null,
    confidence: 0,
    reasons: [reasonText],
    invalidation: "Recalculate when a trustworthy range around current price can be formed.",
    estimateDisclaimer: ESTIMATE_DISCLAIMER
  });

  if (args.mode === "MISMATCH" || args.mode === "UNAVAILABLE" || live == null) {
    return empty(
      args.mode === "MISMATCH"
        ? "Range unavailable — market data mismatch blocks combining levels."
        : "Range unavailable — no verified live price / structure."
    );
  }

  let probableLow: number | null = null;
  let probableHigh: number | null = null;
  const reasons: string[] = [];

  if (args.location === "INSIDE_VALUE" && args.val != null && args.vah != null) {
    probableLow = args.val;
    probableHigh = args.vah;
    reasons.push("Inside value: probable range uses verified VAL → VAH");
  } else if (args.location === "BELOW_VALUE") {
    // Lower bound at/below price; upper bound reclaim (VAL) or next verified upside.
    const lowerCandidates = [args.barLow, args.atr != null ? live - args.atr : null].filter(
      (n): n is number => n != null && n <= live
    );
    probableLow = lowerCandidates.length
      ? round2(Math.max(...lowerCandidates.filter((n) => n <= live)))
      : round2(live - (args.atr ?? Math.max(live * 0.001, 2)));
    // Prefer VAL as first overhead reclaim high if above live
    if (args.val != null && args.val >= live) {
      probableHigh = args.val;
      reasons.push(
        "Below value: probable low from verified bar/ATR support at or below price; probable high is VAL reclaim resistance"
      );
    } else if (args.barHigh != null && args.barHigh >= live) {
      probableHigh = args.barHigh;
      reasons.push("Below value: probable high uses verified bar high as overhead reference");
    } else {
      probableHigh = round2(live + (args.atr ?? Math.max(live * 0.001, 2)));
      reasons.push("Below value: probable high uses ATR upside estimate (no verified overhead level)");
    }
  } else if (args.location === "ABOVE_VALUE") {
    if (args.vah != null && args.vah <= live) {
      probableLow = args.vah;
      reasons.push("Above value: probable low uses VAH as potential retest/support reference");
    } else if (args.barLow != null && args.barLow <= live) {
      probableLow = args.barLow;
      reasons.push("Above value: probable low uses verified bar low");
    } else {
      probableLow = round2(live - (args.atr ?? Math.max(live * 0.001, 2)));
      reasons.push("Above value: probable low uses ATR downside estimate");
    }
    if (args.barHigh != null && args.barHigh >= live) {
      probableHigh = args.barHigh;
      reasons.push("Above value: probable high uses verified bar high / extension reference");
    } else {
      probableHigh = round2(live + (args.atr ?? Math.max(live * 0.001, 2)));
      reasons.push("Above value: probable high uses ATR upside estimate");
    }
  } else if (args.barLow != null && args.barHigh != null) {
    probableLow = Math.min(args.barLow, live);
    probableHigh = Math.max(args.barHigh, live);
    reasons.push("OHLC/unknown value location: probable range uses bar high/low around current price");
  } else {
    return empty("Cannot form a trustworthy probable range around current price with available levels.");
  }

  // Hard invariant — never emit contradictory labels
  if (
    probableLow == null ||
    probableHigh == null ||
    !(probableLow <= live && live <= probableHigh)
  ) {
    return empty(
      "Cannot form a trustworthy probable range with probableLow ≤ current ≤ probableHigh from available levels."
    );
  }

  let stretchLow: number | null = null;
  let stretchHigh: number | null = null;
  if (args.atr != null) {
    stretchLow = round2(Math.min(probableLow, live - args.atr));
    stretchHigh = round2(Math.max(probableHigh, live + args.atr));
    reasons.push("Stretch targets use approximately one ATR beyond current price / probable bounds");
  } else {
    const width = Math.max(probableHigh - probableLow, 1);
    stretchLow = round2(probableLow - width * 0.35);
    stretchHigh = round2(probableHigh + width * 0.35);
    reasons.push("Stretch targets extend ~35% beyond the probable range width");
  }

  // Ensure stretch brackets probable without re-sorting meanings
  if (stretchLow > probableLow) stretchLow = probableLow;
  if (stretchHigh < probableHigh) stretchHigh = probableHigh;

  if (!(stretchLow <= probableLow && probableLow <= live && live <= probableHigh && probableHigh <= stretchHigh)) {
    return empty("Range failed invariant stretchLow ≤ probableLow ≤ current ≤ probableHigh ≤ stretchHigh.");
  }

  const remainingAbovePoints = round2(probableHigh - live);
  const remainingBelowPoints = round2(live - probableLow);

  return {
    rangeAvailable: true,
    unavailableReason: null,
    valueLocation: args.location,
    probableLow: round2(probableLow),
    probableHigh: round2(probableHigh),
    stretchLow: round2(stretchLow),
    stretchHigh: round2(stretchHigh),
    currentPrice: live,
    remainingAbovePoints,
    remainingBelowPoints,
    remainingAbovePercent: round2((remainingAbovePoints / live) * 100),
    remainingBelowPercent: round2((remainingBelowPoints / live) * 100),
    confidence: args.mode === "COMPLETE" ? (args.location === "INSIDE_VALUE" ? 72 : 58) : 40,
    reasons,
    invalidation:
      "Recalculate when a new complete strategy signal arrives, when price leaves the stretch band, or when market-structure mode becomes MISMATCH.",
    estimateDisclaimer: ESTIMATE_DISCLAIMER
  };
}

function buildZones(args: {
  location: ValueLocation;
  live: number | null;
  poc: number | null;
  vah: number | null;
  val: number | null;
  barLow: number | null;
  nearestSupport: number | null;
  nearestResistance: number | null;
}): ZoneGuide {
  const { location, poc, vah, val, barLow, nearestSupport, nearestResistance } = args;

  if (location === "BELOW_VALUE" && val != null) {
    return {
      valueLocation: location,
      bestBuyZone: `Conditional reclaim-and-hold above ${val} (not an immediate buy zone)`,
      bestBuyImmediate: false,
      bestBuyConfirmation: `Confirmed close and hold above VAL ${val}`,
      bestBuyInvalidation: barLow != null ? `Break and hold below ${barLow}` : "Failed reclaim that closes back below VAL",
      bestSellZone: `Failed reclaim / rejection at VAL ${val}`,
      bestSellImmediate: false,
      bestSellConfirmation: "Rejection candle at VAL after a touch from below",
      bestSellInvalidation: `Reclaim and hold above ${val}`,
      noTradeZone: poc != null ? `Avoid chasing into mid-value near ${poc} before reclaim` : "Avoid chasing mid-value before reclaim",
      nearestSupport,
      nearestResistance
    };
  }

  if (location === "ABOVE_VALUE" && vah != null) {
    return {
      valueLocation: location,
      bestBuyZone: `Retest hold above VAH ${vah} (conditional)`,
      bestBuyImmediate: false,
      bestBuyConfirmation: `Hold above VAH ${vah} on retest`,
      bestBuyInvalidation: `Close back below ${vah}`,
      bestSellZone: `Only after breakdown and hold below VAH ${vah} (not an immediate sell into strength)`,
      bestSellImmediate: false,
      bestSellConfirmation: `Confirmed close below VAH ${vah}`,
      bestSellInvalidation: `Reclaim and hold back above ${vah}`,
      noTradeZone: "Avoid shorting into extension without a breakdown confirmation",
      nearestSupport,
      nearestResistance
    };
  }

  if (location === "INSIDE_VALUE" && val != null && vah != null) {
    return {
      valueLocation: location,
      bestBuyZone: `Near VAL ${val} with confirmation`,
      bestBuyImmediate: false,
      bestBuyConfirmation: "Bullish rejection / hold at VAL",
      bestBuyInvalidation: `Break and hold below ${val}`,
      bestSellZone: `Near VAH ${vah} with confirmation`,
      bestSellImmediate: false,
      bestSellConfirmation: "Bearish rejection / hold at VAH",
      bestSellInvalidation: `Break and hold above ${vah}`,
      noTradeZone:
        poc != null
          ? `Avoid chasing mid-range near POC ${poc} without confirmation`
          : "Avoid mid-range entries without confirmation",
      nearestSupport,
      nearestResistance
    };
  }

  return {
    valueLocation: location,
    bestBuyZone: null,
    bestBuyImmediate: false,
    bestBuyConfirmation: null,
    bestBuyInvalidation: null,
    bestSellZone: null,
    bestSellImmediate: false,
    bestSellConfirmation: null,
    bestSellInvalidation: null,
    noTradeZone: "Avoid mid-range entries without confirmation",
    nearestSupport,
    nearestResistance
  };
}

function buildScenarios(args: {
  location: ValueLocation;
  live: number | null;
  val: number | null;
  vah: number | null;
  poc: number | null;
  barLow: number | null;
  barHigh: number | null;
  tp1: number | null;
  tp2: number | null;
  stop: number | null;
  expectedRange: ExpectedRange;
}): { bullish: ScenarioPlan; bearish: ScenarioPlan } {
  const { location, live, val, vah, barLow, barHigh, tp1, tp2, expectedRange } = args;

  if (location === "BELOW_VALUE" && val != null) {
    const bullHigh1 = expectedRange.probableHigh ?? val;
    const bullHigh2 = vah ?? expectedRange.stretchHigh ?? bullHigh1;
    const bearLow1 = expectedRange.probableLow ?? barLow;
    const bearLow2 = expectedRange.stretchLow ?? bearLow1;
    return {
      bullish: {
        label: "If price rises",
        trigger: `Reclaim and hold above VAL ${val}`,
        triggerPrice: val,
        firstTarget: String(bullHigh1),
        firstTargetPrice: bullHigh1,
        secondTarget: String(bullHigh2),
        secondTargetPrice: bullHigh2,
        invalidation: barLow != null ? `Break and hold below ${barLow}` : "Failed reclaim closes back below VAL",
        invalidationPrice: barLow
      },
      bearish: {
        label: "If price falls",
        trigger:
          barLow != null
            ? `Breakdown and hold below support ${barLow}`
            : `Failed reclaim at VAL ${val} then continuation lower`,
        triggerPrice: barLow ?? val,
        firstTarget: bearLow1 != null ? String(bearLow1) : "Next support",
        firstTargetPrice: bearLow1,
        secondTarget: bearLow2 != null ? String(bearLow2) : "Stretch low (estimate)",
        secondTargetPrice: bearLow2,
        invalidation: `Reclaim and hold above ${val}`,
        invalidationPrice: val
      }
    };
  }

  if (location === "ABOVE_VALUE" && vah != null) {
    const bullHigh1 = barHigh ?? expectedRange.probableHigh ?? (live != null ? live + 5 : null);
    const bullHigh2 = expectedRange.stretchHigh ?? bullHigh1;
    return {
      bullish: {
        label: "If price rises",
        trigger: `Continuation hold above VAH ${vah}`,
        triggerPrice: vah,
        firstTarget: bullHigh1 != null ? String(bullHigh1) : "Next resistance",
        firstTargetPrice: bullHigh1,
        secondTarget: bullHigh2 != null ? String(bullHigh2) : "Stretch high (estimate)",
        secondTargetPrice: bullHigh2,
        invalidation: `Close back below ${vah}`,
        invalidationPrice: vah
      },
      bearish: {
        label: "If price falls",
        trigger: `Breakdown and hold below VAH ${vah}`,
        triggerPrice: vah,
        firstTarget: args.poc != null ? String(args.poc) : String(vah),
        firstTargetPrice: args.poc ?? vah,
        secondTarget: val != null ? String(val) : "Next support",
        secondTargetPrice: val,
        invalidation: `Reclaim and hold above ${vah}`,
        invalidationPrice: vah
      }
    };
  }

  // Inside value / default
  const support = val ?? expectedRange.probableLow;
  const resist = vah ?? expectedRange.probableHigh;
  return {
    bullish: {
      label: "If price rises",
      trigger:
        support != null && live != null && support <= live
          ? `Bounce from support ${support}`
          : resist != null
            ? `Break and hold above ${resist}`
            : "Bullish confirmation at structure",
      triggerPrice: support != null && live != null && support <= live ? support : resist,
      firstTarget: tp1 != null ? String(tp1) : resist != null ? String(resist) : "Next resistance",
      firstTargetPrice: tp1 ?? resist,
      secondTarget: tp2 != null ? String(tp2) : expectedRange.stretchHigh != null ? String(expectedRange.stretchHigh) : "Stretch high",
      secondTargetPrice: tp2 ?? expectedRange.stretchHigh,
      invalidation: support != null ? `Break and hold below ${support}` : "Plan stop breach",
      invalidationPrice: support
    },
    bearish: {
      label: "If price falls",
      trigger:
        resist != null && live != null && resist >= live
          ? `Rejection from resistance ${resist}`
          : support != null
            ? `Break and hold below ${support}`
            : "Bearish confirmation at structure",
      triggerPrice: resist != null && live != null && resist >= live ? resist : support,
      firstTarget: support != null ? String(support) : "Next support",
      firstTargetPrice: support,
      secondTarget:
        expectedRange.stretchLow != null ? String(expectedRange.stretchLow) : "Stretch low (estimate)",
      secondTargetPrice: expectedRange.stretchLow,
      invalidation: resist != null ? `Break and hold above ${resist}` : "Plan stop breach",
      invalidationPrice: resist
    }
  };
}

function buildChecklist(args: {
  mode: MarketStructureMode;
  decision: string;
  confirmation: string | null;
  hasPlan: boolean;
  poc: number | null;
  live: number | null;
}): { items: SetupChecklistItem[]; complete: number; total: number } {
  const items: SetupChecklistItem[] = [
    {
      id: "structure",
      label: "Complete market structure (POC/VAH/VAL)",
      complete: args.mode === "COMPLETE",
      detail:
        args.mode === "COMPLETE"
          ? "Verified complete strategy signal present"
          : `Mode is ${args.mode} — structure incomplete or mismatched`
    },
    {
      id: "fresh-quote",
      label: "Fresh live / last price",
      complete: args.live != null,
      detail: args.live != null ? `Price ${args.live}` : "No verified price"
    },
    {
      id: "bias",
      label: "Directional bias readable",
      complete: args.decision === "BUY" || args.decision === "SELL" || args.poc != null,
      detail: `Decision ${args.decision}`
    },
    {
      id: "confirmation",
      label: "Entry confirmation candle",
      complete: Boolean(args.confirmation && args.confirmation !== "NONE"),
      detail: args.confirmation ? `Classification ${args.confirmation}` : "No confirmation yet"
    },
    {
      id: "plan",
      label: "Entry / stop / targets available",
      complete: args.hasPlan,
      detail: args.hasPlan ? "Verified plan levels present" : "No actionable plan levels"
    },
    {
      id: "alignment",
      label: "Price sources aligned",
      complete: args.mode !== "MISMATCH",
      detail: args.mode === "MISMATCH" ? "Market data mismatch — do not combine levels" : "Sources OK"
    }
  ];
  const complete = items.filter((i) => i.complete).length;
  return { items, complete, total: items.length };
}

function resolveAction(args: {
  mode: MarketStructureMode;
  decision: string;
  confirmation: string | null;
  hasValidPlan: boolean;
  live: number | null;
  entry: number | null;
  vah: number | null;
  val: number | null;
  barLow: number | null;
  trend: string | null;
  location: ValueLocation;
}): {
  action: IntradayAction;
  trigger: string | null;
  triggerPrice: number | null;
  oneSentence: string;
  whyNotReady: string | null;
  entryConfirmation: string[];
  invalidation: string;
  nextTarget: string | null;
} {
  if (args.mode === "MISMATCH") {
    return {
      action: "NO_TRADE",
      trigger: null,
      triggerPrice: null,
      oneSentence: "Do not trade — price sources disagree, so levels cannot be combined safely.",
      whyNotReady: "Market data mismatch between the live quote and the stored strategy signal.",
      entryConfirmation: ["Wait until alert and live/structure prices agree again"],
      invalidation: "Any new mismatched complete signal keeps trading blocked.",
      nextTarget: null
    };
  }

  if (args.mode === "UNAVAILABLE") {
    return {
      action: "NO_TRADE",
      trigger: null,
      triggerPrice: null,
      oneSentence: "No verified XAUUSD decision is available yet.",
      whyNotReady: "GoldMeta has not received a usable quote or strategy signal.",
      entryConfirmation: ["Connect TradingView webhook and wait for the next confirmed bar"],
      invalidation: "N/A",
      nextTarget: null
    };
  }

  if (args.mode === "LIVE_RANGE_ONLY") {
    return {
      action: "PREPARE",
      trigger: "Wait for the next complete strategy signal with POC/VAH/VAL",
      triggerPrice: null,
      oneSentence: "Setup forming — live price is available but complete structure is not.",
      whyNotReady: "OHLC-only updates cannot create an entry plan without verified structure levels.",
      entryConfirmation: ["Complete strategy alert with POC/VAH/VAL", "Price-source consistency check"],
      invalidation: "A MISMATCH between quote and structure blocks planning.",
      nextTarget: null
    };
  }

  const conf = (args.confirmation ?? "NONE").toUpperCase();
  const decision = args.decision.toUpperCase();

  if (args.location === "BELOW_VALUE" && args.val != null) {
    return {
      action: "PREPARE",
      trigger: `Reclaim and hold above VAL ${args.val}`,
      triggerPrice: args.val,
      oneSentence: `Price is below value. VAL ${args.val} is the first reclaim/overhead resistance. A bullish plan requires a reclaim and hold above VAL; a failed reclaim may support bearish continuation.`,
      whyNotReady: "Price is below the value area — wait for reclaim-and-hold or a confirmed breakdown from genuine support below.",
      entryConfirmation: [
        "Confirmed close above VAL for bullish reclaim",
        "Or rejection/failed reclaim for bearish continuation",
        "Do not treat VAL as a floor while it remains above price"
      ],
      invalidation:
        args.barLow != null
          ? `Break and hold below ${args.barLow} ends the immediate reclaim attempt`
          : "Failed reclaim that accelerates lower",
      nextTarget: args.vah != null ? `VAH ${args.vah} after successful reclaim` : "POC / value after reclaim"
    };
  }

  if (args.location === "ABOVE_VALUE" && args.vah != null) {
    return {
      action: "PREPARE",
      trigger: `Hold / retest above VAH ${args.vah} or breakdown back below`,
      triggerPrice: args.vah,
      oneSentence: `Price is above value. VAH ${args.vah} is previous resistance that may act as support only after a valid hold/retest.`,
      whyNotReady: "Extension above value — wait for retest hold (bullish) or confirmed breakdown (bearish).",
      entryConfirmation: ["Retest hold above VAH", "Or confirmed close back below VAH for fade"],
      invalidation: `Close back through ${args.vah} against the intended side`,
      nextTarget: "Next verified extension / bar high or stretch estimate"
    };
  }

  if (decision === "BUY" && args.hasValidPlan && (conf === "BREAKOUT" || conf === "RETEST" || conf === "CONTINUATION")) {
    return {
      action: "BUY_NOW",
      trigger: args.entry != null ? `Buy zone near ${args.entry}` : "Buy per verified plan entry",
      triggerPrice: args.entry,
      oneSentence: "Buy plan is active with confirmation — manage risk manually; AutoTrade stays OFF.",
      whyNotReady: null,
      entryConfirmation: ["Plan still valid", "Stop and targets reviewed"],
      invalidation: args.val != null ? `Sustained break below ${args.val} / plan stop` : "Plan stop breach",
      nextTarget: "TP1 from the verified plan"
    };
  }

  if (
    decision === "SELL" &&
    args.hasValidPlan &&
    (conf === "BREAKOUT" || conf === "RETEST" || conf === "CONTINUATION" || conf === "REJECTION")
  ) {
    return {
      action: conf === "REJECTION" ? "SELL_ON_REJECTION" : "SELL_NOW",
      trigger: args.entry != null ? `Sell zone near ${args.entry}` : "Sell per verified plan entry",
      triggerPrice: args.entry,
      oneSentence: "Sell plan is active with confirmation — manage risk manually; AutoTrade stays OFF.",
      whyNotReady: null,
      entryConfirmation: ["Plan still valid", "Stop and targets reviewed"],
      invalidation: args.vah != null ? `Sustained break above ${args.vah} / plan stop` : "Plan stop breach",
      nextTarget: "TP1 from the verified plan"
    };
  }

  if (decision === "BUY" || (args.trend ?? "").toUpperCase().includes("BULL")) {
    if (args.val != null && args.live != null && args.live > args.val) {
      return {
        action: "BUY_ON_PULLBACK",
        trigger: `Watch pullback toward support/VAL near ${args.val}`,
        triggerPrice: args.val,
        oneSentence: "Bias is higher, but wait for a pullback hold before buying.",
        whyNotReady: "Immediate buy confirmation is incomplete — pullback + hold still required.",
        entryConfirmation: [
          "Touch or approach of buy zone / VAL",
          "Bullish rejection or confirmation candle",
          "No break and hold below invalidation"
        ],
        invalidation: `Break and hold below ${args.val}`,
        nextTarget: args.vah != null ? `VAH / ceiling near ${args.vah}` : "Next resistance"
      };
    }
    if (args.vah != null) {
      return {
        action: "BUY_ABOVE",
        trigger: `Break and hold above ${args.vah}`,
        triggerPrice: args.vah,
        oneSentence: "Bullish only after a confirmed break and hold above the ceiling.",
        whyNotReady: "Price has not confirmed acceptance above resistance.",
        entryConfirmation: ["Confirmed close above resistance", "Optional retest hold"],
        invalidation: "Failed breakout that closes back inside the range",
        nextTarget: "Next upside target from the plan or ATR stretch"
      };
    }
  }

  if (decision === "SELL" || (args.trend ?? "").toUpperCase().includes("BEAR")) {
    if (args.vah != null && args.live != null && args.live < args.vah) {
      return {
        action: "SELL_ON_REJECTION",
        trigger: `Watch rejection at resistance/VAH near ${args.vah}`,
        triggerPrice: args.vah,
        oneSentence: "Bias is lower, but wait for rejection at the ceiling before selling.",
        whyNotReady: "Immediate sell confirmation is incomplete — rejection still required.",
        entryConfirmation: [
          "Touch of sell zone / VAH",
          "Bearish rejection candle",
          "No break and hold above invalidation"
        ],
        invalidation: `Break and hold above ${args.vah}`,
        nextTarget: args.val != null ? `VAL / floor near ${args.val}` : "Next support"
      };
    }
    if (args.val != null) {
      return {
        action: "SELL_BELOW",
        trigger: `Break and hold below ${args.val}`,
        triggerPrice: args.val,
        oneSentence: "Bearish only after a confirmed break and hold below the floor.",
        whyNotReady: "Price has not confirmed acceptance below support.",
        entryConfirmation: ["Confirmed close below support", "Optional retest fail"],
        invalidation: "Failed breakdown that closes back inside the range",
        nextTarget: "Next downside target or ATR stretch"
      };
    }
  }

  if (args.vah != null && args.val != null && args.location === "INSIDE_VALUE") {
    return {
      action: "RANGE_TRADE",
      trigger: `Fade extremes between floor ${args.val} and ceiling ${args.vah} only with confirmation`,
      triggerPrice: null,
      oneSentence: "Market is two-sided — prepare both scenarios; do not force a mid-range entry.",
      whyNotReady: "No one-sided confirmation yet; mid-range entries are low quality.",
      entryConfirmation: [
        "Rejection at range edge",
        "Or break and hold beyond the edge with follow-through"
      ],
      invalidation: "Accepted breakout that turns the range into a trend",
      nextTarget: "Opposite side of the value area"
    };
  }

  return {
    action: "PREPARE",
    trigger: "Wait for the next confirmed structure interaction",
    triggerPrice: null,
    oneSentence: "Setup forming — GoldMeta is watching levels but entry is not ready.",
    whyNotReady: "Confirmation and/or complete plan conditions are still incomplete.",
    entryConfirmation: ["Clear trigger touch", "Confirmation candle", "Aligned structure"],
    invalidation: "Mode change to MISMATCH or loss of verified structure",
    nextTarget: null
  };
}

function buildTradePlanCard(args: {
  action: IntradayAction;
  decision: string;
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  rr: { tp1?: number | null; tp2?: number | null; tp3?: number | null } | null;
  invalidation: string;
  location: ValueLocation;
  val: number | null;
  vah: number | null;
  barLow: number | null;
  bullish: ScenarioPlan;
  bearish: ScenarioPlan;
}): ManualTradePlanCard {
  const dirRaw = args.decision === "BUY" ? "BUY" : args.decision === "SELL" ? "SELL" : "NONE";
  let orderingValid = false;
  let orderingNote: string | null = null;
  if (dirRaw !== "NONE" && args.entry != null && args.stop != null && args.tp1 != null) {
    const v = validatePlanOrdering({
      direction: dirRaw,
      entry: args.entry,
      stop: args.stop,
      tp1: args.tp1,
      tp2: args.tp2,
      tp3: args.tp3
    });
    orderingValid = v.valid;
    orderingNote = v.note;
  } else if (dirRaw !== "NONE") {
    orderingNote = "Missing entry, stop, or TP1 — cannot activate a manual trade plan.";
  }

  const actionable =
    (args.action === "BUY_NOW" || args.action === "SELL_NOW" || args.action === "SELL_ON_REJECTION") &&
    orderingValid &&
    dirRaw !== "NONE";

  const rrBits = [
    args.rr?.tp1 != null ? `TP1 R≈${args.rr.tp1}` : null,
    args.rr?.tp2 != null ? `TP2 R≈${args.rr.tp2}` : null,
    args.rr?.tp3 != null ? `TP3 R≈${args.rr.tp3}` : null
  ].filter(Boolean);

  const bullishConditional =
    !actionable
      ? {
          label: "Bullish conditional plan",
          direction: "BUY" as const,
          trigger: args.bullish.trigger,
          entryZone: args.bullish.triggerPrice != null ? String(args.bullish.triggerPrice) : null,
          stopLoss: args.bullish.invalidationPrice,
          tp1: args.bullish.firstTargetPrice,
          invalidation: args.bullish.invalidation,
          confirmationRequired: ["Confirmation candle on the bullish trigger"]
        }
      : null;

  const bearishConditional =
    !actionable
      ? {
          label: "Bearish conditional plan",
          direction: "SELL" as const,
          trigger: args.bearish.trigger,
          entryZone: args.bearish.triggerPrice != null ? String(args.bearish.triggerPrice) : null,
          stopLoss: args.bearish.invalidationPrice,
          tp1: args.bearish.firstTargetPrice,
          invalidation: args.bearish.invalidation,
          confirmationRequired: ["Confirmation candle on the bearish trigger"]
        }
      : null;

  if (!actionable) {
    return {
      cardKind: "CONDITIONAL_REFERENCE",
      title: "Conditional levels — no active trade plan",
      actionable: false,
      direction: "NONE",
      entryZone: null,
      stopLoss: null,
      tp1: null,
      tp2: null,
      tp3: null,
      riskReward: null,
      maxCashRiskNote: "No active trade — set cash risk in the Risk planner only if you later enter manually.",
      positionSizeNote: "No trade plan is active. Reference levels below are not an order ticket.",
      invalidation: args.invalidation,
      management: "Wait for confirmation. Do not treat stop/TP references as an active plan.",
      orderingValid: false,
      orderingNote: orderingNote ?? "No trade plan is active.",
      bullishConditional,
      bearishConditional
    };
  }

  return {
    cardKind: "ACTIVE_PLAN",
    title: "Manual trade plan",
    actionable: true,
    direction: dirRaw,
    entryZone: args.entry != null ? String(args.entry) : null,
    stopLoss: args.stop,
    tp1: args.tp1,
    tp2: args.tp2,
    tp3: args.tp3,
    riskReward: rrBits.length ? rrBits.join(" · ") : null,
    maxCashRiskNote: "Set cash risk in the Risk planner — GoldMeta never places orders.",
    positionSizeNote: "Position size is manual. Open Risk planner if you need a size estimate.",
    invalidation: args.invalidation,
    management: "If TP1 is reached manually, consider moving stop toward breakeven. Never average down.",
    orderingValid: true,
    orderingNote: null,
    bullishConditional: null,
    bearishConditional: null
  };
}

export type BuildIntradayPlanArgs = {
  quote: DecisionRecord | null;
  structure: DecisionRecord | null;
  mode: MarketStructureMode;
  quoteAgeSeconds?: number | null;
  signalAgeSeconds?: number | null;
};

export function buildIntradayPlan(args: BuildIntradayPlanArgs): IntradayPlan {
  const quote = args.quote;
  const structure = args.mode === "COMPLETE" ? args.structure ?? args.quote : null;
  const live =
    positive(quote?.lastKnownPrice) ??
    positive(quote?.ohlcv?.close) ??
    positive(structure?.lastKnownPrice) ??
    null;
  const poc = positive(structure?.marketStructure?.poc);
  const vah = positive(structure?.marketStructure?.vah);
  const val = positive(structure?.marketStructure?.val);
  const barHigh = positive(quote?.ohlcv?.high) ?? positive(structure?.ohlcv?.high);
  const barLow = positive(quote?.ohlcv?.low) ?? positive(structure?.ohlcv?.low);
  const entry = positive(structure?.entry?.price);
  const stop = positive(structure?.stopLoss?.price);
  const tps = structure?.takeProfits ?? [];
  const tp1 = positive(tps.find((t) => t.label === "TP1")?.price) ?? positive(tps[0]?.price);
  const tp2 = positive(tps.find((t) => t.label === "TP2")?.price) ?? positive(tps[1]?.price);
  const tp3 = positive(tps.find((t) => t.label === "TP3")?.price) ?? positive(tps[2]?.price);
  const atrExt = (rec: DecisionRecord | null | undefined): number | null =>
    positive((rec as DecisionRecord & { atr?: unknown } | null | undefined)?.atr);
  const atr = atrExt(structure) ?? atrExt(quote);
  const decision = (structure?.decision ?? quote?.decision ?? "WAIT").toUpperCase();
  const confirmation =
    structure?.marketStructure?.confirmationClassification ??
    quote?.marketStructure?.confirmationClassification ??
    null;
  const trend =
    structure?.marketStructure?.trend ??
    structure?.higherTimeframeBias ??
    quote?.marketStructure?.trend ??
    null;

  const location = valueLocationOf(live, val, vah);

  let hasValidPlan = false;
  if (entry != null && stop != null && tp1 != null && (decision === "BUY" || decision === "SELL")) {
    hasValidPlan = validatePlanOrdering({
      direction: decision,
      entry,
      stop,
      tp1,
      tp2,
      tp3
    }).valid;
  }

  const resolved = resolveAction({
    mode: args.mode,
    decision,
    confirmation,
    hasValidPlan,
    live,
    entry,
    vah,
    val,
    barLow,
    trend,
    location
  });

  const checklist = buildChecklist({
    mode: args.mode,
    decision,
    confirmation,
    hasPlan: hasValidPlan,
    poc,
    live
  });

  const importantLevels = buildImportantLevels({
    live,
    poc,
    vah,
    val,
    barHigh,
    barLow,
    entry,
    stop,
    tp1,
    tp2,
    tp3,
    atr,
    timeframe: structure?.timeframe ?? quote?.timeframe ?? null,
    mode: args.mode,
    decision,
    location
  });

  const expectedRange = buildExpectedRange({
    live,
    vah,
    val,
    barHigh,
    barLow,
    atr,
    mode: args.mode,
    location
  });

  const nearestSupport =
    importantLevels
      .filter(
        (l) =>
          l.price != null &&
          (l.roleAtCurrentPrice === "SUPPORT" ||
            l.roleAtCurrentPrice === "PREVIOUS_RESISTANCE_NOW_SUPPORT") &&
          l.proximity !== "ABOVE"
      )
      .sort((a, b) => (b.price ?? 0) - (a.price ?? 0))[0]?.price ??
    (barLow != null && live != null && barLow <= live ? barLow : null);

  const nearestResistance =
    importantLevels
      .filter(
        (l) =>
          l.price != null &&
          (l.roleAtCurrentPrice === "RESISTANCE" ||
            l.roleAtCurrentPrice === "RECLAIM_LEVEL" ||
            l.roleAtCurrentPrice === "PREVIOUS_SUPPORT_NOW_RESISTANCE") &&
          l.proximity !== "BELOW"
      )
      .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0]?.price ??
    (val != null && live != null && val >= live ? val : vah);

  const scenarios = buildScenarios({
    location,
    live,
    val,
    vah,
    poc,
    barLow,
    barHigh,
    tp1,
    tp2,
    stop,
    expectedRange
  });

  const zones = buildZones({
    location,
    live,
    poc,
    vah,
    val,
    barLow,
    nearestSupport,
    nearestResistance
  });

  const confidenceBase =
    typeof (structure?.confidence ?? quote?.confidence) === "number"
      ? Number(structure?.confidence ?? quote?.confidence)
      : checklist.complete * (100 / checklist.total);
  const confidence = Math.round(
    Math.max(0, Math.min(100, confidenceBase <= 1 ? confidenceBase * 100 : confidenceBase))
  );

  return {
    schemaVersion: "1.1",
    action: resolved.action,
    actionLabel: actionLabel(resolved.action),
    oneSentence: resolved.oneSentence,
    trigger: resolved.trigger,
    triggerPrice: resolved.triggerPrice,
    distanceToTriggerPoints:
      resolved.triggerPrice != null && live != null
        ? round2(Math.abs(resolved.triggerPrice - live))
        : null,
    entryConfirmation: resolved.entryConfirmation,
    invalidation: resolved.invalidation,
    nextTarget: resolved.nextTarget,
    whyNotReady: resolved.whyNotReady,
    valueLocation: location,
    setupProgress: {
      complete: checklist.complete,
      total: checklist.total,
      label: `${checklist.complete} of ${checklist.total} conditions complete`,
      items: checklist.items
    },
    directionBias: biasFromTrend(trend, decision),
    marketType: marketTypeFrom(trend, confirmation),
    session: quote?.currentSession ?? structure?.currentSession ?? null,
    confidence,
    expectedRange,
    bullishScenario: scenarios.bullish,
    bearishScenario: scenarios.bearish,
    zones,
    importantLevels,
    tradePlan: buildTradePlanCard({
      action: resolved.action,
      decision,
      entry,
      stop,
      tp1,
      tp2,
      tp3,
      rr: structure?.riskReward ?? null,
      invalidation: resolved.invalidation,
      location,
      val,
      vah,
      barLow,
      bullish: scenarios.bullish,
      bearish: scenarios.bearish
    }),
    freshness: {
      quoteAgeSeconds: args.quoteAgeSeconds ?? null,
      signalAgeSeconds: args.signalAgeSeconds ?? null,
      marketStructureMode: args.mode,
      sourceLabel: quote?.dataSourceLabel ?? structure?.dataSourceLabel ?? "UNKNOWN",
      dataQuality: quote?.dataQuality ?? structure?.dataQuality ?? null
    },
    safety: {
      autoTrade: "OFF",
      demoOrderSubmission: false,
      liveTrading: false,
      analysisOnly: true
    },
    disclaimer:
      "GoldMeta is analysis-only manual assistance for adult traders. AutoTrade stays OFF. No broker orders are submitted."
  };
}

/**
 * Labelled UI/test fixture from the Issue #50 chart example (price below value).
 * Never used as production defaults.
 */
export function buildChartExampleIntradayFixture(livePrice = 4034.815): IntradayPlan {
  const base = buildIntradayPlan({
    mode: "COMPLETE",
    quoteAgeSeconds: 30,
    signalAgeSeconds: 120,
    quote: {
      decisionId: "fixture-quote",
      userId: "fixture",
      decision: "WAIT",
      lastKnownPrice: livePrice,
      ohlcv: { open: 4036, high: 4041.2, low: 4031.1, close: livePrice, volume: 1 },
      currentSession: "LONDON",
      dataSourceLabel: "TEST",
      isTestDecision: true,
      environment: "TEST",
      generatedAt: new Date().toISOString(),
      marketDataTime: new Date().toISOString(),
      confidence: 0.55,
      atr: 12.5,
      timeframe: "15",
      reasonCodes: ["FIXTURE"],
      marketStructure: {
        trend: "RANGE",
        poc: 4045.087,
        vah: 4049.633,
        val: 4037.308,
        confirmationClassification: "NONE"
      }
    } as unknown as DecisionRecord,
    structure: {
      decisionId: "fixture-structure",
      userId: "fixture",
      decision: "WAIT",
      lastKnownPrice: livePrice,
      ohlcv: { open: 4036, high: 4041.2, low: 4031.1, close: livePrice, volume: 1 },
      currentSession: "LONDON",
      dataSourceLabel: "TEST",
      isTestDecision: true,
      environment: "TEST",
      generatedAt: new Date().toISOString(),
      confidence: 0.55,
      atr: 12.5,
      timeframe: "15",
      marketStructure: {
        trend: "RANGE",
        poc: 4045.087,
        vah: 4049.633,
        val: 4037.308,
        confirmationClassification: "NONE"
      },
      entry: { price: null },
      stopLoss: { price: 4028.6 },
      takeProfits: [
        { label: "TP1", price: 4045.1 },
        { label: "TP2", price: 4049.8 },
        { label: "TP3", price: 4053.7 }
      ]
    } as unknown as DecisionRecord
  });

  return {
    ...base,
    oneSentence: `${base.oneSentence} (LABELLED FIXTURE — not live market data)`,
    freshness: {
      ...base.freshness,
      sourceLabel: "TEST_FIXTURE"
    },
    disclaimer: `${base.disclaimer} This payload is a labelled Issue #50 chart fixture for UI/tests only.`
  };
}
