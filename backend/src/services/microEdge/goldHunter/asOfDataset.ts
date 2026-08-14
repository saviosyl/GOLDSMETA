/**
 * Build as-of 1-second XAUUSD states without look-ahead.
 * Latest BID/ASK may carry forward only while each side remains within freshness.
 *
 * Microstructure for historical training is reconstructed from ticks in the
 * prior second (spotEventCount≈tick count, bid/ask updates, up/down mid ticks).
 * Live-only ProtoOASpotEvent metadata fields are NOT fabricated.
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

export type AsOfGridStats = {
  totalSeconds: number;
  validSeconds: number;
  staleGapSeconds: number;
  invalidSeconds: number;
  coveragePct: number;
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
): { rows: AsOfSecondRow[]; stats: AsOfGridStats } {
  const sideMax = opts?.sideFreshnessMs ?? GH_SIDE_FRESHNESS_MS;
  if (!ticksSorted.length) {
    return {
      rows: [],
      stats: {
        totalSeconds: 0,
        validSeconds: 0,
        staleGapSeconds: 0,
        invalidSeconds: 0,
        coveragePct: 0
      }
    };
  }

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
  let lastBid: number | null = null;
  let lastAsk: number | null = null;
  let lastMid: number | null = null;

  const rows: AsOfSecondRow[] = [];
  let staleGapSeconds = 0;
  let invalidSeconds = 0;
  let validSeconds = 0;

  for (let t = start; t <= end; t += 1000) {
    const micro = emptyMicrostructure();
    const intervalStart = t - 999;
    while (
      tickIdx < ticksSorted.length &&
      ticksSorted[tickIdx]!.timestampMs <= t
    ) {
      const tk = ticksSorted[tickIdx]!;
      if (tk.timestampMs >= intervalStart) {
        // Historical-reconstructible microstructure (not live spot metadata).
        micro.spotEventCount += 1;
        if (tk.side === "BID" && tk.price > 0) {
          micro.bidUpdateCount += 1;
          if (lastBid != null && tk.price !== lastBid) micro.bidPriceChangeCount += 1;
          lastBid = tk.price;
        }
        if (tk.side === "ASK" && tk.price > 0) {
          micro.askUpdateCount += 1;
          if (lastAsk != null && tk.price !== lastAsk) micro.askPriceChangeCount += 1;
          lastAsk = tk.price;
        }
        if (lastBid != null && lastAsk != null) {
          const mid = (lastBid + lastAsk) / 2;
          if (lastMid != null) {
            if (mid > lastMid) micro.upTickCount += 1;
            else if (mid < lastMid) micro.downTickCount += 1;
          }
          lastMid = mid;
        }
      }
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
      invalidSeconds += 1;
    } else if (ask < bid) {
      scorable = false;
      reason = "ask_lt_bid";
      invalidSeconds += 1;
    } else if (
      bidUpdatedMs == null ||
      askUpdatedMs == null ||
      t - bidUpdatedMs > sideMax ||
      t - askUpdatedMs > sideMax
    ) {
      scorable = false;
      reason = "DATA_GAP";
      staleGapSeconds += 1;
    } else {
      validSeconds += 1;
    }

    rows.push({
      timestampMs: t,
      bid: bid ?? 0,
      ask: ask ?? 0,
      bidUpdatedMs: bidUpdatedMs ?? 0,
      askUpdatedMs: askUpdatedMs ?? 0,
      scorable,
      reason,
      micro: opts?.microBySecond?.get(t) ?? micro
    });
  }

  const totalSeconds = rows.length;
  return {
    rows,
    stats: {
      totalSeconds,
      validSeconds,
      staleGapSeconds,
      invalidSeconds,
      coveragePct: totalSeconds ? (100 * validSeconds) / totalSeconds : 0
    }
  };
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
  // Monotonic pointer into ascending allQuotes — O(n) labeling, not O(n²).
  let quoteIdx = 0;

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

    while (
      quoteIdx < allQuotes.length &&
      allQuotes[quoteIdx]!.timestampMs <= sec.timestampMs
    ) {
      quoteIdx += 1;
    }
    const labels: Record<number, GhLabel> = {};
    let anyUnscorable = false;
    for (const h of GH_HORIZONS_SEC) {
      const lab = labelHorizon({
        horizonSec: h,
        entry: { timestampMs: sec.timestampMs, bid: sec.bid, ask: sec.ask },
        futureQuotes: allQuotes,
        fromIndex: quoteIdx,
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
