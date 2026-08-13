/**
 * V1.2 microstructure features — reconstructible from Bid/Ask history (LIVE-safe).
 * Past-only: never uses future ticks or future seconds.
 */
import type { GhFeatureVector } from "../types";
import { featureVectorToArray } from "../features";
import type { GhSecondPoint } from "../features";
import { featureVectorToV11Array } from "../v11/features";
import { classifyV12Regime, type V12Regime } from "./regimes";

export const V12_MICRO_FEATURE_KEYS = [
  "bidUpd1",
  "bidUpd2",
  "bidUpd5",
  "askUpd1",
  "askUpd2",
  "askUpd5",
  "quoteIntensity5",
  "bidAskUpdImb",
  "upTick5",
  "downTick5",
  "signedTickImb5",
  "upRun",
  "downRun",
  "vel1",
  "vel2",
  "vel3",
  "vel5",
  "vel250proxy",
  "vel500proxy",
  "accel1v3",
  "accel2v5",
  "burstRatio",
  "spreadNow",
  "spreadMed30",
  "spreadPctPast",
  "spreadCompression",
  "spreadExpandRate",
  "midDispOverSpread",
  "moveSpreadRatio5",
  "eff15",
  "chop15",
  "dist1Hi",
  "dist1Lo",
  "dist5Hi",
  "dist5Lo",
  "dist15Hi",
  "dist15Lo",
  "dist30Hi",
  "dist30Lo",
  "breakoutPressure",
  "rejectPressure",
  "momAlign",
  "velVsM1",
  "velVsM5"
] as const;

export type V12MicroFeatureKey = (typeof V12_MICRO_FEATURE_KEYS)[number];

function midOf(p: GhSecondPoint): number {
  return (p.bid + p.ask) / 2;
}

function sumMicro(
  hist: GhSecondPoint[],
  n: number,
  pick: (m: GhSecondPoint["micro"]) => number
): number {
  const slice = hist.slice(-n);
  let s = 0;
  for (const p of slice) s += pick(p.micro);
  return s;
}

function retLag(mids: number[], lag: number): number {
  if (mids.length <= lag) return 0;
  const a = mids[mids.length - 1]!;
  const b = mids[mids.length - 1 - lag]!;
  if (!(b > 0)) return 0;
  return (a - b) / b;
}

function pathLength(mids: number[], window: number): number {
  const slice = mids.slice(-window);
  let s = 0;
  for (let i = 1; i < slice.length; i++) s += Math.abs(slice[i]! - slice[i - 1]!);
  return s;
}

function consecutiveRun(mids: number[], up: boolean): number {
  let run = 0;
  for (let i = mids.length - 1; i >= 1; i--) {
    const d = mids[i]! - mids[i - 1]!;
    if (up ? d > 0 : d < 0) run += 1;
    else break;
  }
  return run;
}

