import { describe, expect, it } from "vitest";
import {
  coarseEntryGridIncludesNonDefault,
  evaluateCandidateEligibility,
  makeSymmetricEntry,
  runStagedValidationOptimizer
} from "../../../../src/services/microEdge/goldHunter/validationOptimizer";
import { DEFAULT_ENTRY_THRESHOLDS } from "../../../../src/services/microEdge/goldHunter/signalPolicy";
import { deriveProtectiveStopCandidatesFromTrain } from "../../../../src/services/microEdge/goldHunter/protectiveStop";
import {
  buildFrozenConfig,
  hashFrozenConfig
} from "../../../../src/services/microEdge/goldHunter/frozenConfig";
import type { GhShadowTrade } from "../../../../src/services/microEdge/goldHunter/types";
import { GOLD_HUNTER_STRATEGY_VERSION } from "../../../../src/services/microEdge/goldHunter/config";

function mkTrade(net: number, side: "BUY" | "SELL" = "BUY"): GhShadowTrade {
  return {
    tradeId: `t_${net}_${Math.random()}`,
    date: "2026-08-13",
    strategyVersion: GOLD_HUNTER_STRATEGY_VERSION,
    modelVersion: "m",
    entryTimestampMs: 1,
    exitTimestampMs: 2,
    durationSeconds: 10,
    side,
    entryBid: 1,
    entryAsk: 1.1,
    entryPrice: side === "BUY" ? 1.1 : 1,
    exitBid: 1.2,
    exitAsk: 1.3,
    exitPrice: side === "BUY" ? 1.2 : 1.3,
    entrySpread: 0.1,
    grossMove: net + 0.06,
    additionalFriction: 0.06,
    netMove: net,
    mfe: Math.max(0, net),
    mae: Math.min(0, net),
    entryProbs: {
      5: {
        horizonSec: 5,
        pUp: 0.7,
        pDown: 0.1,
        pNoEdge: 0.2,
        expectedNetBuy: 0.1,
        expectedNetSell: 0
      },
      15: {
        horizonSec: 15,
        pUp: 0.7,
        pDown: 0.1,
        pNoEdge: 0.2,
        expectedNetBuy: 0.1,
        expectedNetSell: 0
      },
      30: {
        horizonSec: 30,
        pUp: 0.7,
        pDown: 0.1,
        pNoEdge: 0.2,
        expectedNetBuy: 0.1,
        expectedNetSell: 0
      },
      60: {
        horizonSec: 60,
        pUp: 0.7,
        pDown: 0.1,
        pNoEdge: 0.2,
        expectedNetBuy: 0.1,
        expectedNetSell: 0
      }
    },
    exitProbs: null,
    entryReason: "x",
    exitReason: "MAX_HOLD",
    session: "LONDON",
    regime: "TREND",
    result: net > 0 ? "WIN" : net < 0 ? "LOSS" : "BREAKEVEN"
  };
}

