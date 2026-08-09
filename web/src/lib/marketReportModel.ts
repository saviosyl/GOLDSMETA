/**
 * Premium GoldMeta Market Report model — built only from verified dashboard fields.
 * Never fabricates candles, levels, plans, score parts, or MTF states.
 */

import { biasLabel as formatBiasLabel } from "./intradayFormat";
import { checklistMark } from "./planDisplay";
import { formatSession, plainLanguageReason } from "./plainLanguage";
import {
  classifyOverallScore,
  classifyScoreComponent,
  sortScoreComponents
} from "./scoreStatus";
import type { PromoSnapshotModel, SnapshotPlan } from "./promoSnapshot";

export type ReportDecision = "BUY" | "SELL" | "WAIT";

export type ReportCandle = {
  open: number;
  high: number;
  low: number;
  close: number;
};

export type ReportStructureLevel = {
  kind: "resistance" | "current" | "support" | "poc" | "vah" | "val";
  label: string;
  price: number;
  delta: number | null;
};

export type ReportStoryCard = {
  id: string;
  title: string;
  value: string;
  detail: string;
  icon: "trend" | "value" | "structure" | "volatility" | "confirmation" | "session" | "risk" | "targets";
};

export type ReportWhyItem = {
  state: "pass" | "pending" | "fail";
  text: string;
};

export type ReportReadinessRow = {
  label: string;
  status: "READY" | "WAITING" | "FAIL";
};

export type ReportTimeframe = {
  tf: string;
  direction: string;
  tone: "buy" | "sell" | "wait" | "info";
};

export type ReportScenario = {
  title: string;
  trigger: string;
  outcome: string;
  tone: "buy" | "sell";
};

export type ReportKeyLevel = {
  label: string;
  price: number;
  tone: "resistance" | "support" | "live" | "poc" | "vah" | "val";
  caption?: string | null;
};

export type ReportChartOverlay = {
  price: number;
  label: string;
  tone: "live" | "resistance" | "support" | "poc" | "plan";
};

/** Optional verified context from IntradayPlan / briefing — omit when unavailable. */
export type MarketReportContext = {
  directionBias?: string | null;
  marketType?: string | null;
  oneSentence?: string | null;
  whyNotReady?: string | null;
  actionLabel?: string | null;
  nearestSupport?: number | null;
  nearestResistance?: number | null;
  setupItems?: Array<{
    id: string;
    label: string;
    complete: boolean;
    detail: string;
    mark?: "pass" | "pending" | "fail";
  }>;
  confirmationLabel?: string | null;
  confirmationMeaningful?: boolean | null;
  timeframes?: Array<{ timeframe: string; direction: string; tone?: string | null }> | null;
  atrLabel?: string | null;
  atrValue?: number | null;
  positionVsPoc?: string | null;
  regime?: string | null;
  reasonCodes?: string[];
  bullishScenario?: { label?: string | null; trigger?: string | null } | null;
  bearishScenario?: { label?: string | null; trigger?: string | null } | null;
  tradePlanActionable?: boolean | null;
  tradePlanDirection?: string | null;
  tradePlanEntry?: number | null;
  tradePlanStop?: number | null;
  tradePlanTp1?: number | null;
  tradePlanTp2?: number | null;
  tradePlanTp3?: number | null;
  tradePlanRR?: number | string | null;
  marketStatus?: "OPEN" | "CLOSED" | "UNKNOWN" | null;
  candles?: ReportCandle[] | null;
  chartTimeframe?: string | null;
  localCityLabel?: string | null;
  secondaryCityLabel?: string | null;
  localClock?: string | null;
  secondaryClock?: string | null;
  poc?: number | null;
  vah?: number | null;
  val?: number | null;
};

