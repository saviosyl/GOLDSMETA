/**
 * Build V1.2 research rows with microstructure features + regime (past-only).
 * Memory-conscious: labels only every sampleStride seconds while history
 * advances every second (no future leakage).
 */
import {
  buildAsOfSecondRows,
  type RawTick
} from "../asOfDataset";
import { buildFeaturesAtSecond, type GhBarCtx, type GhSecondPoint } from "../features";
import { labelHorizon, type GhQuoteAt } from "../labels";
import { GH_HORIZONS_SEC } from "../config";
import { GH_FEATURE_KEYS } from "../types";
import {
  auditV12Features,
  featureVectorToV12Array,
  projectFeatures,
  v12FeatureKeyNames
} from "./microFeatures";
import type { V12Regime } from "./regimes";

export type V12ResearchRow = {
  timestampMs: number;
  bid: number;
  ask: number;
  spread: number;
  x: Float32Array;
  regime: V12Regime;
  velocity: number;
  spreadOverMedian: number;
  net5L: number;
  net5S: number;
  net15L: number;
  net15S: number;
  net30L: number;
  net30S: number;
  net60L: number;
  net60S: number;
  dataOk: boolean;
};

export function buildV12ResearchRows(args: {
  ticks: RawTick[];
  m1Bars: GhBarCtx[];
  m5Bars: GhBarCtx[];
  m15Bars: GhBarCtx[];
  fromMs: number;
  toMs: number;
  keptIndices?: number[];
  sampleStride?: number;
}): {
  rows: V12ResearchRow[];
  gridStats: ReturnType<typeof buildAsOfSecondRows>["stats"];
  keptIndices: number[];
  droppedKeys: string[];
  keyNames: string[];
} {
  const sampleStride = Math.max(
    1,
    args.sampleStride ??
      Number(process.env.GOLD_HUNTER_V12_SAMPLE_STRIDE ?? 3)
  );

  const sorted = args.ticks;
  sorted.sort((a, b) => a.timestampMs - b.timestampMs);

  const { rows: seconds, stats: gridStats } = buildAsOfSecondRows(sorted, {
    fromMs: args.fromMs,
    toMs: args.toMs
  });
  // Release raw ticks immediately — seconds grid is sufficient.
  sorted.length = 0;

  const allQuotes: GhQuoteAt[] = [];
  for (const s of seconds) {
    if (s.scorable) {
      allQuotes.push({ timestampMs: s.timestampMs, bid: s.bid, ask: s.ask });
    }
  }

  const history: GhSecondPoint[] = [];
  const rawX: number[][] = [];
  const meta: Array<{
    timestampMs: number;
    bid: number;
    ask: number;
    spread: number;
    regime: V12Regime;
    velocity: number;
    spreadOverMedian: number;
    net5L: number;
    net5S: number;
    net15L: number;
    net15S: number;
    net30L: number;
    net30S: number;
    net60L: number;
    net60S: number;
  }> = [];

  let quoteIdx = 0;
  let scorableIdx = 0;

  for (const sec of seconds) {
    if (!sec.scorable) continue;
    history.push({
      timestampMs: sec.timestampMs,
      bid: sec.bid,
      ask: sec.ask,
      bidUpdatedMs: sec.bidUpdatedMs,
      askUpdatedMs: sec.askUpdatedMs,
      micro: sec.micro
    });
    if (history.length > 120) history.shift();

    while (
      quoteIdx < allQuotes.length &&
      allQuotes[quoteIdx]!.timestampMs <= sec.timestampMs
    ) {
      quoteIdx += 1;
    }

    const take = scorableIdx % sampleStride === 0;
    scorableIdx += 1;
    if (!take) continue;

    const features = buildFeaturesAtSecond({
      history,
      m1Bars: args.m1Bars,
      m5Bars: args.m5Bars,
      m15Bars: args.m15Bars
    });
    if (!features) continue;

    const packed = featureVectorToV12Array(features, history);
    if (!packed) continue;

    const nets: Record<number, { l: number; s: number }> = {};
    for (const h of GH_HORIZONS_SEC) {
      const lab = labelHorizon({
        horizonSec: h,
        entry: { timestampMs: sec.timestampMs, bid: sec.bid, ask: sec.ask },
        futureQuotes: allQuotes,
        fromIndex: quoteIdx,
        theta: 0.05
      });
      nets[h] = { l: lab.netLong ?? 0, s: lab.netShort ?? 0 };
    }

    rawX.push(packed.x);
    meta.push({
      timestampMs: sec.timestampMs,
      bid: sec.bid,
      ask: sec.ask,
      spread: sec.ask - sec.bid,
      regime: packed.regime,
      velocity: features.velocity,
      spreadOverMedian: features.spreadOverMedian,
      net5L: nets[5]?.l ?? 0,
      net5S: nets[5]?.s ?? 0,
      net15L: nets[15]?.l ?? 0,
      net15S: nets[15]?.s ?? 0,
      net30L: nets[30]?.l ?? 0,
      net30S: nets[30]?.s ?? 0,
      net60L: nets[60]?.l ?? 0,
      net60S: nets[60]?.s ?? 0
    });
  }

  // Release second grid + quote index.
  seconds.length = 0;
  allQuotes.length = 0;

  const keyNames = v12FeatureKeyNames([...GH_FEATURE_KEYS]);
  let keptIndices: number[];
  let droppedKeys: string[];
  if (args.keptIndices?.length) {
    keptIndices = args.keptIndices;
    droppedKeys = [];
  } else {
    const trainCut = Math.floor(rawX.length * 0.6);
    const audited = auditV12Features(
      rawX.slice(0, Math.max(1, trainCut)),
      keyNames
    );
    keptIndices = audited.keptIndices;
    droppedKeys = audited.droppedKeys;
  }
  const Xp = projectFeatures(rawX, keptIndices);
  rawX.length = 0;

  const rows: V12ResearchRow[] = meta.map((m, i) => ({
    timestampMs: m.timestampMs,
    bid: m.bid,
    ask: m.ask,
    spread: m.spread,
    x: Float32Array.from(Xp[i]!),
    regime: m.regime,
    velocity: m.velocity,
    spreadOverMedian: m.spreadOverMedian,
    net5L: m.net5L,
    net5S: m.net5S,
    net15L: m.net15L,
    net15S: m.net15S,
    net30L: m.net30L,
    net30S: m.net30S,
    net60L: m.net60L,
    net60S: m.net60S,
    dataOk: true
  }));
  Xp.length = 0;
  meta.length = 0;

  return { rows, gridStats, keptIndices, droppedKeys, keyNames };
}

export function horizonNetCompact(
  row: V12ResearchRow,
  h: number
): { long: number; short: number } {
  if (h <= 5) return { long: row.net5L, short: row.net5S };
  if (h <= 15) return { long: row.net15L, short: row.net15S };
  if (h <= 30) return { long: row.net30L, short: row.net30S };
  return { long: row.net60L, short: row.net60S };
}
