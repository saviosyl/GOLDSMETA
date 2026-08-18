/**
 * Event-driven FAST features — reconstructible from spot + depth stream.
 * Past-only rolling windows; no candle-close waits.
 */
import type { DepthBookStats } from "./depthBook";

export type SpotSample = {
  t: number;
  bid: number;
  ask: number;
  mid: number;
};

export type GhFastFeatureSnapshot = {
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  bidVel250: number;
  bidVel500: number;
  bidVel1s: number;
  bidVel2s: number;
  bidVel3s: number;
  askVel1s: number;
  midVel250: number;
  midVel500: number;
  midVel1s: number;
  midVel2s: number;
  midVel3s: number;
  acceleration: number;
  updateRate1s: number;
  signedImbalance1s: number;
  efficiency1s: number;
  efficiency3s: number;
  high1s: number;
  low1s: number;
  high2s: number;
  low2s: number;
  high5s: number;
  low5s: number;
  high10s: number;
  low10s: number;
  high15s: number;
  low15s: number;
  high30s: number;
  low30s: number;
  /**
   * Past-only extremes EXCLUDING the current observation.
   * Breakout references must use these — never high5s/low5s which include now.
   */
  priorHigh5s: number;
  priorLow5s: number;
  priorHigh10s: number;
  priorLow10s: number;
  distHigh1s: number;
  distLow1s: number;
  distHigh5s: number;
  distLow5s: number;
  distPriorHigh5s: number;
  distPriorLow5s: number;
  upTouches5s: number;
  downTouches5s: number;
  depth: DepthBookStats;
};

function ret(a: number, b: number): number {
  if (!(b > 0)) return 0;
  return (a - b) / b;
}

function sampleAtOrBefore(buf: SpotSample[], t: number): SpotSample | null {
  for (let i = buf.length - 1; i >= 0; i--) {
    if (buf[i]!.t <= t) return buf[i]!;
  }
  return null;
}

export class FastFeatureEngine {
  private samples: SpotSample[] = [];
  private readonly keepMs = 35_000;
  private upTouches = 0;
  private downTouches = 0;
  private lastHigh5 = Number.NEGATIVE_INFINITY;
  private lastLow5 = Number.POSITIVE_INFINITY;
  private touchWindowStart = 0;

  onSpot(t: number, bid: number, ask: number): void {
    if (!(bid > 0) || !(ask > 0) || ask < bid) return;
    const mid = (bid + ask) / 2;
    this.samples.push({ t, bid, ask, mid });
    const cutoff = t - this.keepMs;
    while (this.samples.length && this.samples[0]!.t < cutoff) {
      this.samples.shift();
    }

    // Rolling 5s high/low touch counting (past-only).
    if (!this.touchWindowStart || t - this.touchWindowStart >= 5000) {
      this.touchWindowStart = t;
      this.upTouches = 0;
      this.downTouches = 0;
      this.lastHigh5 = mid;
      this.lastLow5 = mid;
    }
    const prevHigh = this.lastHigh5;
    const prevLow = this.lastLow5;
    if (mid >= prevHigh) {
      if (mid > prevHigh) this.upTouches += 1;
      this.lastHigh5 = mid;
    }
    if (mid <= prevLow) {
      if (mid < prevLow) this.downTouches += 1;
      this.lastLow5 = mid;
    }
  }

  /** Reset rolling market features after depth/spot resync (preserve nothing). */
  clear(): void {
    this.samples = [];
    this.upTouches = 0;
    this.downTouches = 0;
    this.lastHigh5 = Number.NEGATIVE_INFINITY;
    this.lastLow5 = Number.POSITIVE_INFINITY;
    this.touchWindowStart = 0;
  }

  sampleCount(): number {
    return this.samples.length;
  }

  /** True when enough past-only history exists for FAST feature velocities. */
  hasWarmHistory(nowMs: number, minSpanMs = 3000): boolean {
    if (this.samples.length < 4) return false;
    const first = this.samples[0]!;
    const last = this.samples[this.samples.length - 1]!;
    return last.t - first.t >= minSpanMs && nowMs - last.t <= 2000;
  }

  private hl(windowMs: number, now: number): { hi: number; lo: number } {
    let hi = Number.NEGATIVE_INFINITY;
    let lo = Number.POSITIVE_INFINITY;
    const from = now - windowMs;
    for (let i = this.samples.length - 1; i >= 0; i--) {
      const s = this.samples[i]!;
      if (s.t < from) break;
      if (s.mid > hi) hi = s.mid;
      if (s.mid < lo) lo = s.mid;
    }
    if (!Number.isFinite(hi)) hi = this.samples[this.samples.length - 1]?.mid ?? 0;
    if (!Number.isFinite(lo)) lo = hi;
    return { hi, lo };
  }