export function buildV12MicroFeatures(args: {
  history: GhSecondPoint[];
  m1Return?: number;
  m5Return?: number;
}): { values: number[]; regime: V12Regime; keys: readonly string[] } | null {
  const hist = args.history;
  if (hist.length < 3) return null;
  const cur = hist[hist.length - 1]!;
  const mids = hist.map(midOf);
  const spreads = hist.map((p) => p.ask - p.bid);
  const spreadNow = Math.max(1e-9, cur.ask - cur.bid);

  const bidUpd1 = sumMicro(hist, 1, (m) => m.bidUpdateCount);
  const bidUpd2 = sumMicro(hist, 2, (m) => m.bidUpdateCount);
  const bidUpd5 = sumMicro(hist, 5, (m) => m.bidUpdateCount);
  const askUpd1 = sumMicro(hist, 1, (m) => m.askUpdateCount);
  const askUpd2 = sumMicro(hist, 2, (m) => m.askUpdateCount);
  const askUpd5 = sumMicro(hist, 5, (m) => m.askUpdateCount);
  const quoteIntensity5 = bidUpd5 + askUpd5;
  const bidAskUpdImb =
    (bidUpd5 - askUpd5) / Math.max(1, bidUpd5 + askUpd5);

  const upTick5 = sumMicro(hist, 5, (m) => m.upTickCount);
  const downTick5 = sumMicro(hist, 5, (m) => m.downTickCount);
  const signedTickImb5 =
    (upTick5 - downTick5) / Math.max(1, upTick5 + downTick5);

  const vel1 = retLag(mids, 1);
  const vel2 = retLag(mids, 2);
  const vel3 = retLag(mids, 3);
  const vel5 = retLag(mids, 5);
  // Sub-second proxies from last-second tick intensity × 1s mid move.
  const tick1 = cur.micro.spotEventCount;
  const vel250proxy = vel1 * Math.min(4, tick1 / 2);
  const vel500proxy = vel1 * Math.min(2, tick1 / 4);

  const accel1v3 = vel1 - vel3;
  const accel2v5 = vel2 - vel5;

  const rates = hist.slice(-30).map((p) => p.micro.spotEventCount);
  const tickRateMean =
    rates.reduce((a, b) => a + b, 0) / Math.max(1, rates.length);
  const burstRatio = tickRateMean > 0 ? tick1 / tickRateMean : 1;

  const pastSpreads = spreads.slice(0, -1);
  const sortedPast = [...pastSpreads].sort((a, b) => a - b);
  const spreadMed30 = (() => {
    const s = spreads.slice(-30);
    const o = [...s].sort((a, b) => a - b);
    return o[Math.floor(o.length / 2)] || spreadNow;
  })();
  const spreadPctPast = pastSpreads.length
    ? pastSpreads.filter((x) => x <= spreadNow).length / pastSpreads.length
    : 0.5;
  const spreadCompression = 1 - Math.min(1, spreadNow / Math.max(spreadMed30, 1e-9));
  const prevSpread = spreads.length > 1 ? spreads[spreads.length - 2]! : spreadNow;
  const spreadExpandRate = (spreadNow - prevSpread) / Math.max(spreadMed30, 1e-9);

  const mid = mids[mids.length - 1]!;
  const midDispOverSpread =
    (mid - (cur.bid + cur.ask) / 2) / spreadNow; // ~0 by construction; keep book relative
  void midDispOverSpread;
  const midDisp =
    ((cur.bid + cur.ask) / 2 - cur.bid) / spreadNow - 0.5; // where mid sits in spread

  const move5 = Math.abs(retLag(mids, 5)) * mid;
  const moveSpreadRatio5 = move5 / spreadNow;

  const net15 = Math.abs(mids[mids.length - 1]! - mids[Math.max(0, mids.length - 15)]!);
  const path15 = pathLength(mids, 15);
  const eff15 = path15 > 0 ? net15 / path15 : 0;
  const chop15 = 1 - eff15;

  const hi = (w: number) => Math.max(...mids.slice(-w));
  const lo = (w: number) => Math.min(...mids.slice(-w));
  const dist1Hi = hi(1) - mid;
  const dist1Lo = mid - lo(1);
  const dist5Hi = hi(5) - mid;
  const dist5Lo = mid - lo(5);
  const dist15Hi = hi(15) - mid;
  const dist15Lo = mid - lo(15);
  const dist30Hi = hi(30) - mid;
  const dist30Lo = mid - lo(30);

  const breakoutPressure =
    (dist15Hi <= spreadNow * 0.25 ? 1 : 0) *
    Math.max(0, vel3) *
    Math.max(0, burstRatio - 1);
  const rejectPressure =
    (dist15Lo <= spreadNow * 0.25 ? 1 : 0) *
    Math.max(0, -vel3) *
    Math.max(0, burstRatio - 1);

  const signs = [vel1, vel3, vel5, retLag(mids, 15), retLag(mids, 30)].map(
    (v) => Math.sign(v)
  );
  const momAlign =
    signs.filter((s) => s === signs[0] && s !== 0).length / signs.length;

  const m1 = args.m1Return ?? 0;
  const m5 = args.m5Return ?? 0;
  const velVsM1 = vel5 - m1;
  const velVsM5 = vel5 - m5;

  const shortVol = (() => {
    const rets: number[] = [];
    const slice = mids.slice(-15);
    for (let i = 1; i < slice.length; i++) {
      const b = slice[i - 1]!;
      if (b > 0) rets.push((slice[i]! - b) / b);
    }
    if (rets.length < 2) return 0;
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const v =
      rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1);
    return Math.sqrt(v);
  })();

  const regime = classifyV12Regime({
    ret5: vel5,
    ret15: retLag(mids, 15),
    ret60: retLag(mids, 60),
    shortVol,
    range15: hi(15) - lo(15),
    range60: hi(Math.min(60, mids.length)) - lo(Math.min(60, mids.length)),
    spreadOverMedian: spreadNow / Math.max(spreadMed30, 1e-9),
    burstRatio,
    efficiency15: eff15,
    tickRate1s: tick1,
    tickRateMean
  });

  const values = [
    bidUpd1,
    bidUpd2,
    bidUpd5,
    askUpd1,
    askUpd2,
    askUpd5,
    quoteIntensity5,
    bidAskUpdImb,
    upTick5,
    downTick5,
    signedTickImb5,
    consecutiveRun(mids, true),
    consecutiveRun(mids, false),
    vel1,
    vel2,
    vel3,
    vel5,
    vel250proxy,
    vel500proxy,
    accel1v3,
    accel2v5,
    burstRatio,
    spreadNow,
    spreadMed30,
    spreadPctPast,
    spreadCompression,
    spreadExpandRate,
    midDisp,
    moveSpreadRatio5,
    eff15,
    chop15,
    dist1Hi,
    dist1Lo,
    dist5Hi,
    dist5Lo,
    dist15Hi,
    dist15Lo,
    dist30Hi,
    dist30Lo,
    breakoutPressure,
    rejectPressure,
    momAlign,
    velVsM1,
    velVsM5
  ];

  return { values, regime, keys: V12_MICRO_FEATURE_KEYS };
}

