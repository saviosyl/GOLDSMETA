/**
 * Deterministic Micro feature builder — no Core imports, no future leakage.
 * Only uses bars with closeTimeMs <= cutoffMs and quote at/before cutoff.
 */
import type { MicroBar, MicroFeatureSnapshot, MicroQuote } from "../types";
import { MICRO_FEATURE_VERSION } from "../config";
import { classifyMicroSession } from "../clock";

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
function ret(bars: MicroBar[], n: number): number {
  if (bars.length <= n) return 0;
  const a = bars[bars.length - 1]!.close;
  const b = bars[bars.length - 1 - n]!.close;
  return a - b;
}
function atrLike(bars: MicroBar[], n: number): number {
  const slice = bars.slice(-n);
  if (!slice.length) return 0;
  return mean(slice.map((b) => b.high - b.low));
}

export function buildFeatureVector(args: {
  predictionId: string;
  cutoffMs: number;
  m1: MicroBar[];
  m5: MicroBar[];
  m15: MicroBar[];
  quote: MicroQuote;
  spreadHistory: number[];
}): MicroFeatureSnapshot {
  const cutoffTs = new Date(args.cutoffMs).toISOString();
  const m1 = args.m1.filter((b) => b.closeTimeMs <= args.cutoffMs);
  const m5 = args.m5.filter((b) => b.closeTimeMs <= args.cutoffMs);
  const m15 = args.m15.filter((b) => b.closeTimeMs <= args.cutoffMs);
  const last = m1[m1.length - 1];
  const missingFlags: Record<string, boolean> = {
    m1_insufficient: m1.length < 30,
    m5_insufficient: m5.length < 8,
    m15_insufficient: m15.length < 8,
    quote_stale: args.quote.freshness === "STALE" || args.quote.freshness === "UNAVAILABLE"
  };

  const body = last ? Math.abs(last.close - last.open) : 0;
  const range = last ? Math.max(1e-9, last.high - last.low) : 1e-9;
  const upperWick = last ? last.high - Math.max(last.open, last.close) : 0;
  const lowerWick = last ? Math.min(last.open, last.close) - last.low : 0;
  const dir = last ? Math.sign(last.close - last.open) : 0;
  let streak = 0;
  for (let i = m1.length - 1; i >= 0; i--) {
    const d = Math.sign(m1[i]!.close - m1[i]!.open);
    if (i === m1.length - 1) streak = d;
    else if (Math.sign(streak) === d && d !== 0) streak += d;
    else break;
  }

  const ranges = m1.slice(-30).map((b) => b.high - b.low);
  const medRange = median(ranges) || 1e-9;
  const returns1 = [];
  for (let i = 1; i < m1.length; i++) returns1.push(m1[i]!.close - m1[i - 1]!.close);
  const vol5 = std(returns1.slice(-5));
  const vol15 = std(returns1.slice(-15));
  const vol30 = std(returns1.slice(-30));
  const atr15 = atrLike(m1, 15) || 1e-9;

  const hi15 = Math.max(...m1.slice(-15).map((b) => b.high), last?.high ?? 0);
  const lo15 = Math.min(...m1.slice(-15).map((b) => b.low), last?.low ?? 0);
  const hi30 = Math.max(...m1.slice(-30).map((b) => b.high), last?.high ?? 0);
  const lo30 = Math.min(...m1.slice(-30).map((b) => b.low), last?.low ?? 0);

  const vols = m1.slice(-30).map((b) => b.tickVolume);
  const volMean = mean(vols);
  const volMed = median(vols);
  const volSd = std(vols) || 1;
  const tickVol = last?.tickVolume ?? 0;

  const mom3 = ret(m1, 3);
  const mom5 = ret(m1, 5);
  const mom10 = ret(m1, 10);
  const mom15 = ret(m1, 15);

  const m5ret1 = ret(m5, 1);
  const m5ret3 = ret(m5, 3);
  const m15ret1 = ret(m15, 1);
  const m15ret2 = ret(m15, 2);
  const m15ret4 = ret(m15, 4);

  // Micro-owned EMA-like slope on M15 closes (independent of Core).
  const m15closes = m15.slice(-20).map((b) => b.close);
  let ema = m15closes[0] ?? 0;
  const alpha = 2 / (8 + 1);
  for (const c of m15closes) ema = alpha * c + (1 - alpha) * ema;
  const emaSpread = (last?.close ?? 0) - ema;

  const utcHour = new Date(args.cutoffMs).getUTCHours();
  const { session } = classifyMicroSession(utcHour);

  const spreadHist = args.spreadHistory.filter((x) => Number.isFinite(x));
  const spreadMed = median(spreadHist) || args.quote.spread || 1e-9;
  const spreadSd = std(spreadHist) || 1e-9;

  const values: Record<string, number> = {
    ret_1m: ret(m1, 1),
    ret_3m: ret(m1, 3),
    ret_5m: ret(m1, 5),
    ret_10m: ret(m1, 10),
    ret_15m: ret(m1, 15),
    body,
    range,
    body_range: body / range,
    upper_wick: upperWick,
    upper_wick_range: upperWick / range,
    lower_wick: lowerWick,
    lower_wick_range: lowerWick / range,
    candle_dir: dir,
    dir_streak: streak,
    mom_3m: mom3,
    mom_5m: mom5,
    mom_10m: mom10,
    mom_15m: mom15,
    mom_short_vs_long: mom3 - mom15,
    mom_accel: mom3 - mom5,
    vol_5m: vol5,
    vol_15m: vol15,
    vol_30m: vol30,
    range_vs_median: range / medRange,
    range_expansion: range > medRange * 1.5 ? 1 : range < medRange * 0.6 ? -1 : 0,
    dist_15h: ((last?.close ?? 0) - hi15) / atr15,
    dist_15l: ((last?.close ?? 0) - lo15) / atr15,
    dist_30h: ((last?.close ?? 0) - hi30) / atr15,
    dist_30l: ((last?.close ?? 0) - lo30) / atr15,
    tick_vol: tickVol,
    tick_vol_mean: volMean,
    tick_vol_median: volMed,
    tick_vol_z: (tickVol - volMean) / volSd,
    m5_ret_1: m5ret1,
    m5_ret_3: m5ret3,
    m5_mom: m5ret3,
    m5_breakout_up: last && last.close > hi15 ? 1 : 0,
    m5_breakout_down: last && last.close < lo15 ? 1 : 0,
    m15_ret_1: m15ret1,
    m15_ret_2: m15ret2,
    m15_ret_4: m15ret4,
    m15_ema_spread: emaSpread / atr15,
    m15_trend_slope: m15ret4 / atr15,
    session_asia: session === "ASIA" ? 1 : 0,
    session_london: session === "LONDON" ? 1 : 0,
    session_ny: session === "NEW_YORK" ? 1 : 0,
    session_overlap: session === "LONDON_NY_OVERLAP" ? 1 : 0,
    bid: args.quote.bid,
    ask: args.quote.ask,
    mid: args.quote.mid,
    spread: args.quote.spread,
    spread_vs_median: args.quote.spread / spreadMed,
    spread_z: (args.quote.spread - spreadMed) / spreadSd,
    quote_age_ms: args.quote.ageMs,
    quote_live: args.quote.freshness === "LIVE" ? 1 : 0
  };

  // Experimental microstructure placeholders — availability false until streaming collector.
  const experimentalAvailable = {
    tick_velocity: false,
    dom_depth: false,
    microprice: false
  };

  const raw: Record<string, number | string | boolean | null> = {
    cutoffTs,
    session,
    lastClose: last?.close ?? null,
    lastTickVolume: tickVol
  };

  return {
    featureRef: `feat_${args.predictionId}`,
    predictionId: args.predictionId,
    featureVersion: MICRO_FEATURE_VERSION,
    scalerVersion: "identity-v1",
    cutoffTs,
    createdAt: new Date().toISOString(),
    raw,
    values,
    missingFlags,
    experimentalAvailable
  };
}

/** Champion model keys — excludes experimental DOM/tick velocity until promoted. */
export const CHAMPION_FEATURE_KEYS = [
  "ret_1m",
  "ret_5m",
  "ret_15m",
  "body_range",
  "upper_wick_range",
  "lower_wick_range",
  "candle_dir",
  "mom_5m",
  "mom_15m",
  "mom_short_vs_long",
  "vol_15m",
  "range_vs_median",
  "dist_15h",
  "dist_15l",
  "tick_vol_z",
  "m5_ret_3",
  "m5_breakout_up",
  "m5_breakout_down",
  "m15_trend_slope",
  "m15_ema_spread",
  "session_london",
  "session_ny",
  "session_overlap",
  "spread_vs_median",
  "quote_live"
] as const;