  /**
   * Rolling high/low over [now-windowMs, now) — STRICTLY excludes the current
   * (latest) sample so a tick cannot self-confirm its own breakout.
   */
  private priorHl(windowMs: number, now: number): { hi: number; lo: number } {
    let hi = Number.NEGATIVE_INFINITY;
    let lo = Number.POSITIVE_INFINITY;
    const from = now - windowMs;
    const lastIdx = this.samples.length - 1;
    for (let i = lastIdx - 1; i >= 0; i--) {
      const s = this.samples[i]!;
      if (s.t < from) break;
      if (s.t > now) continue;
      if (s.mid > hi) hi = s.mid;
      if (s.mid < lo) lo = s.mid;
    }
    return { hi, lo };
  }

  private pathEfficiency(windowMs: number, now: number): number {
    const from = now - windowMs;
    const pts: number[] = [];
    for (const s of this.samples) {
      if (s.t >= from && s.t <= now) pts.push(s.mid);
    }
    if (pts.length < 2) return 0;
    let path = 0;
    for (let i = 1; i < pts.length; i++) path += Math.abs(pts[i]! - pts[i - 1]!);
    const net = Math.abs(pts[pts.length - 1]! - pts[0]!);
    return path > 0 ? net / path : 0;
  }

  snapshot(now: number, depth: DepthBookStats): GhFastFeatureSnapshot | null {
    if (this.samples.length < 2) return null;
    const cur = this.samples[this.samples.length - 1]!;
    const at = (lagMs: number) => sampleAtOrBefore(this.samples, now - lagMs);
    const b250 = at(250);
    const b500 = at(500);
    const b1 = at(1000);
    const b2 = at(2000);
    const b3 = at(3000);
    const midVel1 = b1 ? ret(cur.mid, b1.mid) : 0;
    const midVel3 = b3 ? ret(cur.mid, b3.mid) : 0;
    const acceleration = midVel1 - midVel3 / 3;

    let ups = 0;
    let downs = 0;
    let updates = 0;
    const from1 = now - 1000;
    for (let i = 1; i < this.samples.length; i++) {
      const a = this.samples[i - 1]!;
      const b = this.samples[i]!;
      if (b.t < from1) continue;
      updates += 1;
      if (b.mid > a.mid) ups += 1;
      else if (b.mid < a.mid) downs += 1;
    }
    const signedImbalance1s =
      ups + downs > 0 ? (ups - downs) / (ups + downs) : 0;

    const h1 = this.hl(1000, now);
    const h2 = this.hl(2000, now);
    const h5 = this.hl(5000, now);
    const h10 = this.hl(10_000, now);
    const h15 = this.hl(15_000, now);
    const h30 = this.hl(30_000, now);
    const p5 = this.priorHl(5000, now);
    const p10 = this.priorHl(10_000, now);
    const priorHigh5s = Number.isFinite(p5.hi) ? p5.hi : cur.mid;
    const priorLow5s = Number.isFinite(p5.lo) ? p5.lo : cur.mid;
    const priorHigh10s = Number.isFinite(p10.hi) ? p10.hi : cur.mid;
    const priorLow10s = Number.isFinite(p10.lo) ? p10.lo : cur.mid;

    return {
      bid: cur.bid,
      ask: cur.ask,
      mid: cur.mid,
      spread: cur.ask - cur.bid,
      bidVel250: b250 ? ret(cur.bid, b250.bid) : 0,
      bidVel500: b500 ? ret(cur.bid, b500.bid) : 0,
      bidVel1s: b1 ? ret(cur.bid, b1.bid) : 0,
      bidVel2s: b2 ? ret(cur.bid, b2.bid) : 0,
      bidVel3s: b3 ? ret(cur.bid, b3.bid) : 0,
      askVel1s: b1 ? ret(cur.ask, b1.ask) : 0,
      midVel250: b250 ? ret(cur.mid, b250.mid) : 0,
      midVel500: b500 ? ret(cur.mid, b500.mid) : 0,
      midVel1s: midVel1,
      midVel2s: b2 ? ret(cur.mid, b2.mid) : 0,
      midVel3s: midVel3,
      acceleration,
      updateRate1s: updates,
      signedImbalance1s,
      efficiency1s: this.pathEfficiency(1000, now),
      efficiency3s: this.pathEfficiency(3000, now),
      high1s: h1.hi,
      low1s: h1.lo,
      high2s: h2.hi,
      low2s: h2.lo,
      high5s: h5.hi,
      low5s: h5.lo,
      high10s: h10.hi,
      low10s: h10.lo,
      high15s: h15.hi,
      low15s: h15.lo,
      high30s: h30.hi,
      low30s: h30.lo,
      priorHigh5s,
      priorLow5s,
      priorHigh10s,
      priorLow10s,
      distHigh1s: h1.hi - cur.mid,
      distLow1s: cur.mid - h1.lo,
      distHigh5s: h5.hi - cur.mid,
      distLow5s: cur.mid - h5.lo,
      distPriorHigh5s: priorHigh5s - cur.mid,
      distPriorLow5s: cur.mid - priorLow5s,
      upTouches5s: this.upTouches,
      downTouches5s: this.downTouches,
      depth
    };
  }
}
