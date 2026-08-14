import { describe, expect, it } from "vitest";
import {
  PastOnlyScoreWindow,
  adaptiveRankPasses
} from "../../../../src/services/microEdge/goldHunter/v12/adaptiveRank";
import {
  assertFoldChronology,
  buildWalkForwardFolds
} from "../../../../src/services/microEdge/goldHunter/v12/walkForward";
import {
  createOpenState,
  evaluateV12Exit,
  updateHarvestState,
  deriveTrailParamsFromTrain
} from "../../../../src/services/microEdge/goldHunter/v12/exits";
import { buildV12MicroFeatures } from "../../../../src/services/microEdge/goldHunter/v12/microFeatures";
import { classifyV12Regime } from "../../../../src/services/microEdge/goldHunter/v12/regimes";
import { opportunityLabel } from "../../../../src/services/microEdge/goldHunter/v12/models";
import { scoreStability, summarizeFoldTrades } from "../../../../src/services/microEdge/goldHunter/v12/stability";
import { buildFrozenV12, hashFrozenV12 } from "../../../../src/services/microEdge/goldHunter/v12/frozenConfig";
import { runV12ShadowReplay, type V12ScoreRow } from "../../../../src/services/microEdge/goldHunter/v12/shadowReplay";
import type { V12PolicyConfig } from "../../../../src/services/microEdge/goldHunter/v12/policy";
import {
  GOLD_HUNTER_V11_NEGATIVE_FROZEN_SHA,
  GOLD_HUNTER_V12_STRATEGY_VERSION,
  V12_KNOWN_STRESS_PERIODS,
  V12_DEV_WINDOW_END_MS,
  V11_DEV_WINDOW_START_MS
} from "../../../../src/services/microEdge/goldHunter/v12/versions";
import { activityBand } from "../../../../src/services/microEdge/goldHunter/v11/activityMetrics";
import type { GhSecondPoint } from "../../../../src/services/microEdge/goldHunter/features";
import { emptyMicrostructure } from "../../../../src/services/microEdge/goldHunter/microstructure";

function sec(
  ts: number,
  bid: number,
  ask: number,
  micro = emptyMicrostructure()
): GhSecondPoint {
  return {
    timestampMs: ts,
    bid,
    ask,
    bidUpdatedMs: ts,
    askUpdatedMs: ts,
    micro: {
      ...micro,
      spotEventCount: 8,
      bidUpdateCount: 4,
      askUpdateCount: 4,
      upTickCount: 3,
      downTickCount: 1
    }
  };
}

function basePolicy(over: Partial<V12PolicyConfig> = {}): V12PolicyConfig {
  return {
    family: "independent_binary",
    architecture: "E_5_15",
    primaryHorizonSec: 5,
    contextHorizonSec: 15,
    rankWindowSec: 900,
    rankPercentile: 0.95,
    buyColdFloor: 0.55,
    sellColdFloor: 0.55,
    maxSpread: 0.5,
    consecutiveEvals: 1,
    minOpportunity: 0.5,
    opposeVeto: 1.01,
    allowedRegimes: null,
    exit: {
      architecture: "HYBRID_TRAIL_FADE",
      maxHoldSec: 60,
      protectiveStop: 0.8,
      trailActivateMfe: 0.2,
      trailDistance: 0.1,
      profitLockFraction: 0.5,
      edgeFadeFloor: 0.2,
      edgeFlipMin: 0.55,
      rapidInvalidationSec: 3,
      friction: 0.06
    },
    ...over
  };
}

