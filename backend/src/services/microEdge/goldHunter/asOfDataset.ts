/**
 * Build as-of 1-second XAUUSD states without look-ahead.
 * Latest BID/ASK may carry forward only while each side remains within freshness.
 */
import { GH_HORIZONS_SEC, GH_SIDE_FRESHNESS_MS } from "./config";
import { buildFeaturesAtSecond, type GhBarCtx, type GhSecondPoint } from "./features";
import { labelHorizon, type GhQuoteAt } from "./labels";
import { emptyMicrostructure } from "./microstructure";
import type { GhFeatureVector, GhLabel, GhMicrostructureInterval } from "./types";

export type RawTick = {
  timestampMs: number;
  side: "BID" | "ASK";
  price: number;
};

export type AsOfSecondRow = {
  timestampMs: number;
  bid: number;
  ask: number;
  bidUpdatedMs: number;
  askUpdatedMs: number;
  scorable: boolean;
  reason: string | null;
  micro: GhMicrostructureInterval;
};

/**
 * Construct second-level states from ticks. No future Bid/Ask for second t.
 */
export function buildAsOfSecondRows(
  ticksSorted: RawTick[],
  opts?: {
    fromMs?: number;
    toMs?: number;
    sideFreshnessMs?: number;
    microBySecond?: Map<number, GhMicrostructureInterval>;
  }
): AsOfSecondRow[] {
  const sideMax = opts?.sideFreshnessMs ?? GH_SIDE_FRESHNESS_MS;
  if (!ticksSorted.length) return [];

  const start =
    opts?.fromMs ??
    Math.floor(ticksSorted[0]!.timestampMs / 1000) * 1000;
  const end =
    opts?.toMs ??
    Math.floor(ticksSorted[ticksSorted.length - 1]!.timestampMs / 1000) * 1000;

  let bid: number | null = null;
  let ask: number | null = null;
  let bidUpdatedMs: number | null = null;
  let askUpdatedMs: number | null = null;
  let tickIdx = 0;

  const rows: AsOfSecondRow[] = [];
  for (let t = start; t <= end; t += 1000) {
    while (
      tickIdx < ticksSorted.length &&
      ticksSorted[tickIdx]!.timestampMs <= t
    ) {
      const tk = ticksSorted[tickIdx]!;
      if (tk.price > 0 && Number.isFinite(tk.price)) {
        if (tk.side === "BID") {
          bid = tk.price;
          bidUpdatedMs = tk.timestampMs;
        } else {
          ask = tk.price;
          askUpdatedMs = tk.timestampMs;
        }
      }
      tickIdx += 1;
    }

    let scorable = true;
    let reason: string | null = null;
    if (bid == null || ask == null) {
      scorable = false;
      reason = "missing_side";
    } else if (ask < bid) {
      scorable = false;
      reason = "ask_lt_bid";
    } else if (
      bidUpdatedMs == null ||
      askUpdatedMs == null ||
      t - bidUpdatedMs > sideMax ||
      t - askUpdatedMs > sideMax
    ) {
      scorable = false;
      reason = "DATA_GAP";
    }

    rows.push({
      timestampMs: t,
      bid: bid ?? 0,
      ask: ask ?? 0,
      bidUpdatedMs: bidUpdatedMs ?? 0,
      askUpdatedMs: askUpdatedMs ?? 0,
      scorable,
      reason,
      micro: opts?.microBySecond?.get(t) ?? emptyMicrostructure()
    });
  }
  return rows;
}

export type LabeledResearchRow = {
  timestampMs: number;
  features: GhFeatureVector;
  labels: Record<number, GhLabel>;
  quote: GhQuoteAt;
};

export function buildLabeledResearchRows(args: {
  seconds: AsOfSecondRow[];
  m1Bars?: GhBarCtx[];
  m5Bars?: GhBarCtx[];
  m15Bars?: GhBarCtx[];
  theta: number;
}): {
  rows: LabeledResearchRow[];
  unscorableFeatureRows: number;
  unscorableLabelRows: number;
  totalSeconds: number;
} {
  const m1 = args.m1Bars ?? [];
  const m5 = args.m5Bars ?? [];
  const m15 = args.m15Bars ?? [];
  const history: GhSecondPoint[] = [];
  const allQuotes: GhQuoteAt[] = args.seconds
    .filter((s) => s.scorable)
    .map((s) => ({ timestampMs: s.timestampMs, bid: s.bid, ask: s.ask }));

  const rows: LabeledResearchRow[] = [];
  let unscorableFeatureRows = 0;
  let unscorableLabelRows = 0;

  for (const sec of args.seconds) {
    if (!sec.scorable) {
      unscorableFeatureRows += 1;
      continue;
    }
    history.push({
      timestampMs: sec.timestampMs,
      bid: sec.bid,
      ask: sec.ask,
      bidUpdatedMs: sec.bidUpdatedMs,
      askUpdatedMs: sec.askUpdatedMs,
      micro: sec.micro
    });
    if (history.length > 120) history.shift();

    const features = buildFeaturesAtSecond({
      history,
      m1Bars: m1,
      m5Bars: m5,
      m15Bars: m15
    });
    if (!features) {
      unscorableFeatureRows += 1;
      continue;
    }

    const futureQuotes = allQuotes.filter((q) => q.timestampMs > sec.timestampMs);
    const labels: Record<number, GhLabel> = {};
    let anyUnscorable = false;
    for (const h of GH_HORIZONS_SEC) {
      const lab = labelHorizon({
        horizonSec: h,
        entry: { timestampMs: sec.timestampMs, bid: sec.bid, ask: sec.ask },
        futureQuotes,
        theta: args.theta
      });
      labels[h] = lab;
      if (lab.classLabel === "UNSCORABLE_DATA_GAP") anyUnscorable = true;
    }
    if (anyUnscorable) unscorableLabelRows += 1;

    rows.push({
      timestampMs: sec.timestampMs,
      features,
      labels,
      quote: { timestampMs: sec.timestampMs, bid: sec.bid, ask: sec.ask }
    });
  }

  return {
    rows,
    unscorableFeatureRows,
    unscorableLabelRows,
    totalSeconds: args.seconds.length
  };
}
