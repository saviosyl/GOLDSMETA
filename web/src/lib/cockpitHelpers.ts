/** Pure UI helpers for the Overview research cockpit — never invent market data. */

import type {
  ImportantLevel,
  IntradayAction,
  IntradayPlan,
  ScenarioPlan
} from "../types/intradayPlan";
import type { Decision } from "../types/models";
import { biasLabel, marketTypeLabel, valueLocationLabel } from "./intradayFormat";

export type FreshnessTone = "fresh" | "ageing" | "stale" | "mismatch";

export type ScenarioStatus = "Waiting" | "Forming" | "Confirmed" | "Invalid" | "Unavailable";

export type LevelProgressState =
  | "approaching"
  | "touched"
  | "held"
  | "broken"
  | "retested";

export type ResearchCell = {
  value: string;
  state: "bullish" | "bearish" | "neutral" | "unavailable" | "waiting" | "forming";
  meaning: string;
  why: string;
  supports: string;
};

export type ResearchRow = {
  tf: string;
  cells: Record<string, ResearchCell>;
};

export type IndicatorChip = {
  id: string;
  label: string;
  value: string;
  state: "bullish" | "bearish" | "neutral" | "unavailable";
  tooltip: string;
  explanation: string;
};

export function shortActionLabel(action: IntradayAction | string, actionLabel?: string): string {
  const a = String(action).toUpperCase();
  if (a === "BUY_NOW") return "BUY NOW";
  if (a === "SELL_NOW") return "SELL NOW";
  if (a === "RANGE_TRADE") return "RANGE TRADE";
  if (a === "NO_TRADE") return "NO TRADE";
  if (a === "PREPARE") return "PREPARE";
  if (a.startsWith("BUY")) return actionLabel?.split("—")[0]?.trim() || "BUY SETUP";
  if (a.startsWith("SELL")) return actionLabel?.split("—")[0]?.trim() || "SELL SETUP";
  return actionLabel ?? a.replace(/_/g, " ");
}

export function freshnessTone(args: {
  quoteAgeSeconds: number | null | undefined;
  source: "live" | "cached" | "offline";
  marketStructureMode: string | null | undefined;
  dataQuality?: string | null;
}): FreshnessTone {
  if (args.marketStructureMode === "MISMATCH" || args.dataQuality === "CONFLICTED") {
    return "mismatch";
  }
  if (args.source !== "live") return "stale";
  const age = args.quoteAgeSeconds;
  if (age == null || !Number.isFinite(age)) return "ageing";
  if (age <= 45) return "fresh";
  if (age <= 180) return "ageing";
  return "stale";
}

export function freshnessChipLabel(args: {
  tone: FreshnessTone;
  quoteAgeSeconds: number | null | undefined;
  source: "live" | "cached" | "offline";
  compactTime?: string;
}): string {
  if (args.tone === "mismatch") return "Mismatch";
  if (args.source === "offline") return "Offline";
  if (args.source === "cached") return args.compactTime ? `Cached · ${args.compactTime}` : "Cached";
  const age = args.quoteAgeSeconds;
  if (age == null || !Number.isFinite(age)) {
    return args.compactTime ? `Updated ${args.compactTime}` : "Updated";
  }
  if (age < 60) return `Updated ${Math.max(1, Math.round(age))}s ago`;
  if (age < 3600) return `Updated ${Math.round(age / 60)}m ago`;
  return `Updated ${Math.round(age / 3600)}h ago`;
}

export function scenarioStatus(
  plan: IntradayPlan,
  scenario: ScenarioPlan,
  side: "bull" | "bear"
): ScenarioStatus {
  const unavailable =
    /unavailable/i.test(scenario.firstTarget) ||
    /unavailable/i.test(scenario.trigger) ||
    scenario.firstTargetPrice == null;
  if (unavailable && side === "bear" && /unavailable/i.test(scenario.firstTarget)) {
    return "Unavailable";
  }
  if (unavailable && /unavailable/i.test(scenario.trigger)) return "Unavailable";

  if (plan.action === "NO_TRADE") return "Invalid";
  if (plan.freshness.marketStructureMode === "MISMATCH") return "Invalid";

  if (side === "bull" && plan.action === "BUY_NOW") return "Confirmed";
  if (side === "bear" && plan.action === "SELL_NOW") return "Confirmed";

  if (
    (side === "bull" && plan.action.startsWith("BUY")) ||
    (side === "bear" && plan.action.startsWith("SELL"))
  ) {
    return plan.setupProgress.complete >= Math.max(1, plan.setupProgress.total - 1)
      ? "Forming"
      : "Waiting";
  }

  if (plan.action === "PREPARE" || plan.action === "RANGE_TRADE") {
    return plan.setupProgress.complete >= 3 ? "Forming" : "Waiting";
  }
  return "Waiting";
}

