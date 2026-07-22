/**
 * Pure indicator calculations from OHLCV bars.
 * GoldMeta must compute these from Alpaca data — never trust TradingView alone.
 *
 * usEquitySessionStatus / minutesToUsRegularClose are TEST-ONLY helpers.
 * Production SHADOW uses MarketSessionProvider (Alpaca clock/calendar).
 */

import type { OhlcvBar } from "./marketDataProvider";

export function ema(values: number[], period: number): number | null {
  if (values.length < period || period < 1) return null;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
  }
  return prev;
}

export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function atr(bars: OhlcvBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i]!;
    const prev = bars[i - 1]!;
    trs.push(
      Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close))
    );
  }
  if (trs.length < period) return null;
  let avg = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    avg = (avg * (period - 1) + trs[i]!) / period;
  }
  return avg;
}

export function vwap(bars: OhlcvBar[]): number | null {
  let pv = 0;
  let vol = 0;
  for (const bar of bars) {
    const typical = (bar.high + bar.low + bar.close) / 3;
    pv += typical * bar.volume;
    vol += bar.volume;
  }
  if (vol <= 0) return null;
  return pv / vol;
}

export function volatilityPct(closes: number[], period = 20): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  if (mean === 0) return null;
  const variance =
    slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / Math.max(1, slice.length - 1);
  return (Math.sqrt(variance) / mean) * 100;
}

/** @deprecated Prefer relativeVolumeSameTimeOfDay — do not divide one bar by ADV. */
export function relativeVolume(currentVolume: number, averageDailyVolume: number): number | null {
  if (averageDailyVolume <= 0) return null;
  return currentVolume / averageDailyVolume;
}

/**
 * Minutes since midnight America/New_York for a bar timestamp.
 */
export function etMinutesOfDay(iso: string): number | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "NaN");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "NaN");
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

export function etDateString(iso: string): string | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !day) return null;
  return `${y}-${m}-${day}`;
}

/**
 * Keep only regular-session bars for a given market date.
 * Defaults: open 09:30 ET, close 16:00 ET (override for early closes).
 * Excludes pre-market and post-market.
 */
export function filterRegularSessionBars(
  bars: OhlcvBar[],
  args: {
    marketDate: string;
    sessionOpenMinutes?: number; // default 9*60+30
    sessionCloseMinutes?: number; // default 16*60
  }
): OhlcvBar[] {
  const openMins = args.sessionOpenMinutes ?? 9 * 60 + 30;
  const closeMins = args.sessionCloseMinutes ?? 16 * 60;
  return bars.filter((bar) => {
    const date = etDateString(bar.time);
    if (date !== args.marketDate) return false;
    const mins = etMinutesOfDay(bar.time);
    if (mins == null) return false;
    return mins >= openMins && mins < closeMins;
  });
}

/**
 * Session VWAP: reset at regular-session open; only current-session RTH bars.
 */
export function sessionVwap(
  bars: OhlcvBar[],
  args: {
    marketDate: string;
    sessionOpenMinutes?: number;
    sessionCloseMinutes?: number;
  }
): number | null {
  return vwap(filterRegularSessionBars(bars, args));
}

/**
 * Relative volume: cumulative RTH volume so far today ÷ average cumulative
 * volume at the same time of day across previous completed sessions (≥20 when available).
 */
export function relativeVolumeSameTimeOfDay(args: {
  bars1mOr5m: OhlcvBar[];
  marketDate: string;
  nowMinutesEt: number;
  sessionOpenMinutes?: number;
  sessionCloseMinutes?: number;
  lookbackSessions?: number;
}): number | null {
  const openMins = args.sessionOpenMinutes ?? 9 * 60 + 30;
  const closeMins = args.sessionCloseMinutes ?? 16 * 60;
  const lookback = args.lookbackSessions ?? 20;
  if (args.nowMinutesEt < openMins || args.nowMinutesEt >= closeMins) return null;

  const byDate = new Map<string, OhlcvBar[]>();
  for (const bar of args.bars1mOr5m) {
    const date = etDateString(bar.time);
    const mins = etMinutesOfDay(bar.time);
    if (!date || mins == null) continue;
    if (mins < openMins || mins >= closeMins) continue;
    const list = byDate.get(date) ?? [];
    list.push(bar);
    byDate.set(date, list);
  }

  const todayBars = byDate.get(args.marketDate) ?? [];
  const currentCum = todayBars
    .filter((b) => (etMinutesOfDay(b.time) ?? 9999) <= args.nowMinutesEt)
    .reduce((s, b) => s + b.volume, 0);
  if (currentCum <= 0) return null;

  const priorDates = [...byDate.keys()]
    .filter((d) => d < args.marketDate)
    .sort()
    .slice(-lookback);
  if (!priorDates.length) return null;

  const priorCums: number[] = [];
  for (const date of priorDates) {
    const bars = byDate.get(date) ?? [];
    const cum = bars
      .filter((b) => (etMinutesOfDay(b.time) ?? 9999) <= args.nowMinutesEt)
      .reduce((s, b) => s + b.volume, 0);
    if (cum > 0) priorCums.push(cum);
  }
  if (!priorCums.length) return null;
  const avg = priorCums.reduce((a, b) => a + b, 0) / priorCums.length;
  if (avg <= 0) return null;
  return currentCum / avg;
}

export function trendFromEmas(
  ema50: number | null,
  ema200: number | null
): "BULL" | "BEAR" | "NEUTRAL" | "UNKNOWN" {
  if (ema50 == null || ema200 == null) return "UNKNOWN";
  if (ema50 > ema200 * 1.002) return "BULL";
  if (ema50 < ema200 * 0.998) return "BEAR";
  return "NEUTRAL";
}

/**
 * TEST-ONLY fixed weekday / 09:30–16:00 helpers.
 * Production SHADOW must use MarketSessionProvider.
 */
export function usEquitySessionStatus(
  now: Date = new Date()
): "OPEN" | "CLOSED" | "PRE" | "POST" | "UNKNOWN" {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (weekday === "Sat" || weekday === "Sun") return "CLOSED";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "NaN");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "NaN");
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return "UNKNOWN";
  const mins = hour * 60 + minute;
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return "PRE";
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return "OPEN";
  if (mins >= 16 * 60 && mins < 20 * 60) return "POST";
  return "CLOSED";
}

/** TEST-ONLY — production uses MarketSessionProvider.minutesToClose. */
export function minutesToUsRegularClose(now: Date = new Date()): number | null {
  const status = usEquitySessionStatus(now);
  if (status !== "OPEN") return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "NaN");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "NaN");
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return 16 * 60 - (hour * 60 + minute);
}

export function isIndicatorBarsFresh(bars: OhlcvBar[], maxAgeMs: number, nowMs = Date.now()): boolean {
  if (!bars.length) return false;
  const last = bars[bars.length - 1]!;
  const age = nowMs - Date.parse(last.time);
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
}