export type MarketReportModel = {
  symbol: "XAUUSD";
  assetLabel: "GOLD";
  marketStatus: string | null;
  sessionLabel: string;
  localTimeLine: string | null;
  secondaryTimeLine: string | null;
  generatedLabel: string;
  decision: ReportDecision;
  decisionSubtext: string;
  scoreTotal: number | null;
  scoreDescriptor: string;
  biasLabel: string;
  biasPosition: number;
  livePrice: number | null;
  candles: ReportCandle[] | null;
  chartTimeframe: string | null;
  chartOverlays: ReportChartOverlay[];
  structureLevels: ReportStructureLevel[];
  storyCards: ReportStoryCard[];
  whyTitle: string;
  whyItems: ReportWhyItem[];
  nextTrigger: string | null;
  planReadiness: ReportReadinessRow[] | null;
  planReadinessOverall: string | null;
  tradePlan: SnapshotPlan | null;
  planWaitingMessage: string | null;
  timeframes: ReportTimeframe[] | null;
  volatility: { caption: string; position: number } | null;
  sessions: Array<{ id: string; label: string; active: boolean }>;
  scenarios: ReportScenario[];
  keyLevels: ReportKeyLevel[];
};

function normalizeDecision(raw: string): ReportDecision {
  const d = (raw || "WAIT").toUpperCase();
  if (d === "BUY" || d.startsWith("BUY")) return "BUY";
  if (d === "SELL" || d.startsWith("SELL")) return "SELL";
  return "WAIT";
}

function scoreDescriptor(total: number | null): string {
  if (total == null || !Number.isFinite(total)) return "Unavailable";
  if (total < 40) return "Weak";
  if (total < 60) return "Developing";
  if (total < 80) return "Good";
  return "Strong";
}

function biasFromContext(
  decision: ReportDecision,
  ctx: MarketReportContext | null | undefined
): { label: string; position: number } {
  const raw = (ctx?.directionBias ?? "").toUpperCase();
  if (raw) {
    const label = formatBiasLabel(raw);
    if (raw === "BULLISH") return { label, position: 0.86 };
    if (raw === "SLIGHTLY_BULLISH") return { label, position: 0.68 };
    if (raw === "SLIGHTLY_BEARISH") return { label, position: 0.32 };
    if (raw === "BEARISH") return { label, position: 0.14 };
    return { label: label || "Mixed", position: 0.5 };
  }
  if (decision === "BUY") return { label: "Bullish lean", position: 0.72 };
  if (decision === "SELL") return { label: "Bearish lean", position: 0.28 };
  const regime = (ctx?.regime ?? "").toUpperCase();
  if (regime.includes("BULL")) return { label: "Bullish lean", position: 0.66 };
  if (regime.includes("BEAR")) return { label: "Bearish lean", position: 0.34 };
  return { label: "Mixed", position: 0.5 };
}

function humanSetupLabel(item: { id: string; label: string }): string {
  const id = item.id.toLowerCase();
  if (id.includes("structure")) return "Structure";
  if (id.includes("confirm")) return "Confirmation";
  if (id.includes("plan") || id.includes("entry")) return "Entry";
  if (id.includes("bias") || id.includes("trend")) return "Trend";
  if (id.includes("fresh") || id.includes("quote")) return "Quote";
  if (id.includes("align")) return "Alignment";
  const cleaned = item.label
    .replace(/\(.*?\)/g, "")
    .replace(/complete market structure.*/i, "Structure")
    .replace(/entry confirmation.*/i, "Confirmation")
    .replace(/entry \/ stop.*/i, "Entry")
    .replace(/directional bias.*/i, "Trend")
    .replace(/fresh live.*/i, "Quote")
    .replace(/price sources.*/i, "Alignment")
    .trim();
  return cleaned.length > 18 ? cleaned.slice(0, 16) + "…" : cleaned || "Condition";
}

function valueCardText(ctx: MarketReportContext | null | undefined, live: number | null): string {
  const pos = (ctx?.positionVsPoc ?? "").toUpperCase();
  if (pos.includes("ABOVE")) return "Above session POC";
  if (pos.includes("BELOW")) return "Below session POC";
  if (pos.includes("AT") || pos.includes("NEAR") || pos.includes("INSIDE")) return "Near session POC";
  if (live != null && ctx?.poc != null) {
    if (live > ctx.poc) return "Above session POC";
    if (live < ctx.poc) return "Below session POC";
    return "At session POC";
  }
  return "Value context forming";
}

function structureCardText(
  decision: ReportDecision,
  ctx: MarketReportContext | null | undefined
): string {
  const items = ctx?.setupItems ?? [];
  const structure = items.find((i) => i.id.includes("structure"));
  if (structure) {
    const mark = checklistMark(structure);
    if (mark === "pass") return "Structure verified";
    return "Incomplete";
  }
  if (decision === "WAIT") return "Incomplete";
  return "Confirmed";
}

