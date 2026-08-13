import { describe, expect, it } from "vitest";
import {
  trainBinaryLogistic,
  predictBinaryProb,
  trainRidgeRegression,
  predictRidge,
  trainStumpBoost,
  predictStumpBoost,
  trainClipAbs
} from "../../../../src/services/microEdge/goldHunter/v11/models";
import {
  decideV11Action,
  ensembleBuyScore,
  ARCHITECTURES
} from "../../../../src/services/microEdge/goldHunter/v11/policy";
import { runV11ShadowReplay } from "../../../../src/services/microEdge/goldHunter/v11/shadowReplay";
import {
  buildFrozenV11,
  hashFrozenV11
} from "../../../../src/services/microEdge/goldHunter/v11/frozenConfig";
import { evaluateCandidateEligibility } from "../../../../src/services/microEdge/goldHunter/validationOptimizer";
import {
  GOLD_HUNTER_V1_REAL_7D_RUN_ID,
  GOLD_HUNTER_V11_STRATEGY_VERSION,
  V1_REAL_7D_WINDOW_START_MS
} from "../../../../src/services/microEdge/goldHunter/v11/versions";
import { diagnoseHorizonScores } from "../../../../src/services/microEdge/goldHunter/v11/diagnostics";
import type { GhLabel } from "../../../../src/services/microEdge/goldHunter/types";

describe("GOLD_HUNTER V1.1 identity", () => {
  it("preserves V1 real-7d run id and uses V1.1 strategy version", () => {
    expect(GOLD_HUNTER_V1_REAL_7D_RUN_ID).toBe("GH_REAL_7D_20260813_d1b08b82");
    expect(GOLD_HUNTER_V11_STRATEGY_VERSION).toBe("GOLD_HUNTER_V1_1");
    expect(V1_REAL_7D_WINDOW_START_MS).toBe(
      Date.parse("2026-08-06T11:49:08.494Z")
    );
  });
});

describe("independent binary BUY/SELL", () => {
  it("learns separable BUY vs SELL targets independently", () => {
    const X = [
      [1, 0],
      [0.9, 0.1],
      [0.8, 0],
      [0, 1],
      [0.1, 0.9],
      [0, 0.8]
    ];
    const buyY = [1, 1, 1, 0, 0, 0];
    const sellY = [0, 0, 0, 1, 1, 1];
    const buy = trainBinaryLogistic(X, buyY, { epochs: 80 });
    const sell = trainBinaryLogistic(X, sellY, { epochs: 80 });
    expect(predictBinaryProb(buy, [1, 0])).toBeGreaterThan(0.55);
    expect(predictBinaryProb(sell, [0, 1])).toBeGreaterThan(0.55);
    // Independent models — BUY preferred feature should not also be strong SELL
    expect(predictBinaryProb(sell, [1, 0])).toBeLessThan(0.5);
    expect(predictBinaryProb(buy, [0, 1])).toBeLessThan(0.5);
  });
});

describe("direct edge ridge + stump boost", () => {
  it("predicts higher edge when feature aligns with target", () => {
    const X = Array.from({ length: 40 }, (_, i) => [i / 40, (40 - i) / 40]);
    const yLong = X.map((r) => r[0]! * 0.4 - 0.1);
    const clip = trainClipAbs([...yLong, 50]); // extreme outlier ignored via clip
    expect(clip).toBeLessThan(5);
    const ridge = trainRidgeRegression(X, yLong, { clipAbs: clip });
    const hi = predictRidge(ridge, [0.95, 0.05]);
    const lo = predictRidge(ridge, [0.05, 0.95]);
    expect(hi).toBeGreaterThan(lo);

    const boost = trainStumpBoost(X, yLong, { stumps: 6, clipAbs: clip });
    expect(predictStumpBoost(boost, [0.9, 0.1])).toBeGreaterThan(
      predictStumpBoost(boost, [0.1, 0.9])
    );
  });
});

