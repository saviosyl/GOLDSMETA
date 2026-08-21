import type { GhFastConfig, GhFastSide } from "./types";
import type { GhFastFeatureSnapshot } from "./features";

const EPSILON = 1e-9;
const ONE_MINUTE_MS = 60_000;

export type M1CandleDirection = "BULL" | "BEAR" | "FLAT";
export type PulseMarketRegime = "TREND_UP" | "TREND_DOWN" | "RANGE" | "TRANSITION";

export type M1Candle = {
  startMs: number;
  endMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  range: number;
  body: number;
  bodyAbs: number;
  bodyRatio: number;
  closeLocation: number;
  direction: M1CandleDirection;
};

export type M1CandleFlowStage =
  | "REGIME"
  | "IMPULSE"
  | "RETRACE"
  | "HOLD"
  | "BREAK"
  | "TRIGGERED";

export type M1CandleFlowWaitReason =
  | "WAIT_CANDLE_DIRECTION_UNCLEAR"
  | "WAIT_CANDLE_TOO_EARLY"
  | "WAIT_CANDLE_TOO_LATE"
  | "WAIT_PULLBACK_NOT_SEEN"
  | "WAIT_PULLBACK_STILL_FALLING"
  | "WAIT_MICROSTRUCTURE_NOT_CONFIRMED"
  | "WAIT_CANDLE_OVEREXTENDED"
  | "WAIT_INSUFFICIENT_REWARD_SPACE"
  | "WAIT_QUALITY_BELOW_MIN"
  | "WAIT_NO_VALID_PULSE"
  | "WAIT_PULLBACK_TOO_SHALLOW"
  | "WAIT_PULSE_INVALIDATED"
  | "WAIT_BASE_NOT_CONFIRMED"
  | "WAIT_CONTINUATION_NOT_CONFIRMED"
  | "WAIT_MICROSTRUCTURE_VETO"
  | "WAIT_CHOP"
  | "WAIT_PULSE_EXHAUSTED"
  | "WAIT_NO_EDGE_LEFT"
  | "WAIT_REGIME_RESET_AFTER_LOSSES"
  | "WAIT_CANDLE_ENTRY_LIMIT_REACHED"
  | "WAIT_PULSE_ALREADY_TRADED";

export type M1CandleFlowEvaluation = {
  eligible: boolean;
  side: GhFastSide | null;
  waitReason: M1CandleFlowWaitReason | null;
  stage: M1CandleFlowStage | null;
  regime: PulseMarketRegime | null;
  regimeEpoch: number | null;
  pulseId: string | null;
  pulseDirection: GhFastSide | null;
  pulseStart: number | null;
  pulseExtreme: number | null;
  pulseDistance: number | null;
  pulseDurationSec: number | null;
  pulseEfficiency: number | null;
  retracementPct: number | null;
  baseHoldTicks: number | null;
  baseHoldDurationMs: number | null;
  continuationBreakLevel: number | null;
  currentCandleStartMs: number | null;
  currentCandleAgeSec: number | null;
  currentM1Open: number | null;
  currentM1High: number | null;
  currentM1Low: number | null;
  currentM1Displacement: number | null;
  signalRange: number | null;
  medianRange5: number | null;
  directionalDisplacement: number | null;
  remainingExpectedRange: number | null;
  pullbackRatio: number | null;
  reclaimDistance: number | null;
  recentNoise: number | null;
  remainingMovementBudget: number | null;
  pulseHealthAtEntry: number | null;
  entryQuality: number;
  candleTrendScore: number;
  pullbackScore: number;
  microstructureScore: number;
  rewardSpaceScore: number;
  finalQuality: number;
  qualityThreshold: number;
  reasons: string[];
  latestClosedCandle: M1Candle | null;
  previousClosedCandle: M1Candle | null;
};