function volatilityCardText(ctx: MarketReportContext | null | undefined): string {
  const atr = (ctx?.atrLabel ?? "").toUpperCase();
  if (!atr) return "Unavailable";
  if (atr.includes("LOW") || atr.includes("BELOW")) return "Below preferred";
  if (atr.includes("HIGH") || atr.includes("ELEVATED")) return "Elevated";
  if (atr.includes("NORMAL") || atr.includes("OK") || atr.includes("WITHIN")) return "Normal";
  return atr.charAt(0) + atr.slice(1).toLowerCase();
}

function volatilityMeter(ctx: MarketReportContext | null | undefined): {
  caption: string;
  position: number;
} | null {
  const atr = (ctx?.atrLabel ?? "").toUpperCase();
  if (!atr) return null;
  if (atr.includes("LOW") || atr.includes("BELOW")) {
    return { caption: "Below preferred level", position: 0.22 };
  }
  if (atr.includes("HIGH") || atr.includes("ELEVATED")) {
    return { caption: "Elevated", position: 0.82 };
  }
  return { caption: "Normal", position: 0.5 };
}

function activeSessionId(sessionLabel: string): "asia" | "london" | "newyork" {
  const s = sessionLabel.toLowerCase();
  if (s.includes("asia") || s.includes("tokyo") || s.includes("sydney")) return "asia";
  if (s.includes("london") && s.includes("new")) return "newyork";
  if (s.includes("london")) return "london";
  if (s.includes("new york") || s.includes("newyork") || s.includes("ny")) return "newyork";
  return "london";
}