describe("primary-horizon policy", () => {
  it("allows compressed scores via floors without requiring multi-horizon AND gates", () => {
    const byHorizon = {
      5: { buyScore: 0.04, sellScore: 0.01 },
      15: { buyScore: 0.12, sellScore: 0.02 },
      30: { buyScore: 0.03, sellScore: 0.02 },
      60: { buyScore: 0.01, sellScore: 0.2 }
    };
    const arch = ARCHITECTURES.find((a) => a.id === "B_15s_primary")!;
    const buy = ensembleBuyScore(arch.id, byHorizon);
    expect(buy).toBeCloseTo(0.12, 5);
    const action = decideV11Action({
      scores: { buyScore: buy, sellScore: 0.02, byHorizon },
      policy: {
        architecture: arch.id,
        primaryHorizon: 15,
        contextHorizons: [5, 30],
        minEdge: 0.05,
        rankQuantile: null,
        buyScoreFloor: 0.05,
        sellScoreFloor: 0.05,
        maxSpread: 0.2,
        consecutiveEvals: 1,
        maxHoldSec: 30,
        protectiveStop: 0.5,
        opposeVetoScore: 0.25,
        theta: 0.05
      },
      spread: 0.12,
      regime: "TREND",
      dataOk: true
    });
    expect(action).toBe("BUY");
  });

  it("rejects negative / below-floor expected edge", () => {
    const action = decideV11Action({
      scores: {
        buyScore: 0.01,
        sellScore: 0.01,
        byHorizon: { 15: { buyScore: 0.01, sellScore: 0.01 } }
      },
      policy: {
        architecture: "B_15s_primary",
        primaryHorizon: 15,
        contextHorizons: [5],
        minEdge: 0.05,
        rankQuantile: null,
        buyScoreFloor: 0.05,
        sellScoreFloor: 0.05,
        maxSpread: 0.2,
        consecutiveEvals: 1,
        maxHoldSec: 30,
        protectiveStop: 0.5,
        opposeVetoScore: 0.2,
        theta: 0.05
      },
      spread: 0.12,
      regime: "RANGE",
      dataOk: true
    });
    expect(action).toBe("WAIT");
  });

  it("applies spread gate", () => {
    const action = decideV11Action({
      scores: {
        buyScore: 0.2,
        sellScore: 0.01,
        byHorizon: { 15: { buyScore: 0.2, sellScore: 0.01 } }
      },
      policy: {
        architecture: "B_15s_primary",
        primaryHorizon: 15,
        contextHorizons: [],
        minEdge: 0.05,
        rankQuantile: null,
        buyScoreFloor: 0.05,
        sellScoreFloor: 0.05,
        maxSpread: 0.15,
        consecutiveEvals: 1,
        maxHoldSec: 30,
        protectiveStop: 0.5,
        opposeVetoScore: 0.5,
        theta: 0.05
      },
      spread: 0.4,
      regime: "TREND",
      dataOk: true
    });
    expect(action).toBe("WAIT");
  });
});