type FormingCandle = {
  startMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type M1CandleTrackerSnapshot = {
  current: M1Candle | null;
  closed: M1Candle[];
  medianRange5: number | null;
};

type PulseState = {
  candleStartMs: number;
  side: GhFastSide;
  stage: M1CandleFlowStage;
  pulseId: string;
  regimeEpoch: number;
  pulseStart: number;
  pulseExtreme: number;
  pulseStartedAtMs: number;
  retraceExtreme: number | null;
  retracementPct: number | null;
  holdStartedAtMs: number | null;
  holdTicks: number;
  continuationBreakLevel: number | null;
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function toMinuteStartMs(tsMs: number): number {
  return Math.floor(tsMs / ONE_MINUTE_MS) * ONE_MINUTE_MS;
}

function candleDirection(open: number, close: number): M1CandleDirection {
  if (close > open) return "BULL";
  if (close < open) return "BEAR";
  return "FLAT";
}

function asM1Candle(candle: FormingCandle): M1Candle {
  const range = Math.max(candle.high - candle.low, 0);
  const body = candle.close - candle.open;
  const denom = Math.max(range, EPSILON);
  return {
    startMs: candle.startMs,
    endMs: candle.startMs + ONE_MINUTE_MS,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    range,
    body,
    bodyAbs: Math.abs(body),
    bodyRatio: Math.abs(body) / denom,
    closeLocation: clamp01((candle.close - candle.low) / denom),
    direction: candleDirection(candle.open, candle.close)
  };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function classifyRegime(args: {
  closed: M1Candle[];
  current: M1Candle;
  medianRange5: number | null;
}): {
  regime: PulseMarketRegime;
  side: GhFastSide | null;
  trendScore: number;
  pathEfficiency: number;
  directionalPersistence: number;
} {
  const { closed, current, medianRange5 } = args;
  const tail = closed.slice(-3);
  if (tail.length < 3 || medianRange5 == null) {
    return {
      regime: "TRANSITION",
      side: null,
      trendScore: 0,
      pathEfficiency: 0,
      directionalPersistence: 0
    };
  }
  const first = tail[0]!;
  const last = tail[2]!;
  const net = current.close - first.open;
  const sumRange =
    tail.reduce((acc, c) => acc + Math.max(c.range, 0), 0) +
    Math.max(current.range, 0);
  const pathEfficiency = Math.abs(net) / Math.max(sumRange, EPSILON);
  const upPersistence =
    tail.filter((c) => c.direction === "BULL").length +
    Number(current.direction === "BULL");
  const downPersistence =
    tail.filter((c) => c.direction === "BEAR").length +
    Number(current.direction === "BEAR");
  const directionalPersistence = Math.max(upPersistence, downPersistence) / 4;
  const netNorm = Math.abs(net) / Math.max(medianRange5 * 2.5, EPSILON);
  const upStructure =
    tail[0]!.high <= tail[1]!.high &&
    tail[1]!.high <= tail[2]!.high &&
    tail[0]!.low <= tail[1]!.low &&
    tail[1]!.low <= tail[2]!.low &&
    current.high >= last.high;
  const downStructure =
    tail[0]!.high >= tail[1]!.high &&
    tail[1]!.high >= tail[2]!.high &&
    tail[0]!.low >= tail[1]!.low &&
    tail[1]!.low >= tail[2]!.low &&
    current.low <= last.low;
  const trendScore = clamp01(
    0.45 * netNorm + 0.35 * pathEfficiency + 0.2 * directionalPersistence
  );

  if (pathEfficiency < 0.14 && Math.abs(net) < medianRange5 * 0.2) {
    return {
      regime: "RANGE",
      side: null,
      trendScore,
      pathEfficiency,
      directionalPersistence
    };
  }

  if (
    net > 0 &&
    upPersistence >= 3 &&
    (upStructure || directionalPersistence >= 0.7) &&
    trendScore >= 0.35 &&
    pathEfficiency >= 0.14
  ) {
    return {
      regime: "TREND_UP",
      side: "BUY",
      trendScore,
      pathEfficiency,
      directionalPersistence
    };
  }
  if (
    net < 0 &&
    downPersistence >= 3 &&
    (downStructure || directionalPersistence >= 0.7) &&
    trendScore >= 0.35 &&
    pathEfficiency >= 0.14
  ) {
    return {
      regime: "TREND_DOWN",
      side: "SELL",
      trendScore,
      pathEfficiency,
      directionalPersistence
    };
  }
  return {
    regime: "TRANSITION",
    side: null,
    trendScore,
    pathEfficiency,
    directionalPersistence
  };
}

function microstructureScoreForSide(
  side: GhFastSide,
  f: GhFastFeatureSnapshot
): { score: number; veto: boolean } {
  const velAligned =
    side === "BUY"
      ? f.midVel250 > 0 && f.midVel500 > 0 && f.midVel1s > 0
      : f.midVel250 < 0 && f.midVel500 < 0 && f.midVel1s < 0;
  const imbalanceAligned =
    side === "BUY" ? f.signedImbalance1s > 0.1 : f.signedImbalance1s < -0.1;
  const depthNotHostile =
    side === "BUY"
      ? f.depth.depthImbalance >= -0.2
      : f.depth.depthImbalance <= 0.2;
  const removalSupportive =
    side === "BUY"
      ? f.depth.removeRateAsk >= f.depth.removeRateBid * 0.8
      : f.depth.removeRateBid >= f.depth.removeRateAsk * 0.8;
  const efficiencyAligned = f.efficiency1s >= 0.35;
  const checks = [
    velAligned,
    imbalanceAligned,
    depthNotHostile,
    removalSupportive,
    efficiencyAligned
  ];
  const passed = checks.filter(Boolean).length;
  const veto = !velAligned || passed < 4;
  return { score: passed / checks.length, veto };
}

function pulseHealthScore(args: {
  side: GhFastSide;
  currentR: number;
  mfeR: number;
  f: GhFastFeatureSnapshot;
}): number {
  const velScore = clamp01(
    args.side === "BUY"
      ? args.f.midVel250 > 0 && args.f.midVel500 > 0
        ? 1
        : 0
      : args.f.midVel250 < 0 && args.f.midVel500 < 0
        ? 1
        : 0
  );
  const flowScore = clamp01(
    args.side === "BUY" ? args.f.signedImbalance1s : -args.f.signedImbalance1s
  );
  const efficiency = clamp01(args.f.efficiency1s);
  const progress = clamp01((args.currentR + 0.5) / 1.2);
  const retention = clamp01(
    args.mfeR <= 0 ? 0 : 1 - Math.max(0, args.mfeR - args.currentR) / (args.mfeR + EPSILON)
  );
  return Math.round(
    100 *
      clamp01(
        0.25 * velScore +
          0.25 * flowScore +
          0.2 * efficiency +
          0.2 * progress +
          0.1 * retention
      )
  );
}

export class M1CandleTracker {
  private forming: FormingCandle | null = null;
  private closed: M1Candle[] = [];

  clear(): void {
    this.forming = null;
    this.closed = [];
  }

  onMidPrice(receivedAtMs: number, mid: number): void {
    if (!Number.isFinite(mid) || mid <= 0) return;
    const minuteStart = toMinuteStartMs(receivedAtMs);
    if (!this.forming) {
      this.forming = {
        startMs: minuteStart,
        open: mid,
        high: mid,
        low: mid,
        close: mid
      };
      return;
    }

    if (minuteStart !== this.forming.startMs) {
      const previous = asM1Candle(this.forming);
      this.pushClosed(previous);
      let cursor = this.forming.startMs + ONE_MINUTE_MS;
      let carry = previous.close;
      while (cursor < minuteStart) {
        const synthetic = asM1Candle({
          startMs: cursor,
          open: carry,
          high: carry,
          low: carry,
          close: carry
        });
        this.pushClosed(synthetic);
        carry = synthetic.close;
        cursor += ONE_MINUTE_MS;
      }
      this.forming = {
        startMs: minuteStart,
        open: mid,
        high: mid,
        low: mid,
        close: mid
      };
      return;
    }

    this.forming.high = Math.max(this.forming.high, mid);
    this.forming.low = Math.min(this.forming.low, mid);
    this.forming.close = mid;
  }

  snapshot(): M1CandleTrackerSnapshot {
    const current = this.forming ? asM1Candle(this.forming) : null;
    const closed = this.closed.slice(-10);
    const last5 = closed.slice(-5);
    return {
      current,
      closed,
      medianRange5:
        last5.length >= 5 ? median(last5.map((c) => Math.max(c.range, 0))) : null
    };
  }

  private pushClosed(candle: M1Candle): void {
    this.closed.push(candle);
    if (this.closed.length > 30) {
      this.closed = this.closed.slice(-30);
    }
  }
}

export class M1CandleFlowEngine {
  private state: PulseState | null = null;
  private regimeEpoch = 0;
  private lastRegime: PulseMarketRegime | null = null;
  private pulseSerial = 0;

  constructor(private readonly tracker: M1CandleTracker = new M1CandleTracker()) {}

  clear(): void {
    this.state = null;
    this.regimeEpoch = 0;
    this.lastRegime = null;
    this.pulseSerial = 0;
    this.tracker.clear();
  }

  onSpot(receivedAtMs: number, mid: number): void {
    this.tracker.onMidPrice(receivedAtMs, mid);
  }

  snapshotCandleTracker(): M1CandleTrackerSnapshot {
    return this.tracker.snapshot();
  }

  evaluate(
    nowMs: number,
    f: GhFastFeatureSnapshot,
    cfg: GhFastConfig
  ): M1CandleFlowEvaluation {
    const tracker = this.tracker.snapshot();
    const current = tracker.current;
    const latestClosed = tracker.closed.at(-1) ?? null;
    const previousClosed = tracker.closed.at(-2) ?? null;
    const base: M1CandleFlowEvaluation = {
      eligible: false,
      side: null,
      waitReason: "WAIT_NO_VALID_PULSE",
      stage: this.state?.stage ?? null,
      regime: this.lastRegime,
      regimeEpoch: this.regimeEpoch || null,
      pulseId: this.state?.pulseId ?? null,
      pulseDirection: this.state?.side ?? null,
      pulseStart: this.state?.pulseStart ?? null,
      pulseExtreme: this.state?.pulseExtreme ?? null,
      pulseDistance: null,
      pulseDurationSec: null,
      pulseEfficiency: null,
      retracementPct: this.state?.retracementPct ?? null,
      baseHoldTicks: this.state?.holdTicks ?? null,
      baseHoldDurationMs:
        this.state?.holdStartedAtMs != null
          ? Math.max(0, nowMs - this.state.holdStartedAtMs)
          : null,
      continuationBreakLevel: this.state?.continuationBreakLevel ?? null,
      currentCandleStartMs: current?.startMs ?? null,
      currentCandleAgeSec: current
        ? Math.max(0, Math.floor((nowMs - current.startMs) / 1000))
        : null,
      currentM1Open: current?.open ?? null,
      currentM1High: current?.high ?? null,
      currentM1Low: current?.low ?? null,
      currentM1Displacement: null,
      signalRange: latestClosed?.range ?? null,
      medianRange5: tracker.medianRange5,
      directionalDisplacement: null,
      remainingExpectedRange: null,
      pullbackRatio: null,
      reclaimDistance: null,
      recentNoise: null,
      remainingMovementBudget: null,
      pulseHealthAtEntry: null,
      entryQuality: 0,
      candleTrendScore: 0,
      pullbackScore: 0,
      microstructureScore: 0,
      rewardSpaceScore: 0,
      finalQuality: 0,
      qualityThreshold: 0.62,
      reasons: [],
      latestClosedCandle: latestClosed,
      previousClosedCandle: previousClosed
    };

    if (!current || !latestClosed || !previousClosed || tracker.medianRange5 == null) {
      return base;
    }

    const regime = classifyRegime({
      closed: tracker.closed,
      current,
      medianRange5: tracker.medianRange5
    });
    if (this.lastRegime !== regime.regime) {
      this.regimeEpoch += 1;
      this.lastRegime = regime.regime;
    }

    const side = regime.side;
    const currentM1Displacement = current.close - current.open;
    const recentNoise = Math.max(
      Math.max(0, f.high5s - f.low5s) * 0.7,
      tracker.medianRange5 * 0.22,
      Math.max(0, f.spread) * 1.5,
      cfg.friction * 1.2,
      0.08
    );
    const directionalDisplacement =
      side === "BUY"
        ? Math.max(0, current.close - current.open)
        : side === "SELL"
          ? Math.max(0, current.open - current.close)
          : 0;
    const remainingExpectedRange = Math.max(
      tracker.medianRange5 - directionalDisplacement,
      0
    );
    const requiredBudget = Math.max(
      0.75 * cfg.hardStop +
        cfg.friction * 0.6 +
        Math.max(0, f.spread) * 0.5 +
        recentNoise * 0.2,
      cfg.hardStop * 0.45
    );
    const rewardSpaceScore = clamp01(
      remainingExpectedRange / Math.max(requiredBudget * 1.6, EPSILON)
    );
    const shared = {
      ...base,
      regime: regime.regime,
      regimeEpoch: this.regimeEpoch,
      side,
      currentCandleStartMs: current.startMs,
      currentCandleAgeSec: Math.max(0, Math.floor((nowMs - current.startMs) / 1000)),
      currentM1Open: current.open,
      currentM1High: current.high,
      currentM1Low: current.low,
      currentM1Displacement,
      directionalDisplacement,
      remainingExpectedRange,
      recentNoise,
      remainingMovementBudget: remainingExpectedRange
    };

    if (regime.regime === "RANGE") {
      this.state = null;
      return {
        ...shared,
        waitReason: "WAIT_CHOP",
        stage: "REGIME",
        candleTrendScore: regime.trendScore,
        rewardSpaceScore,
        reasons: ["range_regime_rejected"]
      };
    }
    if (regime.regime === "TRANSITION" || !side) {
      this.state = null;
      return {
        ...shared,
        waitReason: "WAIT_NO_VALID_PULSE",
        stage: "REGIME",
        candleTrendScore: regime.trendScore,
        rewardSpaceScore,
        reasons: ["transition_regime_rejected"]
      };
    }

    if (
      !this.state ||
      this.state.candleStartMs !== current.startMs ||
      this.state.side !== side ||
      this.state.regimeEpoch !== this.regimeEpoch
    ) {
      this.pulseSerial += 1;
      this.state = {
        candleStartMs: current.startMs,
        side,
        stage: "IMPULSE",
        pulseId: `PS-${current.startMs}-${side}-${this.pulseSerial}`,
        regimeEpoch: this.regimeEpoch,
        pulseStart: current.open,
        pulseExtreme: f.mid,
        pulseStartedAtMs: nowMs,
        retraceExtreme: null,
        retracementPct: null,
        holdStartedAtMs: null,
        holdTicks: 0,
        continuationBreakLevel: null
      };
    }

    const state = this.state;
    if (state.stage === "IMPULSE" || state.stage === "RETRACE") {
      state.pulseExtreme =
        side === "BUY"
          ? Math.max(state.pulseExtreme, f.mid)
          : Math.min(state.pulseExtreme, f.mid);
    }
    const pulseDistance =
      side === "BUY"
        ? Math.max(0, state.pulseExtreme - state.pulseStart)
        : Math.max(0, state.pulseStart - state.pulseExtreme);
    const pulseDurationSec = Math.max(0, (nowMs - state.pulseStartedAtMs) / 1000);
    const pulseEfficiency = clamp01(
      pulseDistance / Math.max(current.range, recentNoise * 1.1, EPSILON)
    );

    if (current.range > recentNoise * 1.65 && regime.pathEfficiency < 0.26) {
      return {
        ...shared,
        stage: state.stage,
        pulseId: state.pulseId,
        pulseDirection: side,
        pulseStart: state.pulseStart,
        pulseExtreme: state.pulseExtreme,
        pulseDistance,
        pulseDurationSec,
        pulseEfficiency,
        waitReason: "WAIT_CHOP",
        candleTrendScore: regime.trendScore,
        rewardSpaceScore,
        reasons: ["chop_filter_triggered"]
      };
    }

    if (pulseDistance < recentNoise * 0.6 || pulseEfficiency < 0.25) {
      state.stage = "IMPULSE";
      return {
        ...shared,
        stage: state.stage,
        pulseId: state.pulseId,
        pulseDirection: side,
        pulseStart: state.pulseStart,
        pulseExtreme: state.pulseExtreme,
        pulseDistance,
        pulseDurationSec,
        pulseEfficiency,
        waitReason: "WAIT_NO_VALID_PULSE",
        candleTrendScore: regime.trendScore,
        rewardSpaceScore,
        reasons: ["impulse_not_meaningful_vs_noise"]
      };
    }

    const retraceDistance =
      side === "BUY"
        ? Math.max(0, state.pulseExtreme - f.mid)
        : Math.max(0, f.mid - state.pulseExtreme);
    const retracementPct = (retraceDistance / Math.max(pulseDistance, EPSILON)) * 100;
    const pullbackRatio = retraceDistance / Math.max(pulseDistance, EPSILON);
    const adaptiveTolPct = Math.min(
      10,
      Math.max(4, (recentNoise / Math.max(pulseDistance, EPSILON)) * 25)
    );
    const pullbackMinPct = 25 - adaptiveTolPct;
    const pullbackMaxPct = 45 + adaptiveTolPct;
    const previousStage = state.stage;
    const retraceLocked =
      previousStage === "HOLD" ||
      previousStage === "BREAK" ||
      previousStage === "TRIGGERED" ||
      state.continuationBreakLevel != null;
    state.retracementPct = retracementPct;
    state.stage = "RETRACE";

    if (!retraceLocked && retracementPct < pullbackMinPct) {
      return {
        ...shared,
        stage: state.stage,
        pulseId: state.pulseId,
        pulseDirection: side,
        pulseStart: state.pulseStart,
        pulseExtreme: state.pulseExtreme,
        pulseDistance,
        pulseDurationSec,
        pulseEfficiency,
        pullbackRatio,
        retracementPct,
        waitReason: "WAIT_PULLBACK_TOO_SHALLOW",
        candleTrendScore: regime.trendScore,
        rewardSpaceScore,
        reasons: ["retrace_below_adaptive_minimum"]
      };
    }

    const pulseInvalidated =
      retracementPct > pullbackMaxPct + 8 ||
      (side === "BUY" && f.mid <= state.pulseStart - recentNoise * 0.1) ||
      (side === "SELL" && f.mid >= state.pulseStart + recentNoise * 0.1);
    if (pulseInvalidated) {
      this.state = {
        ...state,
        stage: "IMPULSE",
        pulseStart: f.mid,
        pulseExtreme: f.mid,
        pulseStartedAtMs: nowMs,
        retraceExtreme: null,
        retracementPct: null,
        holdStartedAtMs: null,
        holdTicks: 0,
        continuationBreakLevel: null
      };
      return {
        ...shared,
        stage: "RETRACE",
        pulseId: state.pulseId,
        pulseDirection: side,
        pulseStart: state.pulseStart,
        pulseExtreme: state.pulseExtreme,
        pulseDistance,
        pulseDurationSec,
        pulseEfficiency,
        pullbackRatio,
        retracementPct,
        waitReason: "WAIT_PULSE_INVALIDATED",
        candleTrendScore: regime.trendScore,
        rewardSpaceScore,
        reasons: ["retrace_broke_pulse_structure"]
      };
    }

    if (state.retraceExtreme == null) {
      state.retraceExtreme = f.mid;
      state.holdStartedAtMs = nowMs;
      state.holdTicks = 1;
      return {
        ...shared,
        stage: "RETRACE",
        pulseId: state.pulseId,
        pulseDirection: side,
        pulseStart: state.pulseStart,
        pulseExtreme: state.pulseExtreme,
        pulseDistance,
        pulseDurationSec,
        pulseEfficiency,
        pullbackRatio,
        retracementPct,
        waitReason: "WAIT_BASE_NOT_CONFIRMED",
        candleTrendScore: regime.trendScore,
        rewardSpaceScore,
        reasons: ["base_initializing"]
      };
    }

    const improvedAdverse =
      side === "BUY" ? f.mid < state.retraceExtreme : f.mid > state.retraceExtreme;
    if (improvedAdverse) {
      state.retraceExtreme = f.mid;
      state.holdStartedAtMs = nowMs;
      state.holdTicks = 1;
    } else {
      state.holdTicks += 1;
    }
    const holdDurationMs =
      state.holdStartedAtMs == null ? 0 : Math.max(0, nowMs - state.holdStartedAtMs);
    const baseConfirmed = state.holdTicks >= 3 && holdDurationMs >= 1_200;
    if (!baseConfirmed) {
      state.stage = "HOLD";
      return {
        ...shared,
        stage: state.stage,
        pulseId: state.pulseId,
        pulseDirection: side,
        pulseStart: state.pulseStart,
        pulseExtreme: state.pulseExtreme,
        pulseDistance,
        pulseDurationSec,
        pulseEfficiency,
        pullbackRatio,
        retracementPct,
        baseHoldTicks: state.holdTicks,
        baseHoldDurationMs: holdDurationMs,
        waitReason: "WAIT_BASE_NOT_CONFIRMED",
        candleTrendScore: regime.trendScore,
        rewardSpaceScore,
        reasons: ["hold_not_stable_enough"]
      };
    }

    if (state.continuationBreakLevel == null) {
      state.continuationBreakLevel =
        side === "BUY"
          ? state.retraceExtreme + Math.max(pulseDistance * 0.18, recentNoise * 0.15)
          : state.retraceExtreme - Math.max(pulseDistance * 0.18, recentNoise * 0.15);
    }
    const continuationConfirmed =
      side === "BUY"
        ? f.mid >= state.continuationBreakLevel
        : f.mid <= state.continuationBreakLevel;
    if (!continuationConfirmed) {
      state.stage = "BREAK";
      return {
        ...shared,
        stage: state.stage,
        pulseId: state.pulseId,
        pulseDirection: side,
        pulseStart: state.pulseStart,
        pulseExtreme: state.pulseExtreme,
        pulseDistance,
        pulseDurationSec,
        pulseEfficiency,
        pullbackRatio,
        retracementPct,
        baseHoldTicks: state.holdTicks,
        baseHoldDurationMs: holdDurationMs,
        continuationBreakLevel: state.continuationBreakLevel,
        waitReason: "WAIT_CONTINUATION_NOT_CONFIRMED",
        candleTrendScore: regime.trendScore,
        rewardSpaceScore,
        reasons: ["continuation_break_not_seen"]
      };
    }

    const exhaustionFlags =
      Number(Math.abs(f.midVel250) < Math.abs(f.midVel500) * 0.75) +
      Number(f.efficiency1s < 0.32) +
      Number(retracementPct > 55) +
      Number(remainingExpectedRange < recentNoise * 0.6);
    if (exhaustionFlags >= 2) {
      return {
        ...shared,
        stage: "BREAK",
        pulseId: state.pulseId,
        pulseDirection: side,
        pulseStart: state.pulseStart,
        pulseExtreme: state.pulseExtreme,
        pulseDistance,
        pulseDurationSec,
        pulseEfficiency,
        pullbackRatio,
        retracementPct,
        continuationBreakLevel: state.continuationBreakLevel,
        waitReason: "WAIT_PULSE_EXHAUSTED",
        candleTrendScore: regime.trendScore,
        rewardSpaceScore,
        reasons: ["exhaustion_filter_triggered"]
      };
    }

    if (remainingExpectedRange < requiredBudget) {
      return {
        ...shared,
        stage: "BREAK",
        pulseId: state.pulseId,
        pulseDirection: side,
        pulseStart: state.pulseStart,
        pulseExtreme: state.pulseExtreme,
        pulseDistance,
        pulseDurationSec,
        pulseEfficiency,
        pullbackRatio,
        retracementPct,
        continuationBreakLevel: state.continuationBreakLevel,
        waitReason: "WAIT_NO_EDGE_LEFT",
        candleTrendScore: regime.trendScore,
        rewardSpaceScore,
        reasons: ["movement_budget_insufficient"]
      };
    }

    const micro = microstructureScoreForSide(side, f);
    if (micro.veto) {
      return {
        ...shared,
        stage: "BREAK",
        pulseId: state.pulseId,
        pulseDirection: side,
        pulseStart: state.pulseStart,
        pulseExtreme: state.pulseExtreme,
        pulseDistance,
        pulseDurationSec,
        pulseEfficiency,
        pullbackRatio,
        retracementPct,
        continuationBreakLevel: state.continuationBreakLevel,
        waitReason: "WAIT_MICROSTRUCTURE_VETO",
        candleTrendScore: regime.trendScore,
        microstructureScore: micro.score,
        rewardSpaceScore,
        reasons: ["microstructure_veto"]
      };
    }

    const pullbackShapeScore = clamp01(
      1 - Math.abs(retracementPct - 35) / Math.max(22 + adaptiveTolPct, EPSILON)
    );
    const holdScore = clamp01(state.holdTicks / 5);
    const pullbackScore = clamp01(0.65 * pullbackShapeScore + 0.35 * holdScore);
    const candleTrendScore = clamp01(regime.trendScore);
    const finalQuality = clamp01(
      0.3 * candleTrendScore +
        0.25 * pullbackScore +
        0.25 * micro.score +
        0.2 * rewardSpaceScore
    );
    const currentR = 0;
    const pulseHealth = pulseHealthScore({
      side,
      currentR,
      mfeR: pulseDistance / Math.max(cfg.hardStop, EPSILON),
      f
    });

    state.stage = "TRIGGERED";
    return {
      ...shared,
      eligible: true,
      side,
      waitReason: null,
      stage: state.stage,
      regime: regime.regime,
      regimeEpoch: this.regimeEpoch,
      pulseId: state.pulseId,
      pulseDirection: side,
      pulseStart: state.pulseStart,
      pulseExtreme: state.pulseExtreme,
      pulseDistance,
      pulseDurationSec,
      pulseEfficiency,
      retracementPct,
      baseHoldTicks: state.holdTicks,
      baseHoldDurationMs: holdDurationMs,
      continuationBreakLevel: state.continuationBreakLevel,
      pullbackRatio,
      reclaimDistance:
        side === "BUY"
          ? Math.max(0, f.mid - (state.retraceExtreme ?? f.mid))
          : Math.max(0, (state.retraceExtreme ?? f.mid) - f.mid),
      pulseHealthAtEntry: pulseHealth,
      entryQuality: finalQuality,
      candleTrendScore,
      pullbackScore,
      microstructureScore: micro.score,
      rewardSpaceScore,
      finalQuality,
      reasons: [
        "regime_trend_confirmed",
        "impulse_retrace_hold_break_confirmed",
        "microstructure_confirmation_passed",
        "movement_budget_passed"
      ]
    };
  }
}