export function levelProgressState(level: ImportantLevel): LevelProgressState {
  const role = level.roleAtCurrentPrice;
  if (
    role === "PREVIOUS_SUPPORT_NOW_RESISTANCE" ||
    role === "PREVIOUS_RESISTANCE_NOW_SUPPORT"
  ) {
    return "retested";
  }
  if (role === "BREAKDOWN_LEVEL" || role === "BREAKOUT_LEVEL") {
    return level.proximity === "NEAR" ? "touched" : "broken";
  }
  if (level.proximity === "NEAR") {
    return Math.abs(level.distancePoints ?? 99) < 0.35 ? "touched" : "approaching";
  }
  if (role === "SUPPORT" || role === "RESISTANCE" || role === "RECLAIM_LEVEL") {
    return "held";
  }
  return "approaching";
}

function unavailableCell(topic: string): ResearchCell {
  return {
    value: "Unavailable",
    state: "unavailable",
    meaning: `${topic} is not in the verified feed yet.`,
    why: "GoldMeta only shows timeframe research when the backend supplies it.",
    supports: "No-trade until verified data arrives."
  };
}

function biasState(bias: string): ResearchCell["state"] {
  const b = bias.toUpperCase();
  if (b.includes("BULL")) return "bullish";
  if (b.includes("BEAR")) return "bearish";
  return "neutral";
}