function buildStructureLevels(
  livePrice: number | null,
  ctx: MarketReportContext | null | undefined,
  snapshotLevels: PromoSnapshotModel["levels"]
): ReportStructureLevel[] {
  const levels: ReportStructureLevel[] = [];
  const res = ctx?.nearestResistance ?? null;
  const sup = ctx?.nearestSupport ?? null;
  const push = (
    kind: ReportStructureLevel["kind"],
    label: string,
    price: number | null | undefined
  ) => {
    if (price == null || !Number.isFinite(price)) return;
    levels.push({
      kind,
      label,
      price,
      delta: livePrice != null ? Math.round((price - livePrice) * 100) / 100 : null
    });
  };

  push("resistance", "Resistance", res);
  if (ctx?.vah != null && ctx.vah !== res) push("vah", "VAH", ctx.vah);
  push("current", "Current", livePrice);
  if (ctx?.poc != null) push("poc", "POC", ctx.poc);
  if (ctx?.val != null && ctx.val !== sup) push("val", "VAL", ctx.val);
  push("support", "Support", sup);

  if (levels.length <= 1) {
    for (const lvl of snapshotLevels) {
      if (lvl.isLive) push("current", "Current", lvl.price);
      else if (lvl.isNearestRes) push("resistance", "Resistance", lvl.price);
      else if (lvl.isNearestSup) push("support", "Support", lvl.price);
      else if (/POC/i.test(lvl.classification)) push("poc", "POC", lvl.price);
      else if (/VAH/i.test(lvl.classification)) push("vah", "VAH", lvl.price);
      else if (/VAL/i.test(lvl.classification)) push("val", "VAL", lvl.price);
    }
  }

  // Unique by kind+price, keep visual order high→low
  const seen = new Set<string>();
  return levels
    .filter((l) => {
      const key = `${l.kind}:${l.price}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.price - a.price);
}

function buildStoryCards(
  decision: ReportDecision,
  ctx: MarketReportContext | null | undefined,
  livePrice: number | null
): ReportStoryCard[] {
  const trend =
    decision === "BUY"
      ? "Supportive"
      : decision === "SELL"
        ? "Pressuring"
        : (ctx?.directionBias ?? "").toUpperCase().includes("BULL")
          ? "Supportive"
          : (ctx?.directionBias ?? "").toUpperCase().includes("BEAR")
            ? "Pressuring"
            : (ctx?.regime ?? "").toUpperCase().includes("RANGE")
              ? "Range-bound"
              : "Mixed";

  const value = valueCardText(ctx, livePrice);
  const structure = structureCardText(decision, ctx);
  const vol = volatilityCardText(ctx);
  const cards: ReportStoryCard[] = [
    {
      id: "trend",
      title: "Trend",
      value: trend,
      detail:
        trend === "Supportive"
          ? "Price holds above key trend levels"
          : trend === "Pressuring"
            ? "Sellers pressure key trend levels"
            : trend === "Range-bound"
              ? "No clear directional expansion"
              : "Directional context is mixed",
      icon: "trend"
    },
    {
      id: "value",
      title: "Value",
      value,
      detail: value.toLowerCase().includes("above")
        ? "Trading above session value"
        : value.toLowerCase().includes("below")
          ? "Trading below session value"
          : "Near session value area",
      icon: "value"
    },
    {
      id: "structure",
      title: "Structure",
      value: structure,
      detail:
        structure === "Incomplete"
          ? "Confirmation still required"
          : structure === "Structure verified"
            ? "Verified structure in place"
            : "Structure context forming",
      icon: "structure"
    },
    {
      id: "volatility",
      title: "Volatility",
      value: vol,
      detail:
        vol === "Below preferred"
          ? "Expansion not yet preferred"
          : vol === "Elevated"
            ? "Range expansion elevated"
            : vol === "Normal"
              ? "Within preferred band"
              : "Volatility context unavailable",
      icon: "volatility"
    }
  ];
  return cards.filter((c) => c.value !== "Unavailable" || c.id !== "volatility");
}

function buildWhy(
  decision: ReportDecision,
  ctx: MarketReportContext | null | undefined,
  components: PromoSnapshotModel["scoreComponents"]
): { title: string; items: ReportWhyItem[]; nextTrigger: string | null } {
  const title =
    decision === "BUY" ? "WHY BUY?" : decision === "SELL" ? "WHY SELL?" : "WHY WAIT?";

  const items: ReportWhyItem[] = [];
  const setup = ctx?.setupItems ?? [];

  if (setup.length) {
    const preferred = ["bias", "structure", "confirmation", "plan", "fresh-quote", "alignment"];
    const ordered = [...setup].sort((a, b) => {
      const ai = preferred.findIndex((p) => a.id.includes(p));
      const bi = preferred.findIndex((p) => b.id.includes(p));
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    for (const item of ordered.slice(0, 4)) {
      const mark = checklistMark(item);
      const label = humanSetupLabel(item);
      let text: string;
      if (mark === "pass") {
        text =
          decision === "WAIT"
            ? label === "Trend"
              ? "Trend remains supportive"
              : label === "Structure"
                ? "Price structure remains supportive"
                : `${label} supportive`
            : `${label} aligned`;
      } else if (mark === "fail") {
        text = `${label} failed`;
      } else if (label === "Confirmation") {
        text = "Structure confirmation missing";
      } else if (label === "Entry") {
        text = "Entry trigger not confirmed";
      } else {
        text = `${label} waiting`;
      }
      items.push({
        state: mark === "pass" ? "pass" : mark === "fail" ? "fail" : "pending",
        text
      });
    }
  } else if (components?.length) {
    for (const c of sortScoreComponents(components).slice(0, 4)) {
      const st = classifyScoreComponent(c.score, c.max);
      items.push({
        state: st.status === "strong" ? "pass" : st.status === "weak" ? "fail" : "pending",
        text:
          st.status === "strong"
            ? `${c.label} supportive`
            : st.status === "weak"
              ? `${c.label} incomplete`
              : `${c.label} developing`
      });
    }
  }

  if (!items.length) {
    const reason = plainLanguageReason(ctx?.reasonCodes, ctx?.whyNotReady ?? undefined);
    items.push({
      state: decision === "WAIT" ? "pending" : "pass",
      text: reason
    });
  }

  let nextTrigger: string | null = null;
  if (decision === "WAIT") {
    nextTrigger =
      ctx?.whyNotReady?.replace(/^Price is /i, "Price ") ??
      "Market structure + confirmation";
    if (nextTrigger.length > 90) {
      nextTrigger = "Market structure + confirmation";
    }
  } else if (ctx?.confirmationLabel) {
    nextTrigger = ctx.confirmationLabel;
  }

  return { title, items: items.slice(0, 4), nextTrigger };
}

function buildPlanReadiness(
  decision: ReportDecision,
  ctx: MarketReportContext | null | undefined
): { rows: ReportReadinessRow[]; overall: string } | null {
  if (decision !== "WAIT") return null;
  const setup = ctx?.setupItems ?? [];
  const mapId = (id: string): string | null => {
    if (id.includes("bias") || id.includes("trend")) return "Trend";
    if (id.includes("structure")) return "Structure";
    if (id.includes("confirm")) return "Confirmation";
    if (id.includes("plan") || id.includes("entry")) return "Entry";
    return null;
  };

  const rows: ReportReadinessRow[] = [];
  const wanted: Array<{ key: string; label: string }> = [
    { key: "Trend", label: "Trend" },
    { key: "Structure", label: "Structure" },
    { key: "Confirmation", label: "Confirmation" },
    { key: "Entry", label: "Entry Trigger" }
  ];
  for (const row of wanted) {
    const item = setup.find((s) => mapId(s.id) === row.key);
    if (!item) {
      rows.push({ label: row.label, status: "WAITING" });
      continue;
    }
    const mark = checklistMark(item);
    rows.push({
      label: row.label,
      status: mark === "pass" ? "READY" : mark === "fail" ? "FAIL" : "WAITING"
    });
  }

  const readyCount = rows.filter((r) => r.status === "READY").length;
  const overall = readyCount === rows.length ? "READY" : "NOT READY";
  return { rows, overall };
}

function buildTradePlan(
  decision: ReportDecision,
  snapshotPlan: SnapshotPlan | null,
  ctx: MarketReportContext | null | undefined
): { plan: SnapshotPlan | null; waiting: string | null } {
  if (decision === "WAIT") {
    return { plan: null, waiting: null };
  }

  if (
    ctx?.tradePlanActionable &&
    (ctx.tradePlanEntry != null || ctx.tradePlanStop != null || ctx.tradePlanTp1 != null)
  ) {
    const entry = ctx.tradePlanEntry ?? null;
    const stop = ctx.tradePlanStop ?? null;
    const tp1 = ctx.tradePlanTp1 ?? null;
    let rr: number | null = null;
    if (typeof ctx.tradePlanRR === "number") rr = ctx.tradePlanRR;
    else if (entry != null && stop != null && tp1 != null) {
      const risk = Math.abs(entry - stop);
      if (risk > 1e-6) rr = Math.round((Math.abs(tp1 - entry) / risk) * 100) / 100;
    }
    return {
      plan: {
        direction: (ctx.tradePlanDirection ?? decision).toString(),
        entry,
        stopLoss: stop,
        tp1,
        tp2: ctx.tradePlanTp2 ?? null,
        tp3: ctx.tradePlanTp3 ?? null,
        riskReward: rr,
        status: ctx.confirmationMeaningful ? "Confirmed" : "Validated"
      },
      waiting: null
    };
  }

  if (snapshotPlan) {
    return { plan: snapshotPlan, waiting: null };
  }

  return { plan: null, waiting: "WAITING FOR VALID SETUP" };
}

function buildTimeframes(
  ctx: MarketReportContext | null | undefined
): ReportTimeframe[] | null {
  const cells = ctx?.timeframes;
  if (!cells?.length) return null;
  const mapped = cells
    .filter((c) => c.timeframe && c.direction)
    .map((c) => {
      const toneRaw = (c.tone ?? "").toLowerCase();
      const tone: ReportTimeframe["tone"] =
        toneRaw === "buy" || toneRaw === "sell" || toneRaw === "wait"
          ? toneRaw
          : /bull|buy/i.test(c.direction)
            ? "buy"
            : /bear|sell/i.test(c.direction)
              ? "sell"
              : "info";
      return {
        tf: c.timeframe.replace(/^M/, "").toUpperCase().replace("H", "H"),
        direction: c.direction.replace(/_/g, " "),
        tone
      };
    });
  return mapped.length ? mapped.slice(0, 4) : null;
}

function buildScenarios(
  decision: ReportDecision,
  ctx: MarketReportContext | null | undefined,
  structure: ReportStructureLevel[]
): ReportScenario[] {
  const res = structure.find((l) => l.kind === "resistance");
  const sup = structure.find((l) => l.kind === "support");
  const bullTrigger =
    ctx?.bullishScenario?.trigger ||
    (res ? `Break / confirm above ${res.price.toFixed(2)}` : null);
  const bearTrigger =
    ctx?.bearishScenario?.trigger ||
    (sup ? `Loss of support at ${sup.price.toFixed(2)}` : null);

  const scenarios: ReportScenario[] = [];
  if (bullTrigger) {
    scenarios.push({
      title: "Bullish scenario",
      trigger: bullTrigger,
      outcome:
        decision === "BUY"
          ? "GoldMeta manages the active BUY plan"
          : "GoldMeta reassesses for BUY",
      tone: "buy"
    });
  }
  if (bearTrigger) {
    scenarios.push({
      title: "Bearish scenario",
      trigger: bearTrigger,
      outcome:
        decision === "SELL"
          ? "GoldMeta manages the active SELL plan"
          : "GoldMeta reassesses for SELL",
      tone: "sell"
    });
  }
  return scenarios;
}

function buildKeyLevels(
  structure: ReportStructureLevel[],
  livePrice: number | null,
  ctx: MarketReportContext | null | undefined
): ReportKeyLevel[] {
  const out: ReportKeyLevel[] = [];
  const poc = structure.find((l) => l.kind === "poc")?.price ?? ctx?.poc ?? null;
  for (const l of structure) {
    if (l.kind === "resistance")
      out.push({ label: "Resistance", price: l.price, tone: "resistance", caption: "Nearest resistance" });
    if (l.kind === "current" && livePrice != null) {
      let caption = "Live price";
      if (poc != null) {
        caption = livePrice > poc ? "Above POC" : livePrice < poc ? "Below POC" : "At POC";
      }
      out.push({ label: "Current", price: l.price, tone: "live", caption });
    }
    if (l.kind === "support")
      out.push({ label: "Support", price: l.price, tone: "support", caption: "Nearest support" });
    if (l.kind === "poc")
      out.push({ label: "POC", price: l.price, tone: "poc", caption: "Session point of control" });
    if (l.kind === "vah")
      out.push({ label: "VAH", price: l.price, tone: "vah", caption: "Value area high" });
    if (l.kind === "val")
      out.push({ label: "VAL", price: l.price, tone: "val", caption: "Value area low" });
  }
  const order = ["Resistance", "Current", "Support", "POC", "VAH", "VAL"];
  const uniq = new Map<string, ReportKeyLevel>();
  for (const k of out) {
    if (!uniq.has(k.label)) uniq.set(k.label, k);
  }
  return order.map((l) => uniq.get(l)).filter(Boolean) as ReportKeyLevel[];
}

function buildChartOverlays(
  livePrice: number | null,
  structure: ReportStructureLevel[],
  plan: SnapshotPlan | null
): ReportChartOverlay[] {
  const overlays: ReportChartOverlay[] = [];
  if (livePrice != null) overlays.push({ price: livePrice, label: "Price", tone: "live" });
  const res = structure.find((l) => l.kind === "resistance");
  const sup = structure.find((l) => l.kind === "support");
  const poc = structure.find((l) => l.kind === "poc");
  if (res) overlays.push({ price: res.price, label: "R", tone: "resistance" });
  if (sup) overlays.push({ price: sup.price, label: "S", tone: "support" });
  if (poc) overlays.push({ price: poc.price, label: "POC", tone: "poc" });
  if (plan?.entry != null) overlays.push({ price: plan.entry, label: "Entry", tone: "plan" });
  if (plan?.stopLoss != null) overlays.push({ price: plan.stopLoss, label: "SL", tone: "plan" });
  if (plan?.tp1 != null) overlays.push({ price: plan.tp1, label: "TP1", tone: "plan" });
  return overlays.slice(0, 6);
}

function decisionSubtext(
  decision: ReportDecision,
  ctx: MarketReportContext | null | undefined,
  overall: ReturnType<typeof classifyOverallScore>
): string {
  if (ctx?.oneSentence) {
    const s = ctx.oneSentence.replace(/\s*\(LABELLED.*?\)\s*/gi, "").trim();
    const sentence = s.split(/(?<=\.)\s+/)[0] ?? s;
    return sentence.length > 72 ? sentence.slice(0, 69) + "…" : sentence;
  }
  if (decision === "WAIT") return "No confirmed entry yet";
  if (decision === "BUY") return overall.label === "HIGH QUALITY" ? "Validated buy setup" : "Buy plan active";
  return overall.label === "HIGH QUALITY" ? "Validated sell setup" : "Sell plan active";
}

export function buildMarketReportModel(
  snapshot: PromoSnapshotModel,
  ctx?: MarketReportContext | null
): MarketReportModel {
  const decision = normalizeDecision(snapshot.decision);
  const bias = biasFromContext(decision, ctx);
  const sessionLabel =
    snapshot.sessionLabel && snapshot.sessionLabel !== "—"
      ? formatSession(snapshot.sessionLabel) === "—"
        ? snapshot.sessionLabel
        : formatSession(snapshot.sessionLabel) !== snapshot.sessionLabel
          ? formatSession(snapshot.sessionLabel)
          : snapshot.sessionLabel
      : "—";

  const structureLevels = buildStructureLevels(snapshot.livePrice, ctx, snapshot.levels);
  const why = buildWhy(decision, ctx, snapshot.scoreComponents);
  const readiness = buildPlanReadiness(decision, ctx);
  const trade = buildTradePlan(decision, snapshot.plan, ctx);
  const timeframes = buildTimeframes(ctx);
  const scenarios = buildScenarios(decision, ctx, structureLevels);
  const keyLevels = buildKeyLevels(structureLevels, snapshot.livePrice, ctx);
  const overall = classifyOverallScore(snapshot.scoreTotal);

  const marketStatus =
    ctx?.marketStatus === "OPEN"
      ? "MARKET OPEN"
      : ctx?.marketStatus === "CLOSED"
        ? "MARKET CLOSED"
        : null;

  const localCity = ctx?.localCityLabel ?? null;
  const localClock = ctx?.localClock ?? snapshot.compactTime;
  const secondaryCity = ctx?.secondaryCityLabel ?? null;
  const secondaryClock = ctx?.secondaryClock ?? null;

  const localTimeLine =
    localCity && localClock ? `${localCity} ${localClock}` : localClock ? localClock : null;
  const secondaryTimeLine =
    secondaryCity && secondaryClock ? `${secondaryCity} ${secondaryClock}` : null;

  const active = activeSessionId(sessionLabel);
  const sessions = [
    { id: "asia", label: "ASIA", active: active === "asia" },
    { id: "london", label: "LONDON", active: active === "london" },
    { id: "newyork", label: "NEW YORK", active: active === "newyork" }
  ];

  const candles =
    ctx?.candles && ctx.candles.length >= 8
      ? ctx.candles.slice(-40).filter(
          (c) =>
            Number.isFinite(c.open) &&
            Number.isFinite(c.high) &&
            Number.isFinite(c.low) &&
            Number.isFinite(c.close)
        )
      : null;

  return {
    symbol: "XAUUSD",
    assetLabel: "GOLD",
    marketStatus,
    sessionLabel: sessionLabel === "—" ? "Session —" : sessionLabel,
    localTimeLine,
    secondaryTimeLine,
    generatedLabel: snapshot.utcSecondary
      ? `Generated ${snapshot.utcSecondary}`
      : `Generated ${snapshot.compactTime}`,
    decision,
    decisionSubtext: decisionSubtext(decision, ctx, overall),
    scoreTotal: snapshot.scoreTotal,
    scoreDescriptor: scoreDescriptor(snapshot.scoreTotal),
    biasLabel: bias.label,
    biasPosition: bias.position,
    livePrice: snapshot.livePrice,
    candles: candles && candles.length >= 8 ? candles : null,
    chartTimeframe: candles ? ctx?.chartTimeframe ?? "15M" : null,
    chartOverlays: buildChartOverlays(snapshot.livePrice, structureLevels, trade.plan),
    structureLevels,
    storyCards: buildStoryCards(decision, ctx, snapshot.livePrice),
    whyTitle: why.title,
    whyItems: why.items,
    nextTrigger: why.nextTrigger,
    planReadiness: readiness?.rows ?? null,
    planReadinessOverall: readiness?.overall ?? null,
    tradePlan: trade.plan,
    planWaitingMessage: trade.waiting,
    timeframes,
    volatility: volatilityMeter(ctx),
    sessions,
    scenarios,
    keyLevels
  };
}