/** Full V1.2 feature vector = V1.1 base+interactions + microstructure block. */
export function featureVectorToV12Array(
  f: GhFeatureVector,
  history: GhSecondPoint[]
): { x: number[]; regime: V12Regime } | null {
  const m1Return = f.m1DistClose; // proxy already in vector space
  const micro = buildV12MicroFeatures({
    history,
    m1Return: f.m5Return ? f.m5Return : 0,
    m5Return: f.m5Return
  });
  if (!micro) return null;
  const base = featureVectorToV11Array(f);
  return { x: [...base, ...micro.values], regime: micro.regime };
}

export function v12FeatureKeyNames(baseKeys: string[]): string[] {
  return [...baseKeys, ...V12_MICRO_FEATURE_KEYS];
}

export function auditV12Features(
  X: number[][],
  keys: string[],
  minStd = 1e-12
): { keptIndices: number[]; droppedKeys: string[] } {
  if (!X.length) return { keptIndices: [], droppedKeys: [] };
  const d = X[0]!.length;
  const keptIndices: number[] = [];
  const droppedKeys: string[] = [];
  for (let j = 0; j < d; j++) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let sum = 0;
    let sum2 = 0;
    for (let i = 0; i < X.length; i++) {
      const v = X[i]![j]!;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      sum2 += v * v;
    }
    const mean = sum / X.length;
    const std = Math.sqrt(Math.max(0, sum2 / X.length - mean * mean));
    if (!(std > minStd) || min === max) {
      droppedKeys.push(keys[j] ?? `f${j}`);
    } else {
      keptIndices.push(j);
    }
  }
  return { keptIndices, droppedKeys };
}

export function projectFeatures(X: number[][], kept: number[]): number[][] {
  return X.map((row) => kept.map((j) => row[j]!));
}

void featureVectorToArray;