/** Build research matrix rows from verified plan + decision fields only. */
export function buildResearchRows(args: {
  plan: IntradayPlan;
  decision: Decision | null;
  scoreComponents?: Array<{ label: string; score: number; max: number; reason: string }> | null;
}): ResearchRow[] {
  const { plan, decision } = args;
  const ms = decision?.marketStructure;
  const signalTf = (decision?.timeframe || "").toUpperCase() || null;
  const htf = decision?.higherTimeframeBias ?? null;

  const momentumComp = args.scoreComponents?.find((c) => /momentum/i.test(c.label));
  const volumeComp = args.scoreComponents?.find((c) => /volume/i.test(c.label));
  const confirmItem = plan.setupProgress.items.find((i) => i.id === "confirmation");
  const structureItem = plan.setupProgress.items.find((i) => i.id === "structure");

  const positionCell = (): ResearchCell => {
    const loc = plan.valueLocation ?? plan.expectedRange.valueLocation;
    if (!loc || loc === "UNKNOWN") return unavailableCell("Position vs value");
    return {
      value: valueLocationLabel(loc),
      state:
        loc === "BELOW_VALUE" ? "waiting" : loc === "ABOVE_VALUE" ? "forming" : "neutral",
      meaning: `Price is ${valueLocationLabel(loc).toLowerCase()} relative to the accepted value area.`,
      why: "Value area location frames whether buys need reclaim or sells need rejection.",
      supports:
        loc === "BELOW_VALUE"
          ? "Supports wait / reclaim research before buys."
          : loc === "ABOVE_VALUE"
            ? "Supports wait / rejection research before sells."
            : "Supports two-sided research inside value."
    };
  };

  const confirmationCell = (): ResearchCell => {
    const cls = ms?.confirmationClassification;
    if (!cls || cls === "NONE" || !confirmItem) {
      return {
        value: confirmItem?.complete ? "Present" : "Waiting",
        state: confirmItem?.complete ? "forming" : "waiting",
        meaning: confirmItem?.detail || "No confirmation candle classification yet.",
        why: "Confirmation reduces false breaks around triggers.",
        supports: "Waiting reduces chase risk."
      };
    }
    const dir = (ms?.confirmationDirection || "").toUpperCase();
    return {
      value: `${cls.replace(/_/g, " ")}${ms?.confirmationCandleType ? ` · ${ms.confirmationCandleType}` : ""}`,
      state: dir.includes("BULL") ? "bullish" : dir.includes("BEAR") ? "bearish" : "neutral",
      meaning: `Latest confirmation class is ${cls.replace(/_/g, " ").toLowerCase()}.`,
      why: "Confirms whether a trigger is holding after the event.",
      supports: dir.includes("BULL")
        ? "Supports bullish conditions when trigger is valid."
        : dir.includes("BEAR")
          ? "Supports bearish conditions when trigger is valid."
          : "Neutral — wait for clearer confirmation."
    };
  };

  const mkTrend = (label: string | null | undefined, source: string): ResearchCell => {
    if (!label) return unavailableCell("Trend");
    return {
      value: biasLabel(label),
      state: biasState(label),
      meaning: `${source}: ${biasLabel(label)}.`,
      why: "Trend frames which scenario deserves priority.",
      supports:
        biasState(label) === "bullish"
          ? "Supports buys when trigger and confirmation align."
          : biasState(label) === "bearish"
            ? "Supports sells when trigger and confirmation align."
            : "Supports no-trade / prepare until direction clarifies."
    };
  };

  const structureCell = (): ResearchCell => {
    if (!structureItem?.complete && plan.freshness.marketStructureMode !== "COMPLETE") {
      return {
        value:
          plan.freshness.marketStructureMode === "LIVE_RANGE_ONLY"
            ? "Live range only"
            : plan.freshness.marketStructureMode === "MISMATCH"
              ? "Mismatch"
              : "Unavailable",
        state:
          plan.freshness.marketStructureMode === "MISMATCH" ? "bearish" : "unavailable",
        meaning: structureItem?.detail || "Verified structure is incomplete.",
        why: "Without verified structure, levels and plans are limited.",
        supports: "No-trade / prepare until structure is verified."
      };
    }
    return {
      value: marketTypeLabel(plan.marketType),
      state:
        plan.marketType === "TREND" || plan.marketType === "BREAKOUT"
          ? biasState(plan.directionBias)
          : plan.marketType === "PULLBACK"
            ? "waiting"
            : "neutral",
      meaning: `Market type ${marketTypeLabel(plan.marketType)} with ${biasLabel(plan.directionBias)} bias.`,
      why: "Structure describes how price is organising around value.",
      supports:
        plan.action === "NO_TRADE"
          ? "Supports no-trade."
          : "Use with trigger and confirmation — not as an order ticket."
    };
  };

  const momentumCell = (): ResearchCell => {
    if (momentumComp) {
      const pct = Math.round((momentumComp.score / Math.max(momentumComp.max, 1)) * 100);
      return {
        value: pct >= 66 ? "Strong" : pct >= 40 ? "Neutral" : "Soft",
        state: pct >= 66 ? "bullish" : pct >= 40 ? "neutral" : "waiting",
        meaning: momentumComp.reason || `Momentum score ${momentumComp.score}/${momentumComp.max}.`,
        why: "Momentum shows whether moves are likely to follow through.",
        supports: pct >= 66 ? "Supports following confirmed direction." : "Avoid chasing weak momentum."
      };
    }
    const strength = ms?.trendStrength;
    if (strength != null && Number.isFinite(strength)) {
      return {
        value: strength >= 0.66 ? "Strong" : strength >= 0.4 ? "Neutral" : "Soft",
        state: strength >= 0.66 ? biasState(ms?.trend || plan.directionBias) : "neutral",
        meaning: `Trend strength reading ${strength}.`,
        why: "Strength helps judge whether pullbacks are buyable.",
        supports: "Combine with confirmation — strength alone is not a trade."
      };
    }
    return unavailableCell("Momentum");
  };

  const volumeCell = (): ResearchCell => {
    if (volumeComp) {
      const pct = Math.round((volumeComp.score / Math.max(volumeComp.max, 1)) * 100);
      return {
        value: pct >= 66 ? "Rising" : pct >= 40 ? "Normal" : "Low",
        state: pct >= 66 ? "forming" : pct >= 40 ? "neutral" : "waiting",
        meaning: volumeComp.reason || `Volume score ${volumeComp.score}/${volumeComp.max}.`,
        why: "Volume support validates breakouts and reclaims.",
        supports: pct < 40 ? "Low volume — wait for participation." : "Volume participates with the idea."
      };
    }
    if (decision?.ohlcv?.volume != null) {
      return {
        value: "Present",
        state: "neutral",
        meaning: `Bar volume ${decision.ohlcv.volume}.`,
        why: "A volume print is present on the latest bar.",
        supports: "Use with relative context when available."
      };
    }
    return unavailableCell("Volume");
  };

  const rows: ResearchRow[] = [];

  // 1H — only when higherTimeframeBias or signal timeframe is 60/1H
  const has1h = Boolean(htf) || signalTf === "60" || signalTf === "1H" || signalTf === "60M";
  rows.push({
    tf: "1H",
    cells: {
      Trend: has1h
        ? mkTrend(htf ?? (signalTf === "60" || signalTf === "1H" ? ms?.trend : null), "Higher timeframe")
        : unavailableCell("1H trend"),
      Structure: has1h ? structureCell() : unavailableCell("1H structure"),
      Momentum: has1h ? momentumCell() : unavailableCell("1H momentum"),
      Volume: has1h ? volumeCell() : unavailableCell("1H volume"),
      Confirmation: has1h ? confirmationCell() : unavailableCell("1H confirmation"),
      "Position vs value": has1h ? positionCell() : unavailableCell("1H position")
    }
  });

  const is15 = signalTf === "15" || signalTf === "15M";
  rows.push({
    tf: "15M",
    cells: {
      Trend: mkTrend(is15 ? ms?.trend ?? plan.directionBias : plan.directionBias, "Plan / signal bias"),
      Structure: structureCell(),
      Momentum: momentumCell(),
      Volume: volumeCell(),
      Confirmation: confirmationCell(),
      "Position vs value": positionCell()
    }
  });

  const is5 = signalTf === "5" || signalTf === "5M" || !signalTf;
  rows.push({
    tf: "5M",
    cells: {
      Trend: mkTrend(is5 ? ms?.trend ?? plan.directionBias : plan.directionBias, "Active research bias"),
      Structure: {
        value: plan.marketType === "RANGE" ? "Range" : marketTypeLabel(plan.marketType),
        state: plan.setupProgress.items.find((i) => i.id === "confirmation")?.complete
          ? biasState(plan.directionBias)
          : "forming",
        meaning: "Lower-timeframe structure used for trigger timing.",
        why: "5M timing decides whether a level is holding now.",
        supports: plan.action.includes("NOW")
          ? "Trigger window is active — still analysis only."
          : "Trigger forming / waiting."
      },
      Momentum: momentumCell(),
      Volume: volumeCell(),
      Confirmation: confirmationCell(),
      "Position vs value": positionCell()
    }
  });

  // Optional 1M quote row — only price freshness / quote, never fabricated indicators
  if (plan.freshness.quoteAgeSeconds != null || decision?.lastKnownPrice != null) {
    rows.push({
      tf: "1M",
      cells: {
        Trend: unavailableCell("1M trend"),
        Structure: unavailableCell("1M structure"),
        Momentum: unavailableCell("1M momentum"),
        Volume: unavailableCell("1M volume"),
        Confirmation: {
          value: "Quote only",
          state: "neutral",
          meaning: "One-minute row is a live quote checkpoint, not a full strategy signal.",
          why: "Keeps the cockpit honest about what is verified.",
          supports: "Do not trade from quote-only rows."
        },
        "Position vs value": positionCell()
      }
    });
  }

  return rows;
}

