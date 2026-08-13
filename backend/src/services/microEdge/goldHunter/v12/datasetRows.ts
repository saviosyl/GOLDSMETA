/**
 * Build V1.2 research rows with microstructure features + regime (past-only).
 */
import {
  buildAsOfSecondRows,
  buildLabeledResearchRows,
  type RawTick
} from "../asOfDataset";
import type { GhBarCtx, GhSecondPoint } from "../features";
import { GH_FEATURE_KEYS } from "../types";
import {
  auditV12Features,
  featureVectorToV12Array,
  projectFeatures,
  v12FeatureKeyNames
} from "./microFeatures";
import type { V12Regime } from "./regimes";
import type { LabeledResearchRow } from "../asOfDataset";

export type V12ResearchRow = {
  timestampMs: number;
  bid: number;
  ask: number;
  spread: number;
  x: number[];
  regime: V12Regime;
  velocity: number;
  spreadOverMedian: number;
  labels: LabeledResearchRow["labels"];
  dataOk: boolean;
};

export function buildV12ResearchRows(args: {
  ticks: RawTick[];
  m1Bars: GhBarCtx[];
  m5Bars: GhBarCtx[];
  m15Bars: GhBarCtx[];
  fromMs: number;
  toMs: number;
  /** When set (e.g. frozen config), reuse these indices — do not re-audit. */
  keptIndices?: number[];
}): {
  rows: V12ResearchRow[];
  gridStats: ReturnType<typeof buildAsOfSecondRows>["stats"];
  keptIndices: number[];
  droppedKeys: string[];
  keyNames: string[];
} {
  const sorted = [...args.ticks].sort((a, b) => a.timestampMs - b.timestampMs);
  const { rows: seconds, stats: gridStats } = buildAsOfSecondRows(sorted, {
    fromMs: args.fromMs,
    toMs: args.toMs
  });
  const labeled = buildLabeledResearchRows({
    seconds,
    theta: 0.05,
    m1Bars: args.m1Bars,
    m5Bars: args.m5Bars,
    m15Bars: args.m15Bars
  });

  // Rebuild history for micro features (aligned with labeled rows).
  const history: GhSecondPoint[] = [];
  const secByTs = new Map(seconds.map((s) => [s.timestampMs, s]));
  const rawRows: Array<Omit<V12ResearchRow, "x"> & { xFull: number[] }> = [];

  for (const lr of labeled.rows) {
    const sec = secByTs.get(lr.timestampMs);
    if (!sec || !sec.scorable) continue;
    history.push({
      timestampMs: sec.timestampMs,
      bid: sec.bid,
      ask: sec.ask,
      bidUpdatedMs: sec.bidUpdatedMs,
      askUpdatedMs: sec.askUpdatedMs,
      micro: sec.micro
    });
    if (history.length > 120) history.shift();
    const packed = featureVectorToV12Array(lr.features, history);
    if (!packed) continue;
    rawRows.push({
      timestampMs: lr.timestampMs,
      bid: lr.quote.bid,
      ask: lr.quote.ask,
      spread: lr.quote.ask - lr.quote.bid,
      xFull: packed.x,
      regime: packed.regime,
      velocity: lr.features.velocity,
      spreadOverMedian: lr.features.spreadOverMedian,
      labels: lr.labels,
      dataOk: true
    });
  }

  const keyNames = v12FeatureKeyNames([...GH_FEATURE_KEYS]);
  const Xfull = rawRows.map((r) => r.xFull);
  let keptIndices: number[];
  let droppedKeys: string[];
  if (args.keptIndices?.length) {
    keptIndices = args.keptIndices;
    droppedKeys = [];
  } else {
    // Fit variance filter on first 60% (development portion) only.
    const trainCut = Math.floor(Xfull.length * 0.6);
    const audited = auditV12Features(
      Xfull.slice(0, Math.max(1, trainCut)),
      keyNames
    );
    keptIndices = audited.keptIndices;
    droppedKeys = audited.droppedKeys;
  }
  const Xp = projectFeatures(Xfull, keptIndices);
  const rows: V12ResearchRow[] = rawRows.map((r, i) => ({
    timestampMs: r.timestampMs,
    bid: r.bid,
    ask: r.ask,
    spread: r.spread,
    x: Xp[i]!,
    regime: r.regime,
    velocity: r.velocity,
    spreadOverMedian: r.spreadOverMedian,
    labels: r.labels,
    dataOk: r.dataOk
  }));

  return { rows, gridStats, keptIndices, droppedKeys, keyNames };
}
