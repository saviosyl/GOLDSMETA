import type { GhFastConfig, GhFastSide } from "./types";
import type { GhFastFeatureSnapshot } from "./features";

const EPSILON = 1e-9;
const ONE_MINUTE_MS = 60_000;

export type M1CandleDirection = "BULL" | "BEAR" | "FLAT";

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
  | "BIAS"
  | "PULLBACK_SEEN"
  | "REACCELERATING"
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
  | "WAIT_QUALITY_BELOW_MIN";

export type M1CandleFlowEvaluation = {
  eligible: boolean;
  side: GhFastSide | null;
  waitReason: M1CandleFlowWaitReason | null;
  stage: M1CandleFlowStage | null;
  currentCandleStartMs: number | null;
  currentCandleAgeSec: number | null;
  signalRange: number | null;
  medianRange5: number | null;
  directionalDisplacement: number | null;
  remainingExpectedRange: number | null;
  pullbackRatio: number | null;
  reclaimDistance: number | null;
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

type CandleFlowState = {
  candleStartMs: number;
  side: GhFastSide | null;
  stage: M1CandleFlowStage;
  directionalExtreme: number;
  pullbackExtreme: number | null;
  signalRange: number;
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

function isCurrentStructurallyAgainstSide(
  current: M1Candle,
  side: GhFastSide
): boolean {
  if (side === "BUY") {
    return (
      current.direction === "BEAR" &&
      current.bodyRatio >= 0.55 &&
      current.closeLocation <= 0.35
    );
  }
  return (
    current.direction === "BULL" &&
    current.bodyRatio >= 0.55 &&
    current.closeLocation >= 0.65
  );
}

function microstructureScoreForSide(
  side: GhFastSide,
  f: GhFastFeatureSnapshot
): { score: number; allPassed: boolean } {
  const checks =
    side === "BUY"
      ? [
          f.midVel250 > 0,
          f.midVel500 > 0,
          f.midVel1s > 0,
          f.signedImbalance1s > 0.15,
          f.depth.depthImbalance >= -0.15 &&
            f.depth.removeRateAsk >= f.depth.removeRateBid,
          f.efficiency1s >= 0.35
        ]
      : [
          f.midVel250 < 0,
          f.midVel500 < 0,
          f.midVel1s < 0,
          f.signedImbalance1s < -0.15,
          f.depth.depthImbalance <= 0.15 &&
            f.depth.removeRateBid >= f.depth.removeRateAsk,
          f.efficiency1s >= 0.35
        ];
  const passed = checks.filter(Boolean).length;
  return { score: passed / checks.length, allPassed: passed === checks.length };
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
    const closed = this.closed.slice(-8);
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
    if (this.closed.length > 20) {
      this.closed = this.closed.slice(-20);
    }
  }
}

export class M1CandleFlowEngine {
  private state: CandleFlowState | null = null;

  constructor(private readonly tracker: M1CandleTracker = new M1CandleTracker()) {}

  clear(): void {
    this.state = null;
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
      waitReason: "WAIT_CANDLE_DIRECTION_UNCLEAR",
      stage: this.state?.stage ?? null,
      currentCandleStartMs: current?.startMs ?? null,
      currentCandleAgeSec: current
        ? Math.max(0, Math.floor((nowMs - current.startMs) / 1000))
        : null,
      signalRange: latestClosed?.range ?? null,
      medianRange5: tracker.medianRange5,
      directionalDisplacement: null,
      remainingExpectedRange: null,
      pullbackRatio: null,
      reclaimDistance: null,
      candleTrendScore: 0,
      pullbackScore: 0,
      microstructureScore: 0,
      rewardSpaceScore: 0,
      finalQuality: 0,
      qualityThreshold: 0.7,
      reasons: [],
      latestClosedCandle: latestClosed,
      previousClosedCandle: previousClosed
    };

    if (!current || !latestClosed || !previousClosed || tracker.medianRange5 == null) {
      return base;
    }

    const signalRange = Math.max(latestClosed.range, EPSILON);
    const ageSec = Math.max(0, Math.floor((nowMs - current.startMs) / 1000));
    let side: GhFastSide | null = null;
    const buyBias =
      latestClosed.direction === "BULL" &&
      latestClosed.bodyRatio >= 0.55 &&
      latestClosed.closeLocation >= 0.7 &&
      latestClosed.close > previousClosed.close &&
      !isCurrentStructurallyAgainstSide(current, "BUY");
    const sellBias =
      latestClosed.direction === "BEAR" &&
      latestClosed.bodyRatio >= 0.55 &&
      latestClosed.closeLocation <= 0.3 &&
      latestClosed.close < previousClosed.close &&
      !isCurrentStructurallyAgainstSide(current, "SELL");

    if (buyBias === sellBias) {
      return base;
    }
    side = buyBias ? "BUY" : "SELL";

    if (!this.state || this.state.candleStartMs !== current.startMs) {
      this.state = {
        candleStartMs: current.startMs,
        side,
        stage: "BIAS",
        directionalExtreme: f.mid,
        pullbackExtreme: null,
        signalRange
      };
    }

    if (this.state.side !== side) {
      this.state = {
        candleStartMs: current.startMs,
        side,
        stage: "BIAS",
        directionalExtreme: f.mid,
        pullbackExtreme: null,
        signalRange
      };
    }
    this.state.signalRange = signalRange;

    this.state.directionalExtreme =
      side === "BUY"
        ? Math.max(this.state.directionalExtreme, f.mid)
        : Math.min(this.state.directionalExtreme, f.mid);

    if (ageSec < 8) {
      return {
        ...base,
        side,
        waitReason: "WAIT_CANDLE_TOO_EARLY",
        stage: this.state.stage,
        currentCandleStartMs: current.startMs,
        currentCandleAgeSec: ageSec,
        reasons: ["candle_age_below_8s"]
      };
    }
    if (ageSec > 48) {
      return {
        ...base,
        side,
        waitReason: "WAIT_CANDLE_TOO_LATE",
        stage: this.state.stage,
        currentCandleStartMs: current.startMs,
        currentCandleAgeSec: ageSec,
        reasons: ["candle_age_above_48s"]
      };
    }

    const directionalDisplacement =
      side === "BUY"
        ? Math.max(0, f.mid - current.open)
        : Math.max(0, current.open - f.mid);
    const remainingExpectedRange = tracker.medianRange5 - directionalDisplacement;
    if (directionalDisplacement > 0.7 * tracker.medianRange5 || remainingExpectedRange <= EPSILON) {
      return {
        ...base,
        side,
        waitReason: "WAIT_CANDLE_OVEREXTENDED",
        stage: this.state.stage,
        currentCandleStartMs: current.startMs,
        currentCandleAgeSec: ageSec,
        directionalDisplacement,
        remainingExpectedRange,
        reasons: ["directional_displacement_over_70pct_median_range"]
      };
    }

    const pullbackDistance =
      side === "BUY"
        ? this.state.directionalExtreme - f.mid
        : f.mid - this.state.directionalExtreme;
    const pullbackRatio = pullbackDistance / signalRange;
    if (this.state.stage === "BIAS") {
      if (pullbackRatio >= 0.15 && pullbackRatio <= 0.45) {
        this.state.stage = "PULLBACK_SEEN";
        this.state.pullbackExtreme = f.mid;
      } else {
        return {
          ...base,
          side,
          waitReason: "WAIT_PULLBACK_NOT_SEEN",
          stage: this.state.stage,
          currentCandleStartMs: current.startMs,
          currentCandleAgeSec: ageSec,
          directionalDisplacement,
          remainingExpectedRange,
          pullbackRatio,
          reasons: ["pullback_not_within_15_to_45pct_signal_range"]
        };
      }
    }

    if (this.state.stage === "PULLBACK_SEEN") {
      if (this.state.pullbackExtreme == null) {
        this.state.pullbackExtreme = f.mid;
      } else if (side === "BUY") {
        this.state.pullbackExtreme = Math.min(this.state.pullbackExtreme, f.mid);
      } else {
        this.state.pullbackExtreme = Math.max(this.state.pullbackExtreme, f.mid);
      }
      const reclaimDistance =
        side === "BUY"
          ? f.mid - this.state.pullbackExtreme
          : this.state.pullbackExtreme - f.mid;
      if (reclaimDistance < 0.1 * signalRange) {
        return {
          ...base,
          side,
          waitReason: "WAIT_PULLBACK_STILL_FALLING",
          stage: this.state.stage,
          currentCandleStartMs: current.startMs,
          currentCandleAgeSec: ageSec,
          directionalDisplacement,
          remainingExpectedRange,
          pullbackRatio,
          reclaimDistance,
          reasons: ["reclaim_below_10pct_signal_range"]
        };
      }
      this.state.stage = "REACCELERATING";
    }

    const reclaimDistance =
      this.state.pullbackExtreme == null
        ? 0
        : side === "BUY"
          ? f.mid - this.state.pullbackExtreme
          : this.state.pullbackExtreme - f.mid;
    const micro = microstructureScoreForSide(side, f);
    if (!micro.allPassed) {
      return {
        ...base,
        side,
        waitReason: "WAIT_MICROSTRUCTURE_NOT_CONFIRMED",
        stage: this.state.stage,
        currentCandleStartMs: current.startMs,
        currentCandleAgeSec: ageSec,
        directionalDisplacement,
        remainingExpectedRange,
        pullbackRatio,
        reclaimDistance,
        microstructureScore: micro.score,
        reasons: ["microstructure_confirmation_missing"]
      };
    }

    const requiredRewardSpace =
      1.5 * cfg.hardStop + cfg.friction + Math.max(0, f.spread);
    if (remainingExpectedRange < requiredRewardSpace) {
      return {
        ...base,
        side,
        waitReason: "WAIT_INSUFFICIENT_REWARD_SPACE",
        stage: this.state.stage,
        currentCandleStartMs: current.startMs,
        currentCandleAgeSec: ageSec,
        directionalDisplacement,
        remainingExpectedRange,
        pullbackRatio,
        reclaimDistance,
        microstructureScore: micro.score,
        rewardSpaceScore: clamp01(
          remainingExpectedRange / Math.max(requiredRewardSpace * 1.5, EPSILON)
        ),
        reasons: ["remaining_range_below_economic_room_threshold"]
      };
    }

    const bodyStrength = clamp01((latestClosed.bodyRatio - 0.55) / 0.45);
    const closeStrength =
      side === "BUY"
        ? clamp01((latestClosed.closeLocation - 0.7) / 0.3)
        : clamp01((0.3 - latestClosed.closeLocation) / 0.3);
    const closeStep =
      side === "BUY"
        ? Number(latestClosed.close > previousClosed.close)
        : Number(latestClosed.close < previousClosed.close);
    const candleTrendScore = clamp01(
      0.35 + 0.3 * bodyStrength + 0.2 * closeStrength + 0.15 * closeStep
    );

    const pullbackCenter = 0.3;
    const pullbackShapeScore =
      pullbackRatio >= 0.15 && pullbackRatio <= 0.45
        ? clamp01(1 - Math.abs(pullbackRatio - pullbackCenter) / 0.15)
        : 0;
    const reclaimScore = clamp01(reclaimDistance / Math.max(0.2 * signalRange, EPSILON));
    const pullbackScore = clamp01(0.6 * pullbackShapeScore + 0.4 * reclaimScore);

    const rewardSpaceScore = clamp01(
      remainingExpectedRange / Math.max(requiredRewardSpace * 1.5, EPSILON)
    );
    const finalQuality = clamp01(
      0.4 * candleTrendScore +
        0.25 * pullbackScore +
        0.2 * micro.score +
        0.15 * rewardSpaceScore
    );

    if (finalQuality < 0.7) {
      return {
        ...base,
        side,
        waitReason: "WAIT_QUALITY_BELOW_MIN",
        stage: this.state.stage,
        currentCandleStartMs: current.startMs,
        currentCandleAgeSec: ageSec,
        directionalDisplacement,
        remainingExpectedRange,
        pullbackRatio,
        reclaimDistance,
        candleTrendScore,
        pullbackScore,
        microstructureScore: micro.score,
        rewardSpaceScore,
        finalQuality,
        reasons: ["quality_below_0_70"]
      };
    }

    this.state.stage = "TRIGGERED";
    return {
      ...base,
      eligible: true,
      side,
      waitReason: null,
      stage: this.state.stage,
      currentCandleStartMs: current.startMs,
      currentCandleAgeSec: ageSec,
      signalRange,
      directionalDisplacement,
      remainingExpectedRange,
      pullbackRatio,
      reclaimDistance,
      candleTrendScore,
      pullbackScore,
      microstructureScore: micro.score,
      rewardSpaceScore,
      finalQuality,
      reasons: [
        "m1_direction_confirmed",
        "pullback_reclaim_confirmed",
        "microstructure_confirmed",
        "reward_space_confirmed"
      ]
    };
  }
}