/** Build indicator chips only for verified available values. */
export function buildIndicatorChips(args: {
  plan: IntradayPlan;
  decision: Decision | null;
  poc: number | null;
  vah: number | null;
  val: number | null;
  atrLabel?: string | null;
  atrValue?: number | null;
  scoreComponents?: Array<{ label: string; score: number; max: number; reason: string }> | null;
}): IndicatorChip[] {
  const chips: IndicatorChip[] = [];
  const price = args.decision?.lastKnownPrice ?? args.plan.expectedRange.currentPrice;
  const pushLevel = (
    id: string,
    label: string,
    value: number | null,
    explanation: string
  ) => {
    if (value == null || !Number.isFinite(value)) return;
    let state: IndicatorChip["state"] = "neutral";
    if (price != null) {
      if (id === "val") state = price < value ? "neutral" : "bullish";
      else if (id === "vah") state = price > value ? "neutral" : "bearish";
      else if (id === "poc") {
        state =
          Math.abs(price - value) < 1 ? "neutral" : price > value ? "bullish" : "bearish";
      }
    }
    chips.push({
      id,
      label,
      value: value.toFixed(2),
      state,
      tooltip: explanation,
      explanation
    });
  };

  pushLevel("poc", "POC", args.poc, "POC — highest-accepted volume price in the value area.");
  pushLevel("vah", "VAH", args.vah, "VAH — top of the accepted value area (resistance context).");
  pushLevel("val", "VAL", args.val, "VAL — bottom of the accepted value area (reclaim / support context).");

  // VWAP / EMAs only when present as level reason codes with prices on important levels
  const reasonMap: Record<string, { label: string; explanation: string }> = {
    VWAP: { label: "VWAP", explanation: "VWAP — session average price weighted by volume." },
    EMA_21: { label: "EMA 21", explanation: "EMA 21 — short trend average from verified structure reasons." },
    EMA_50: { label: "EMA 50", explanation: "EMA 50 — medium trend average from verified structure reasons." },
    EMA_200: { label: "EMA 200", explanation: "EMA 200 — long trend average from verified structure reasons." }
  };
  for (const level of args.plan.importantLevels) {
    for (const reason of level.reasons) {
      const meta = reasonMap[reason.code];
      if (!meta || chips.some((c) => c.id === reason.code.toLowerCase())) continue;
      if (level.price == null) continue;
      chips.push({
        id: reason.code.toLowerCase(),
        label: meta.label,
        value: level.price.toFixed(2),
        state: "neutral",
        tooltip: reason.explanation || meta.explanation,
        explanation: reason.explanation || meta.explanation
      });
    }
  }

  // RSI / ADX from score component labels/reasons when explicitly present
  for (const comp of args.scoreComponents ?? []) {
    const rsiMatch = comp.reason.match(/\bRSI\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
    if (rsiMatch && !chips.some((c) => c.id === "rsi")) {
      const rsi = Number(rsiMatch[1]);
      chips.push({
        id: "rsi",
        label: "RSI",
        value: String(rsi),
        state: rsi >= 60 ? "bullish" : rsi <= 40 ? "bearish" : "neutral",
        tooltip: rsi >= 55 ? "Neutral-to-bullish momentum" : rsi <= 45 ? "Neutral-to-bearish momentum" : "Balanced momentum",
        explanation: comp.reason
      });
    }
    const adxMatch = comp.reason.match(/\bADX\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
    if (adxMatch && !chips.some((c) => c.id === "adx")) {
      const adx = Number(adxMatch[1]);
      chips.push({
        id: "adx",
        label: "ADX",
        value: String(adx),
        state: adx < 20 ? "neutral" : "bullish",
        tooltip: adx < 20 ? "Weak trend — avoid chasing" : "Trend strength present",
        explanation: comp.reason
      });
    }
    if (/relative volume|rvol/i.test(comp.label + comp.reason) && !chips.some((c) => c.id === "rvol")) {
      chips.push({
        id: "rvol",
        label: "Relative Volume",
        value: `${comp.score}/${comp.max}`,
        state: comp.score / Math.max(comp.max, 1) >= 0.6 ? "bullish" : "neutral",
        tooltip: "Participation versus recent norms",
        explanation: comp.reason
      });
    }
  }

  if (args.atrValue != null || args.atrLabel) {
    chips.push({
      id: "atr",
      label: "ATR",
      value: args.atrValue != null ? args.atrValue.toFixed(2) : String(args.atrLabel),
      state: "neutral",
      tooltip: "Average true range — typical swing size",
      explanation: "ATR sizes expected movement. It is not a trade signal."
    });
  }

  const conf = args.decision?.marketStructure?.confirmationClassification;
  if (conf && conf !== "NONE") {
    const dir = (args.decision?.marketStructure?.confirmationDirection || "").toUpperCase();
    chips.push({
      id: "confirm-candle",
      label: "Confirmation Candle",
      value: conf.replace(/_/g, " "),
      state: dir.includes("BULL") ? "bullish" : dir.includes("BEAR") ? "bearish" : "neutral",
      tooltip: args.decision?.marketStructure?.confirmationCandleType || "Verified confirmation class",
      explanation: `Confirmation ${conf.replace(/_/g, " ")}${
        args.decision?.marketStructure?.confirmationCandleType
          ? ` (${args.decision.marketStructure.confirmationCandleType})`
          : ""
      }.`
    });
  }

  return chips;
}

export const PAGE_EXPLAINERS: Array<{ title: string; body: string }> = [
  {
    title: "What PREPARE means",
    body: "A setup is forming. GoldMeta is not calling a buy or sell yet — wait for the trigger and confirmation."
  },
  {
    title: "What a trigger means",
    body: "The price event that must happen first (for example a reclaim above a level) before the idea becomes valid."
  },
  {
    title: "What confirmation means",
    body: "Extra proof after the trigger — usually a candle close that holds the level — so you are not reacting to a fake spike."
  },
  {
    title: "What invalidation means",
    body: "The condition that cancels the idea. If price does that, step aside and re-check the research."
  },
  {
    title: "Why scenarios are not orders",
    body: "Bullish and bearish cards are conditional research plans. They are never active broker tickets."
  },
  {
    title: "POC, VAH and VAL",
    body: "POC is the most accepted price. VAH is the top of value. VAL is the bottom of value. Together they frame fair value for the session."
  }
];
