import type { GhFeatureKey, GhFeatureVector, GhMicrostructureInterval } from "./types";
import { GH_FEATURE_KEYS } from "./types";
import { classifyRegime, classifySession } from "./sessionRegime";
import { buildQuoteBook } from "./quoteValidity";
import { GH_SIDE_FRESHNESS_MS } from "./config";

export type GhBarCtx = {
  openTimeMs: number;
  closeTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number;
};

export type GhSecondPoint = {
  timestampMs: number;
  bid: number;
  ask: number;
  bidUpdatedMs: number;
  askUpdatedMs: number;
  micro: GhMicrostructureInterval;
};

function midOf(p: GhSecondPoint): number {
  return (p.bid + p.ask) / 2;
}

function ret(series: number[], lag: number): number {
  if (series.length <= lag) return 0;
  const a = series[series.length - 1]!;
  const b = series[series.length - 1 - lag]!;
  if (!(b > 0)) return 0;
  return (a - b) / b;
}

function rangeOf(series: number[], window: number): number {
  const slice = series.slice(-window);
  if (!slice.length) return 0;
  return Math.max(...slice) - Math.min(...slice);
}

function stdev(series: number[]): number {
  if (series.length < 2) return 0;
  const mean = series.reduce((s, x) => s + x, 0) / series.length;
  const v =
    series.reduce((s, x) => s + (x - mean) ** 2, 0) / (series.length - 1);
  return Math.sqrt(v);
}

function latestCompletedBar(bars: GhBarCtx[], asOfMs: number): GhBarCtx | null {
  let best: GhBarCtx | null = null;
  for (const b of bars) {
    if (b.closeTimeMs > asOfMs) continue;
    if (!best || b.closeTimeMs > best.closeTimeMs) best = b;
  }
  return best;
}

/**
 * Build features for second t using ONLY information known at/before t.
 */
export function buildFeaturesAtSecond(args: {
  history: GhSecondPoint[]; // ascending, including current second at end
  m1Bars: GhBarCtx[];
  m5Bars: GhBarCtx[];
  m15Bars: GhBarCtx[];
  sideFreshnessMs?: number;
}): GhFeatureVector | null {
  const hist = args.history;
  if (!hist.length) return null;
  const cur = hist[hist.length - 1]!;
  const book = buildQuoteBook({
    nowMs: cur.timestampMs,
    brokerTimestampMs: Math.max(cur.bidUpdatedMs, cur.askUpdatedMs),
    bid: cur.bid,
    ask: cur.ask,
    bidUpdatedMs: cur.bidUpdatedMs,
    askUpdatedMs: cur.askUpdatedMs,
    sideFreshnessMs: args.sideFreshnessMs ?? GH_SIDE_FRESHNESS_MS
  });
  if (!book.valid) return null;

  const mids = hist.map(midOf);
  const spreads = hist.map((p) => p.ask - p.bid);
  const medianSpread = (() => {
    const s = [...spreads].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] || book.spread || 1e-9;
  })();

  const ret1 = ret(mids, 1);
  const ret2 = ret(mids, 2);
  const ret3 = ret(mids, 3);
  const ret5 = ret(mids, 5);
  const ret10 = ret(mids, 10);
  const ret15 = ret(mids, 15);
  const ret30 = ret(mids, 30);
  const ret60 = ret(mids, 60);

  const velocity = ret3;
  const prevVel =
    mids.length > 6
      ? (mids[mids.length - 4]! - mids[mids.length - 7]!) /
        Math.max(mids[mids.length - 7]!, 1e-9)
      : 0;
  const acceleration = velocity - prevVel;

  const range5 = rangeOf(mids, 5);
  const range15 = rangeOf(mids, 15);
  const range30 = rangeOf(mids, 30);
  const range60 = rangeOf(mids, 60);
  const hi15 = Math.max(...mids.slice(-15), book.mid);
  const lo15 = Math.min(...mids.slice(-15), book.mid);
  const hi60 = Math.max(...mids.slice(-60), book.mid);
  const lo60 = Math.min(...mids.slice(-60), book.mid);

  const pastSpreads = spreads.slice(0, -1);
  const spreadPercentile = (() => {
    if (!pastSpreads.length) return 0.5;
    const below = pastSpreads.filter((x) => x <= book.spread).length;
    return below / pastSpreads.length;
  })();
  const prevSpread = spreads.length > 1 ? spreads[spreads.length - 2]! : book.spread;

  const m1 = latestCompletedBar(args.m1Bars, cur.timestampMs);
  const m5 = latestCompletedBar(args.m5Bars, cur.timestampMs);
  const m15 = latestCompletedBar(args.m15Bars, cur.timestampMs);

  const m1Range = m1 ? m1.high - m1.low : 0;
  const m1Body = m1 ? Math.abs(m1.close - m1.open) : 0;
  const m1UpperWick = m1 ? m1.high - Math.max(m1.open, m1.close) : 0;
  const m1LowerWick = m1 ? Math.min(m1.open, m1.close) - m1.low : 0;

  const shortVol = stdev(mids.slice(-15).map((x, i, a) => (i ? (x - a[i - 1]!) / a[i - 1]! : 0)));
  const session = classifySession(cur.timestampMs);
  const regime = classifyRegime({
    shortVol: shortVol * 10000,
    range60,
    ret15,
    ret60,
    spreadOverMedian: book.spread / Math.max(medianSpread, 1e-9)
  });

  const micro = cur.micro;
  const tickImbalance =
    micro.upTickCount + micro.downTickCount === 0
      ? 0
      : (micro.upTickCount - micro.downTickCount) /
        (micro.upTickCount + micro.downTickCount);

  return {
    timestampMs: cur.timestampMs,
    mid: book.mid,
    spread: book.spread,
    spreadOverMedian: book.spread / Math.max(medianSpread, 1e-9),
    ret1,
    ret2,
    ret3,
    ret5,
    ret10,
    ret15,
    ret30,
    ret60,
    mom3: ret3,
    mom5: ret5,
    mom10: ret10,
    mom15: ret15,
    mom30: ret30,
    velocity,
    acceleration,
    range5,
    range15,
    range30,
    range60,
    dist15High: hi15 - book.mid,
    dist15Low: book.mid - lo15,
    dist60High: hi60 - book.mid,
    dist60Low: book.mid - lo60,
    spotEventCount: micro.spotEventCount,
    bidUpdateCount: micro.bidUpdateCount,
    askUpdateCount: micro.askUpdateCount,
    tickImbalance,
    spreadChange: book.spread - prevSpread,
    spreadPercentile,
    m1Open: m1?.open ?? book.mid,
    m1High: m1?.high ?? book.mid,
    m1Low: m1?.low ?? book.mid,
    m1Close: m1?.close ?? book.mid,
    m1Range,
    m1Body,
    m1UpperWick,
    m1LowerWick,
    m1TickVolume: m1?.tickVolume ?? 0,
    m1DistClose: m1 ? book.mid - m1.close : 0,
    m5Return: m5 && m5.open > 0 ? (m5.close - m5.open) / m5.open : 0,
    m5Range: m5 ? m5.high - m5.low : 0,
    m5TickVolume: m5?.tickVolume ?? 0,
    m15Return: m15 && m15.open > 0 ? (m15.close - m15.open) / m15.open : 0,
    m15Range: m15 ? m15.high - m15.low : 0,
    m15TickVolume: m15?.tickVolume ?? 0,
    shortVol,
    m1VolProxy: m1Range,
    session,
    regime,
    danger: regime === "DANGER"
  };
}