describe("eligibility + freeze", () => {
  it("zero-trade candidate cannot win", () => {
    const ev = evaluateCandidateEligibility([]);
    expect(ev.eligible).toBe(false);
    expect(ev.rejectReason).toBe("ZERO_TRADES");
  });

  it("single-outlier domination is rejected", () => {
    const mk = (i: number, net: number) => ({
      tradeId: `t${i}`,
      date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`,
      strategyVersion: "t",
      modelVersion: "t",
      entryTimestampMs: i * 1000,
      exitTimestampMs: i * 1000 + 1000,
      durationSeconds: 1,
      side: (i % 2 === 0 ? "BUY" : "SELL") as "BUY" | "SELL",
      entryBid: 1,
      entryAsk: 1.1,
      entryPrice: 1.1,
      exitBid: 1,
      exitAsk: 1.1,
      exitPrice: 1,
      entrySpread: 0.1,
      grossMove: net,
      additionalFriction: 0,
      netMove: net,
      mfe: net,
      mae: 0,
      entryProbs: {} as never,
      exitProbs: null,
      entryReason: "t",
      exitReason: "MAX_HOLD" as const,
      session: "LONDON" as const,
      regime: "TREND" as const,
      result: (net > 0 ? "WIN" : "LOSS") as "WIN" | "LOSS"
    });
    const trades = [mk(0, 20), ...Array.from({ length: 40 }, (_, i) => mk(i + 1, 0.05))];
    const ev = evaluateCandidateEligibility(trades);
    expect(ev.eligible).toBe(false);
    expect(ev.rejectReason).toBe("SINGLE_TRADE_DOMINATION");
  });

  it("frozen config hash is deterministic and seals holdout", () => {
    const policy = {
      architecture: "B_15s_primary" as const,
      primaryHorizon: 15 as const,
      contextHorizons: [5 as const, 30 as const],
      minEdge: 0.05,
      rankQuantile: 0.95,
      buyScoreFloor: 0.05,
      sellScoreFloor: 0.05,
      maxSpread: 0.17,
      consecutiveEvals: 2,
      maxHoldSec: 15,
      protectiveStop: 0.5,
      opposeVetoScore: 0.2,
      theta: 0.05
    };
    const a = buildFrozenV11({
      researchRunId: "test",
      modelFamily: "independent_binary",
      datasetHash: "abc",
      policy,
      keptFeatureIndices: [0, 1, 2],
      trainRangeUtc: { from: "a", to: "b" },
      validationRangeUtc: { from: "c", to: "d" },
      holdoutRangeUtc: { from: "e", to: "f" }
    });
    const b = buildFrozenV11({
      researchRunId: "test",
      modelFamily: "independent_binary",
      datasetHash: "abc",
      policy,
      keptFeatureIndices: [0, 1, 2],
      trainRangeUtc: { from: "a", to: "b" },
      validationRangeUtc: { from: "c", to: "d" },
      holdoutRangeUtc: { from: "e", to: "f" }
    });
    expect(a.sha256).toBe(b.sha256);
    expect(a.config.holdoutSealed).toBe(true);
    expect(hashFrozenV11(a.config)).toBe(a.sha256);
  });
});

describe("BUY/SELL Bid/Ask economics in V1.1 replay", () => {
  it("BUY enters Ask exits Bid; SELL enters Bid exits Ask", () => {
    const policy = {
      architecture: "B_15s_primary" as const,
      primaryHorizon: 15 as const,
      contextHorizons: [] as const[],
      minEdge: 0.01,
      rankQuantile: null,
      buyScoreFloor: 0.01,
      sellScoreFloor: 0.01,
      maxSpread: 1,
      consecutiveEvals: 1,
      maxHoldSec: 5,
      protectiveStop: 5,
      opposeVetoScore: 10,
      theta: 0
    };
    const rows = Array.from({ length: 20 }, (_, i) => ({
      timestampMs: 1_000_000 + i * 1000,
      bid: 4300 + i * 0.05,
      ask: 4300.12 + i * 0.05,
      spread: 0.12,
      regime: "TREND" as const,
      dataOk: true,
      scores: {
        buyScore: i < 8 ? 0.2 : 0,
        sellScore: 0,
        byHorizon: { 15: { buyScore: i < 8 ? 0.2 : 0, sellScore: 0 } }
      }
    }));
    const trades = runV11ShadowReplay(rows, policy);
    expect(trades.length).toBeGreaterThan(0);
    const t = trades[0]!;
    expect(t.side).toBe("BUY");
    expect(t.entryPrice).toBe(t.entryAsk);
    expect(t.exitPrice).toBe(t.exitBid);
    // spread not double-counted: gross = exitBid - entryAsk
    expect(t.grossMove).toBeCloseTo(t.exitBid - t.entryAsk, 8);
  });
});

describe("rank signal diagnosis", () => {
  it("classifies usable rank when top deciles realize better BUY net", () => {
    const n = 200;
    const pUp = Array.from({ length: n }, (_, i) => i / n);
    const labels: GhLabel[] = pUp.map((p, i) => ({
      horizonSec: 15,
      classLabel: p > 0.7 ? "UP_TRADEABLE" : "NO_EDGE",
      midMove: p * 0.2,
      grossLong: p * 0.2,
      grossShort: -p * 0.1,
      netLong: (p - 0.4) * 0.3,
      netShort: (0.4 - p) * 0.3,
      targetTimestampMs: i
    }));
    const d = diagnoseHorizonScores({
      horizonSec: 15,
      pUp,
      pDown: pUp.map((p) => 1 - p),
      pNoEdge: pUp.map(() => 0.2),
      labels
    });
    expect(["USABLE_RANK_SIGNAL", "WEAK_RANK_SIGNAL"]).toContain(d.rankSignal);
  });
});
