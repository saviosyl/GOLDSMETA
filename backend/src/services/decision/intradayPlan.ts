/**
 * Issue #50 — build structured intraday plan from quote + complete strategy signal.
 * Never invent levels without structured reasons. Preserve PR #47 market-structure modes.
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
  LevelSide,
  LevelStrength,
  ManualTradePlanCard,
  SetupChecklistItem
} from "./intradayPlanTypes";

const ESTIMATE_DISCLAIMER =
  "Probable and stretch prices are estimates only — never guarantees. Markets can move beyond any projected range.";

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
  const d = dist(args.price, args.live);
  return {
    id: args.id,
    side: args.side,
    kind: args.kind,
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
}): ImportantLevel[] {
  if (args.mode === "MISMATCH" || args.mode === "UNAVAILABLE") return [];
  const live = args.live;
  const tf = args.timeframe;
  const levels: ImportantLevel[] = [];

  if (args.mode === "COMPLETE") {
    if (args.vah != null) {
      const L = makeLevel({
        id: "lvl-vah",
        side: "UPSIDE",
        kind: "RESISTANCE",
        price: args.vah,
        strength: "STRONG",
        live,
        shortMeaning: "Value-area high — nearest ceiling above value",
        reasons: [
          reason(
            "VAH",
            "Value Area High (VAH)",
            "VAH is the upper edge of the session value area where most volume traded. Traders often watch it as a ceiling (resistance).",
            tf
          )
        ],
        whatToWatch: [
          "Rejection (touch and fall back) near VAH",
          "Break and hold (breakout) above VAH on a confirmed candle"
        ],
        ifHolds: "Price may stall or reverse lower from this ceiling.",
        ifBreaks: "A break and hold above VAH can open the next upside target zone.",
        confirmationRequired: [
          "Confirmed candle close above VAH for breakout",
          "Or clear rejection wick with follow-through for fade"
        ],
        nextLevelId: args.tp1 != null ? "lvl-tp1" : args.poc != null ? "lvl-poc" : null,
        simpleExplanation:
          "Think of VAH as a ceiling built from where most trading happened. Price often pauses here.",
        confidence: 78
      });
      if (L) levels.push(L);
    }

    if (args.poc != null) {
      const side: LevelSide =
        live != null && args.poc >= live ? "UPSIDE" : "DOWNSIDE";
      const L = makeLevel({
        id: "lvl-poc",
        side,
        kind: side === "UPSIDE" ? "RESISTANCE" : "SUPPORT",
        price: args.poc,
        strength: "MAJOR",
        live,
        shortMeaning: "Point of Control — busiest traded price (magnet)",
        reasons: [
          reason(
            "POC",
            "Point of Control (POC)",
            "POC is the price with the highest traded volume in the profile. It often acts as a magnet and a decision point.",
            tf
          )
        ],
        whatToWatch: ["Acceptance through POC", "Rejection away from POC"],
        ifHolds: "Price may rotate back into the value area around POC.",
        ifBreaks: "Leaving POC with momentum can signal a new directional leg.",
        confirmationRequired: ["Confirmed close through POC", "Follow-through volume if available"],
        nextLevelId: side === "UPSIDE" ? "lvl-vah" : "lvl-val",
        simpleExplanation:
          "POC is where the market did the most business. Price often returns here like a magnet.",
        confidence: 82
      });
      if (L) levels.push(L);
    }

    if (args.val != null) {
      const L = makeLevel({
        id: "lvl-val",
        side: "DOWNSIDE",
        kind: "SUPPORT",
        price: args.val,
        strength: "STRONG",
        live,
        shortMeaning: "Value-area low — nearest floor under value",
        reasons: [
          reason(
            "VAL",
            "Value Area Low (VAL)",
            "VAL is the lower edge of the session value area. Traders often watch it as a floor (support).",
            tf
          )
        ],
        whatToWatch: [
          "Rejection (touch and bounce) near VAL",
          "Break and hold (breakdown) below VAL on a confirmed candle"
        ],
        ifHolds: "Price may bounce from this floor back toward POC/VAH.",
        ifBreaks: "A break and hold below VAL can open lower downside targets.",
        confirmationRequired: [
          "Confirmed candle close below VAL for breakdown",
          "Or clear rejection wick with follow-through for bounce"
        ],
        nextLevelId: args.stop != null ? "lvl-stop" : null,
        simpleExplanation:
          "Think of VAL as a floor built from where most trading happened. Price often pauses here.",
        confidence: 78
      });
      if (L) levels.push(L);
    }
  }

  if (args.barHigh != null) {
    const L = makeLevel({
      id: "lvl-bar-high",
      side: "UPSIDE",
      kind: "RESISTANCE",
      price: args.barHigh,
      strength: "MODERATE",
      live,
      shortMeaning: "Recent bar high — short-term ceiling",
      reasons: [
        reason(
          "SESSION_HIGH",
          "Recent bar / session high",
          "The latest verified bar high marks a nearby short-term ceiling until broken and held.",
          tf
        )
      ],
      whatToWatch: ["Break and hold above the high", "Rejection back into the range"],
      ifHolds: "Sellers may defend this short-term ceiling.",
      ifBreaks: "Break and hold can extend toward the next upside level.",
      confirmationRequired: ["Confirmed close above the high"],
      nextLevelId: args.vah != null ? "lvl-vah" : null,
      simpleExplanation: "The recent high is a nearby ceiling until buyers prove they can hold above it.",
      confidence: 60
    });
    if (L) levels.push(L);
  }

  if (args.barLow != null) {
    const L = makeLevel({
      id: "lvl-bar-low",
      side: "DOWNSIDE",
      kind: "SUPPORT",
      price: args.barLow,
      strength: "MODERATE",
      live,
      shortMeaning: "Recent bar low — short-term floor",
      reasons: [
        reason(
          "SESSION_LOW",
          "Recent bar / session low",
          "The latest verified bar low marks a nearby short-term floor until broken and held.",
          tf
        )
      ],
      whatToWatch: ["Break and hold below the low", "Rejection bounce"],
      ifHolds: "Buyers may defend this short-term floor.",
      ifBreaks: "Break and hold can extend toward the next downside level.",
      confirmationRequired: ["Confirmed close below the low"],
      nextLevelId: args.val != null ? "lvl-val" : null,
      simpleExplanation: "The recent low is a nearby floor until sellers prove they can hold below it.",
      confidence: 60
    });
    if (L) levels.push(L);
  }

  if (args.tp1 != null && args.mode === "COMPLETE") {
    const L = makeLevel({
      id: "lvl-tp1",
      side: "UPSIDE",
      kind: "TARGET",
      price: args.tp1,
      strength: "MODERATE",
      live,
      shortMeaning: "First verified upside target (TP1)",
      reasons: [
        reason(
          "PLAN_TARGET",
          "Trade-plan target TP1",
          "TP1 comes from the latest valid complete strategy signal trade plan — not invented locally.",
          tf
        )
      ],
      whatToWatch: ["Progress toward TP1 after a confirmed entry"],
      ifHolds: "As a target, holding here means profit-taking may stall further upside.",
      ifBreaks: "Reaching TP1 may justify partial profit-taking in a manual plan.",
      confirmationRequired: ["Valid entry first", "Plan still active"],
      nextLevelId: args.tp2 != null ? "lvl-tp2" : null,
      simpleExplanation: "TP1 is the first planned take-profit from the verified strategy signal.",
      confidence: 70
    });
    if (L) levels.push(L);
  }

  if (args.tp2 != null && args.mode === "COMPLETE") {
    const L = makeLevel({
      id: "lvl-tp2",
      side: "UPSIDE",
      kind: "TARGET",
      price: args.tp2,
      strength: "STRONG",
      live,
      shortMeaning: "Second verified upside target (TP2)",
      reasons: [
        reason(
          "PLAN_TARGET",
          "Trade-plan target TP2",
          "TP2 comes from the latest valid complete strategy signal trade plan.",
          tf
        )
      ],
      whatToWatch: ["Extension after TP1"],
      ifHolds: "Holding near TP2 can mean momentum is slowing after the extension.",
      ifBreaks: "May allow further manual scaling out.",
      confirmationRequired: ["Valid entry first"],
      nextLevelId: args.tp3 != null ? "lvl-tp3" : null,
      simpleExplanation: "TP2 is a further target if the move continues after TP1.",
      confidence: 65
    });
    if (L) levels.push(L);
  }

  if (args.tp3 != null && args.mode === "COMPLETE") {
    const L = makeLevel({
      id: "lvl-tp3",
      side: "UPSIDE",
      kind: "STRETCH",
      price: args.tp3,
      strength: "MAJOR",
      live,
      shortMeaning: "Stretch upside target (TP3)",
      reasons: [
        reason(
          "PLAN_TARGET",
          "Trade-plan target TP3",
          "TP3 is the stretch target from the verified strategy plan.",
          tf
        )
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
      side: "DOWNSIDE",
      kind: "BREAKDOWN",
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
      ifHolds: "Plan may still be valid if price holds above invalidation.",
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

  // Sort: upside descending, then downside ascending for stable UI.
  return levels.sort((a, b) => {
    const ap = a.price ?? 0;
    const bp = b.price ?? 0;
    if (a.side !== b.side) return a.side === "UPSIDE" ? -1 : 1;
    return b.side === "UPSIDE" ? bp - ap : ap - bp;
  });
}

function buildExpectedRange(args: {
  live: number | null;
  vah: number | null;
  val: number | null;
  barHigh: number | null;
  barLow: number | null;
  atr: number | null;
  mode: MarketStructureMode;
}): ExpectedRange {
  const live = args.live;
  let probableLow: number | null = null;
  let probableHigh: number | null = null;
  const reasons: string[] = [];

  if (args.mode === "COMPLETE" && args.val != null && args.vah != null) {
    probableLow = args.val;
    probableHigh = args.vah;
    reasons.push("Probable range anchored to verified VAL → VAH value area");
  } else if (args.barLow != null && args.barHigh != null) {
    probableLow = args.barLow;
    probableHigh = args.barHigh;
    reasons.push("OHLC-only mode: probable range uses verified bar high/low only");
  }

  let stretchLow: number | null = null;
  let stretchHigh: number | null = null;
  if (live != null && args.atr != null) {
    stretchLow = round2(Math.min(probableLow ?? live, live - args.atr));
    stretchHigh = round2(Math.max(probableHigh ?? live, live + args.atr));
    reasons.push("Stretch targets use approximately one ATR beyond the probable range");
  } else if (probableLow != null && probableHigh != null) {
    const width = probableHigh - probableLow;
    stretchLow = round2(probableLow - width * 0.35);
    stretchHigh = round2(probableHigh + width * 0.35);
    reasons.push("Stretch targets extend ~35% beyond the probable range width");
  }

  // Enforce ordering when all present.
  if (
    stretchLow != null &&
    probableLow != null &&
    probableHigh != null &&
    stretchHigh != null
  ) {
    const ordered = [stretchLow, probableLow, probableHigh, stretchHigh].sort((a, b) => a - b);
    stretchLow = ordered[0]!;
    probableLow = ordered[1]!;
    probableHigh = ordered[2]!;
    stretchHigh = ordered[3]!;
  }

  const remainingAbovePoints =
    live != null && probableHigh != null ? round2(probableHigh - live) : null;
  const remainingBelowPoints =
    live != null && probableLow != null ? round2(live - probableLow) : null;

  return {
    probableLow,
    probableHigh,
    stretchLow,
    stretchHigh,
    currentPrice: live,
    remainingAbovePoints,
    remainingBelowPoints,
    remainingAbovePercent:
      live != null && remainingAbovePoints != null ? round2((remainingAbovePoints / live) * 100) : null,
    remainingBelowPercent:
      live != null && remainingBelowPoints != null ? round2((remainingBelowPoints / live) * 100) : null,
    confidence: args.mode === "COMPLETE" ? 72 : args.mode === "LIVE_RANGE_ONLY" ? 40 : 0,
    reasons,
    invalidation:
      "Recalculate when a new complete strategy signal arrives, when price leaves the stretch band, or when market-structure mode becomes MISMATCH.",
    estimateDisclaimer: ESTIMATE_DISCLAIMER
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
  hasPlan: boolean;
  live: number | null;
  entry: number | null;
  vah: number | null;
  val: number | null;
  trend: string | null;
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

  if (decision === "BUY" && args.hasPlan && (conf === "BREAKOUT" || conf === "RETEST" || conf === "CONTINUATION")) {
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

  if (decision === "SELL" && args.hasPlan && (conf === "BREAKOUT" || conf === "RETEST" || conf === "CONTINUATION" || conf === "REJECTION")) {
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

  if (args.vah != null && args.val != null) {
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
}): ManualTradePlanCard {
  const actionable =
    (args.action === "BUY_NOW" || args.action === "SELL_NOW" || args.action === "SELL_ON_REJECTION") &&
    args.entry != null &&
    args.stop != null;
  const direction =
    args.decision === "BUY" ? "BUY" : args.decision === "SELL" ? "SELL" : "NONE";
  const rrBits = [
    args.rr?.tp1 != null ? `TP1 R≈${args.rr.tp1}` : null,
    args.rr?.tp2 != null ? `TP2 R≈${args.rr.tp2}` : null,
    args.rr?.tp3 != null ? `TP3 R≈${args.rr.tp3}` : null
  ].filter(Boolean);

  return {
    actionable,
    direction: actionable ? direction : direction === "NONE" ? "NONE" : direction,
    entryZone: args.entry != null ? String(args.entry) : null,
    stopLoss: args.stop,
    tp1: args.tp1,
    tp2: args.tp2,
    tp3: args.tp3,
    riskReward: rrBits.length ? rrBits.join(" · ") : null,
    maxCashRiskNote: "Set cash risk in the Risk planner — GoldMeta never places orders.",
    positionSizeNote: "Position size is manual. Open Risk planner if you need a size estimate.",
    invalidation: args.invalidation,
    management: "If TP1 is reached manually, consider moving stop toward breakeven. Never average down."
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
  // ATR is not a first-class DecisionRecord field; accept optional payload extensions.
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
  const hasPlan = entry != null || stop != null || tp1 != null;

  const resolved = resolveAction({
    mode: args.mode,
    decision,
    confirmation,
    hasPlan: Boolean(hasPlan && entry != null && stop != null),
    live,
    entry,
    vah,
    val,
    trend
  });

  const checklist = buildChecklist({
    mode: args.mode,
    decision,
    confirmation,
    hasPlan: Boolean(hasPlan && entry != null && stop != null),
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
    mode: args.mode
  });

  const expectedRange = buildExpectedRange({
    live,
    vah,
    val,
    barHigh,
    barLow,
    atr,
    mode: args.mode
  });

  const nearestSupport =
    importantLevels
      .filter((l) => l.side === "DOWNSIDE" && l.price != null)
      .sort((a, b) => (b.price ?? 0) - (a.price ?? 0))[0]?.price ?? val;
  const nearestResistance =
    importantLevels
      .filter((l) => l.side === "UPSIDE" && l.price != null)
      .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0]?.price ?? vah;

  const confidenceBase =
    typeof (structure?.confidence ?? quote?.confidence) === "number"
      ? Number(structure?.confidence ?? quote?.confidence)
      : checklist.complete * (100 / checklist.total);
  const confidence = Math.round(
    Math.max(0, Math.min(100, confidenceBase <= 1 ? confidenceBase * 100 : confidenceBase))
  );

  return {
    schemaVersion: "1.0",
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
    bullishScenario: {
      label: "If price rises",
      trigger:
        vah != null
          ? `Break and hold above ${vah} (ceiling) or bounce from ${val ?? "support"}`
          : "Break and hold above nearest resistance",
      firstTarget: tp1 != null ? String(tp1) : expectedRange.probableHigh != null ? String(expectedRange.probableHigh) : "Next resistance",
      secondTarget:
        tp2 != null
          ? String(tp2)
          : expectedRange.stretchHigh != null
            ? String(expectedRange.stretchHigh)
            : "Stretch high (estimate)",
      invalidation: val != null ? `Break and hold below ${val}` : resolved.invalidation
    },
    bearishScenario: {
      label: "If price falls",
      trigger:
        val != null
          ? `Break and hold below ${val} (floor) or rejection from ${vah ?? "resistance"}`
          : "Break and hold below nearest support",
      firstTarget:
        stop != null && decision === "SELL"
          ? String(tp1 ?? expectedRange.probableLow ?? "Next support")
          : expectedRange.probableLow != null
            ? String(expectedRange.probableLow)
            : "Next support",
      secondTarget:
        expectedRange.stretchLow != null ? String(expectedRange.stretchLow) : "Stretch low (estimate)",
      invalidation: vah != null ? `Break and hold above ${vah}` : resolved.invalidation
    },
    zones: {
      bestBuyZone: val != null ? `${val}–${poc ?? val}` : null,
      bestSellZone: vah != null ? `${poc ?? vah}–${vah}` : null,
      noTradeZone:
        val != null && vah != null && poc != null
          ? `Avoid chasing mid-range near ${poc} without confirmation`
          : "Avoid mid-range entries without confirmation",
      nearestSupport,
      nearestResistance
    },
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
      invalidation: resolved.invalidation
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
 * Labelled UI/test fixture from the Issue #50 chart example.
 * Never used as production defaults — callers must pass isFixture explicitly.
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

  // Annotate fixture clearly for UI review / tests only.
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