export function featureVectorToArray(f: GhFeatureVector): number[] {
  const sessionAsia = f.session === "ASIA" ? 1 : 0;
  const sessionLondon = f.session === "LONDON" ? 1 : 0;
  const sessionNY = f.session === "NEW_YORK" ? 1 : 0;
  const sessionOverlap = f.session === "OVERLAP" ? 1 : 0;
  const regimeTrend = f.regime === "TREND" ? 1 : 0;
  const regimeRange = f.regime === "RANGE" ? 1 : 0;
  const regimeBreakout = f.regime === "BREAKOUT" ? 1 : 0;
  const regimeDanger = f.regime === "DANGER" ? 1 : 0;

  const map: Record<GhFeatureKey, number> = {
    mid: f.mid,
    spread: f.spread,
    spreadOverMedian: f.spreadOverMedian,
    ret1: f.ret1,
    ret2: f.ret2,
    ret3: f.ret3,
    ret5: f.ret5,
    ret10: f.ret10,
    ret15: f.ret15,
    ret30: f.ret30,
    ret60: f.ret60,
    mom3: f.mom3,
    mom5: f.mom5,
    mom10: f.mom10,
    mom15: f.mom15,
    mom30: f.mom30,
    velocity: f.velocity,
    acceleration: f.acceleration,
    range5: f.range5,
    range15: f.range15,
    range30: f.range30,
    range60: f.range60,
    dist15High: f.dist15High,
    dist15Low: f.dist15Low,
    dist60High: f.dist60High,
    dist60Low: f.dist60Low,
    spotEventCount: f.spotEventCount,
    bidUpdateCount: f.bidUpdateCount,
    askUpdateCount: f.askUpdateCount,
    tickImbalance: f.tickImbalance,
    spreadChange: f.spreadChange,
    spreadPercentile: f.spreadPercentile,
    m1Range: f.m1Range,
    m1Body: f.m1Body,
    m1UpperWick: f.m1UpperWick,
    m1LowerWick: f.m1LowerWick,
    m1TickVolume: f.m1TickVolume,
    m1DistClose: f.m1DistClose,
    m5Return: f.m5Return,
    m5Range: f.m5Range,
    m5TickVolume: f.m5TickVolume,
    m15Return: f.m15Return,
    m15Range: f.m15Range,
    m15TickVolume: f.m15TickVolume,
    shortVol: f.shortVol,
    m1VolProxy: f.m1VolProxy,
    sessionAsia,
    sessionLondon,
    sessionNY,
    sessionOverlap,
    regimeTrend,
    regimeRange,
    regimeBreakout,
    regimeDanger
  };
  return GH_FEATURE_KEYS.map((k) => map[k]);
}