describe("GOLD_HUNTER V1.2 walk-forward & safety", () => {
  it("preserves V1.1 NEGATIVE baseline and ends V1.2 before V1.1", () => {
    expect(GOLD_HUNTER_V12_STRATEGY_VERSION).toBe("GOLD_HUNTER_V1_2");
    expect(GOLD_HUNTER_V11_NEGATIVE_FROZEN_SHA).toHaveLength(64);
    expect(V12_DEV_WINDOW_END_MS).toBeLessThan(V11_DEV_WINDOW_START_MS);
    expect(V12_KNOWN_STRESS_PERIODS.length).toBeGreaterThanOrEqual(2);
  });

  it("builds chronological walk-forward folds with purge", () => {
    const rows = Array.from({ length: 40_000 }, (_, i) => ({
      timestampMs: Date.parse("2026-05-14T00:00:00Z") + i * 60_000
    }));
    const plan = buildWalkForwardFolds(rows, {
      trainDayMs: 14 * 86_400_000,
      valDayMs: 4 * 86_400_000,
      stepDayMs: 4 * 86_400_000,
      holdoutFrac: 0.2,
      purgeMs: 60_000,
      minFolds: 3
    });
    expect(plan.folds.length).toBeGreaterThanOrEqual(3);
    expect(plan.holdout.length).toBeGreaterThan(0);
    for (const f of plan.folds) {
      expect(assertFoldChronology(f)).toBe(true);
      const trainEnd = f.train[f.train.length - 1]!.timestampMs;
      const valStart = f.validation[0]!.timestampMs;
      expect(valStart - trainEnd).toBeGreaterThanOrEqual(60_000);
    }
    const holdStart = plan.holdout[0]!.timestampMs;
    const lastResearch = plan.folds[plan.folds.length - 1]!.validation[
      plan.folds[plan.folds.length - 1]!.validation.length - 1
    ]!.timestampMs;
    expect(holdStart).toBeGreaterThan(lastResearch);
  });

  it("rolling rank uses past-only scores", () => {
    const w = new PastOnlyScoreWindow(600_000);
    const now = 1_000_000;
    for (let i = 0; i < 40; i++) {
      w.push(now - 500_000 + i * 1000, 0.4 + (i % 10) * 0.01);
    }
    // Current score must not be in the window yet
    const thr = w.quantileThreshold(now, 0.9, 30);
    expect(thr).toBeTypeOf("number");
    expect(
      adaptiveRankPasses({
        score: (thr as number) + 0.01,
        nowMs: now,
        window: w,
        percentile: 0.9,
        coldFloor: 0.99
      })
    ).toBe(true);
    // Pushing after decision does not affect the prior threshold check semantics
    w.push(now, 0.99);
    const thr2 = w.quantileThreshold(now, 0.9, 30);
    expect(thr2).toBe(thr);
  });

  it("microstructure features and regimes are past-only reconstructible", () => {
    const hist: GhSecondPoint[] = [];
    let px = 2300;
    for (let i = 0; i < 40; i++) {
      px += i % 3 === 0 ? 0.05 : -0.02;
      hist.push(sec(1_000_000 + i * 1000, px, px + 0.12));
    }
    const micro = buildV12MicroFeatures({ history: hist, m1Return: 0.001, m5Return: 0.002 });
    expect(micro).not.toBeNull();
    expect(micro!.values.length).toBeGreaterThan(30);
    const regime = classifyV12Regime({
      ret5: 0.0001,
      ret15: 0.0002,
      ret60: 0.001,
      shortVol: 0.0002,
      range15: 0.5,
      range60: 1.2,
      spreadOverMedian: 1.1,
      burstRatio: 1.6,
      efficiency15: 0.6,
      tickRate1s: 10,
      tickRateMean: 5
    });
    expect(typeof regime).toBe("string");
  });

  it("two-stage opportunity label and no averaging/martingale/grid in replay", () => {
    expect(opportunityLabel(0.2, -0.1, 0.08)).toBe(1);
    expect(opportunityLabel(0.01, 0.01, 0.08)).toBe(0);
    const rows: V12ScoreRow[] = [];
    let bid = 2300;
    for (let i = 0; i < 120; i++) {
      bid += 0.02;
      rows.push({
        timestampMs: 1_700_000_000_000 + i * 1000,
        bid,
        ask: bid + 0.1,
        spread: 0.1,
        regime: "TREND_STEADY",
        scores: {
          buyPrimary: 0.9,
          sellPrimary: 0.1,
          buyContext: 0.8,
          sellContext: 0.2,
          pOpportunity: 0.9,
          expectedAbsEdge: 0.2
        },
        dataOk: true,
        velocity: 0.0002,
        spreadOverMedian: 1
      });
    }
    const trades = runV12ShadowReplay(rows, basePolicy());
    // At most one open position path — no pyramiding / grid / martingale size changes
    for (let i = 1; i < trades.length; i++) {
      expect(trades[i]!.entryTimestampMs).toBeGreaterThanOrEqual(
        trades[i - 1]!.exitTimestampMs
      );
    }
  });

  it("BUY trails on Bid and never loosens; SELL trails on Ask", () => {
    const cfg = basePolicy().exit;
    const buy = createOpenState({
      side: "BUY",
      entryTs: 0,
      entryPrice: 2300.2,
      exitConfig: cfg
    });
    updateHarvestState(buy, { bid: 2300.5, ask: 2300.6, cfg });
    updateHarvestState(buy, { bid: 2300.8, ask: 2300.9, cfg });
    expect(buy.trailActive).toBe(true);
    const floor1 = buy.lockFloor!;
    // Adverse tick must not loosen floor
    updateHarvestState(buy, { bid: 2300.55, ask: 2300.65, cfg });
    expect(buy.lockFloor!).toBeGreaterThanOrEqual(floor1);

    const sell = createOpenState({
      side: "SELL",
      entryTs: 0,
      entryPrice: 2300.0,
      exitConfig: cfg
    });
    updateHarvestState(sell, { bid: 2299.7, ask: 2299.8, cfg });
    updateHarvestState(sell, { bid: 2299.4, ask: 2299.5, cfg });
    expect(sell.trailActive).toBe(true);
    const sFloor = sell.lockFloor!;
    updateHarvestState(sell, { bid: 2299.6, ask: 2299.7, cfg });
    expect(sell.lockFloor!).toBeLessThanOrEqual(sFloor);
  });

  it("supports edge-fade, edge-flip, rapid invalidation exits", () => {
    const cfg = basePolicy().exit;
    const open = createOpenState({
      side: "BUY",
      entryTs: 0,
      entryPrice: 2300,
      exitConfig: cfg
    });
    const fade = evaluateV12Exit({
      open,
      nowMs: 10_000,
      bid: 2300,
      ask: 2300.1,
      sideScore: 0.05,
      opposeScore: 0.1,
      velocity: 0,
      spreadOverMedian: 1,
      dataOk: true,
      cfg: { ...cfg, architecture: "EDGE_FADE" }
    });
    expect(fade).toBe("EDGE_GONE");

    const flip = evaluateV12Exit({
      open,
      nowMs: 10_000,
      bid: 2300,
      ask: 2300.1,
      sideScore: 0.4,
      opposeScore: 0.8,
      velocity: 0,
      spreadOverMedian: 1,
      dataOk: true,
      cfg: { ...cfg, architecture: "EDGE_FLIP", edgeFlipMin: 0.5 }
    });
    expect(flip).toBe("EDGE_FLIPPED");

    const rapid = evaluateV12Exit({
      open,
      nowMs: 2000,
      bid: 2300,
      ask: 2300.1,
      sideScore: 0.1,
      opposeScore: 0.7,
      velocity: 0,
      spreadOverMedian: 1,
      dataOk: true,
      cfg
    });
    expect(rapid).toBe("EDGE_FLIPPED");
  });

  it("executable-side economics do not double-count spread", () => {
    const rows: V12ScoreRow[] = [];
    for (let i = 0; i < 40; i++) {
      rows.push({
        timestampMs: 2_000_000_000_000 + i * 1000,
        bid: 2300,
        ask: 2300.2,
        spread: 0.2,
        regime: "RANGE",
        scores: {
          buyPrimary: i < 5 ? 0.95 : 0.1,
          sellPrimary: 0.1,
          buyContext: 0.9,
          sellContext: 0.1,
          pOpportunity: 0.9,
          expectedAbsEdge: 0.1
        },
        dataOk: true,
        velocity: 0,
        spreadOverMedian: 1
      });
    }
    // Force exit via max hold with flat prices
    const trades = runV12ShadowReplay(
      rows,
      basePolicy({
        exit: {
          ...basePolicy().exit,
          architecture: "FIXED_MAX_HOLD",
          maxHoldSec: 10,
          protectiveStop: 5
        }
      })
    );
    expect(trades.length).toBeGreaterThanOrEqual(1);
    const t = trades[0]!;
    // BUY: entry ask, exit bid → gross = -spread when flat
    expect(t.entryPrice).toBe(t.entryAsk);
    expect(t.exitPrice).toBe(t.exitBid);
    expect(t.grossMove).toBeCloseTo(t.exitBid - t.entryAsk, 6);
    expect(t.netMove).toBeCloseTo(t.grossMove - t.additionalFriction, 6);
  });

  it("stability objective rejects outlier domination", () => {
    const folds = [
      summarizeFoldTrades(
        0,
        [
          {
            tradeId: "a",
            date: "2026-05-01",
            strategyVersion: GOLD_HUNTER_V12_STRATEGY_VERSION,
            modelVersion: "x",
            entryTimestampMs: 1,
            exitTimestampMs: 2,
            durationSeconds: 1,
            side: "BUY",
            entryBid: 1,
            entryAsk: 1,
            entryPrice: 1,
            exitBid: 2,
            exitAsk: 2,
            exitPrice: 2,
            entrySpread: 0,
            grossMove: 50,
            additionalFriction: 0,
            netMove: 50,
            mfe: 50,
            mae: 0,
            entryProbs: {} as never,
            exitProbs: null,
            entryReason: "t",
            exitReason: "MAX_HOLD",
            session: "OVERLAP",
            regime: "TREND",
            result: "WIN"
          }
        ],
        0,
        3_600_000
      ),
      ...[1, 2, 3, 4].map((i) =>
        summarizeFoldTrades(
          i,
          [
            {
              tradeId: `b${i}`,
              date: "2026-05-02",
              strategyVersion: GOLD_HUNTER_V12_STRATEGY_VERSION,
              modelVersion: "x",
              entryTimestampMs: 1,
              exitTimestampMs: 2,
              durationSeconds: 1,
              side: "BUY",
              entryBid: 1,
              entryAsk: 1,
              entryPrice: 1,
              exitBid: 1,
              exitAsk: 1,
              exitPrice: 1,
              entrySpread: 0,
              grossMove: -1,
              additionalFriction: 0,
              netMove: -1,
              mfe: 0,
              mae: -1,
              entryProbs: {} as never,
              exitProbs: null,
              entryReason: "t",
              exitReason: "MAX_HOLD",
              session: "LONDON",
              regime: "RANGE",
              result: "LOSS"
            }
          ],
          0,
          3_600_000
        )
      )
    ];
    const stab = scoreStability(folds);
    expect(stab.eligible).toBe(false);
  });

  it("freezes before holdout identity and trail params from train", () => {
    const trail = deriveTrailParamsFromTrain([0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2]);
    expect(trail.trailActivateMfe).toBeGreaterThan(0);
    const { config, sha256 } = buildFrozenV12({
      researchRunId: "test",
      modelFamily: "two_stage_opportunity",
      datasetHash: "abc",
      policy: basePolicy(),
      keptFeatureIndices: [0, 1, 2],
      walkForwardFolds: 5,
      holdoutRangeUtc: { from: "a", to: "b" }
    });
    expect(config.holdoutSealed).toBe(true);
    expect(config.knownStressNotUsedForTuning).toBe(true);
    expect(hashFrozenV12(config)).toBe(sha256);
  });

  it("activity bands match GOLD_HUNTER targets", () => {
    expect(activityBand(2)).toBe("TOO_SLOW_FOR_GOLD_HUNTER");
    expect(activityBand(4)).toBe("LOW_ACTIVITY");
    expect(activityBand(7)).toBe("ACCEPTABLE_IF_HIGH_EDGE");
    expect(activityBand(15)).toBe("TARGET_FAST_ACTIVITY_RANGE");
    expect(activityBand(40)).toBe("HIGH_ACTIVITY_REVIEW_COSTS");
  });
});