describe("validation optimizer", () => {
  it("evaluates entry thresholds beyond defaults", () => {
    expect(coarseEntryGridIncludesNonDefault(DEFAULT_ENTRY_THRESHOLDS)).toBe(true);
    const e = makeSymmetricEntry(0.8, 0.75, 0.7, 0.5, 3);
    expect(e.pUp5).not.toBe(DEFAULT_ENTRY_THRESHOLDS.pUp5);
    expect(e.consecutiveEvals).toBe(3);
  });

  it("zero-trade candidate cannot win optimization", () => {
    const zero = evaluateCandidateEligibility([]);
    expect(zero.eligible).toBe(false);
    expect(zero.rejectReason).toBe("ZERO_TRADES");
    expect(zero.score).toBe(Number.NEGATIVE_INFINITY);

    const good = Array.from({ length: 55 }, (_, i) =>
      mkTrade(i % 5 === 0 ? -0.05 : 0.08, i % 2 === 0 ? "BUY" : "SELL")
    );
    const ok = evaluateCandidateEligibility(good);
    expect(ok.eligible).toBe(true);
    expect(ok.score).toBeGreaterThan(0);
  });

  it("staged search can select non-default entry and never sees holdout", () => {
    const holdoutPoison = { seen: false };
    const validationRows = Array.from({ length: 20 }, (_, i) => ({
      timestampMs: 1_000_000 + i * 1000,
      features: {} as never,
      labels: {},
      quote: { timestampMs: 1_000_000 + i * 1000, bid: 2400, ask: 2400.2 }
    }));

    const result = runStagedValidationOptimizer({
      validationRows,
      stopCandidates: [0.3, 0.6],
      defaultStop: 0.6,
      replayForTheta: () => (rows, entry, maxHold, stop) => {
        // If someone passed holdout, timestamps would differ — mark poison.
        if (rows.some((r) => r.timestampMs > 9_000_000)) holdoutPoison.seen = true;
        // Produce enough winning trades only for non-default aggressive thresholds
        const aggressive = entry.pUp5 <= 0.65;
        if (!aggressive) return [];
        return Array.from({ length: 55 }, (_, i) =>
          mkTrade(0.05 + (stop < 0.5 ? 0.01 : 0) + maxHold * 0.0001)
        );
      }
    });

    expect(holdoutPoison.seen).toBe(false);
    expect(result.best).not.toBeNull();
    expect(result.best!.candidate.entry.pUp5).not.toBe(DEFAULT_ENTRY_THRESHOLDS.pUp5);
    expect(result.searched.some((s) => s.tradeCount === 0)).toBe(true);
    expect(
      result.searched.filter((s) => s.tradeCount === 0).every((s) => !s.eligible)
    ).toBe(true);
  });
});

describe("protective stop + frozen config", () => {
  it("derives stop candidates from TRAIN moves only", () => {
    const c = deriveProtectiveStopCandidatesFromTrain({
      trainMids: [2400, 2401],
      absMoves5: [0.1, 0.2, 0.3, 0.5, 0.8, 1.2]
    });
    expect(c.length).toBeGreaterThan(1);
    expect(c.every((x) => x >= 0.12 && x <= 2.5)).toBe(true);
  });

  it("frozen config hash is deterministic", () => {
    const a = buildFrozenConfig({
      researchRunId: "GH_REAL_7D_TEST",
      dataSource: "PEPPERSTONE_DEMO_REAL",
      datasetHash: "abc",
      theta: 0.1,
      entry: makeSymmetricEntry(0.7, 0.68, 0.63, 0.55, 2),
      maxHoldSec: 30,
      protectiveStop: 0.4,
      labelFriction: {
        entrySlippage: 0.02,
        exitSlippage: 0.02,
        executionBuffer: 0.02
      },
      trainRange: { fromMs: 1, toMs: 2 },
      validationRange: { fromMs: 3, toMs: 4 },
      holdoutRange: { fromMs: 5, toMs: 6 }
    });
    const b = buildFrozenConfig({
      researchRunId: "GH_REAL_7D_TEST",
      dataSource: "PEPPERSTONE_DEMO_REAL",
      datasetHash: "abc",
      theta: 0.1,
      entry: makeSymmetricEntry(0.7, 0.68, 0.63, 0.55, 2),
      maxHoldSec: 30,
      protectiveStop: 0.4,
      labelFriction: {
        entrySlippage: 0.02,
        exitSlippage: 0.02,
        executionBuffer: 0.02
      },
      trainRange: { fromMs: 1, toMs: 2 },
      validationRange: { fromMs: 3, toMs: 4 },
      holdoutRange: { fromMs: 5, toMs: 6 }
    });
    // createdAt differs — hash of identical payload without createdAt via re-hash of stable fields
    expect(a.config.holdoutSealed).toBe(true);
    expect(hashFrozenConfig({ ...a.config, createdAt: "fixed" })).toBe(
      hashFrozenConfig({ ...b.config, createdAt: "fixed" })
    );
  });
});
