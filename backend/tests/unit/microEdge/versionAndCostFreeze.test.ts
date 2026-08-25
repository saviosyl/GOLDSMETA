import { describe, expect, it } from "vitest";
import { createPrediction } from "../../../src/services/microEdge/prediction/predictor";
import { scoreHorizon } from "../../../src/services/microEdge/outcomes/scorer";
import { buildQuote } from "../../../src/services/microEdge/marketData/quoteRepository";
import { labelFromNets } from "../../../src/services/microEdge/prediction/labels";
import { estimateFriction, netEdgeFromSignedMove } from "../../../src/services/microEdge/prediction/costModel";
import type { MicroBar, MicroPrediction } from "../../../src/services/microEdge/types";

function bars(n: number, endCloseMs: number): MicroBar[] {
  const out: MicroBar[] = [];
  let px = 2400;
  for (let i = 0; i < n; i++) {
    const closeTimeMs = endCloseMs - (n - 1 - i) * 60_000;
    out.push({
      timeframe: "M1",
      openTimeMs: closeTimeMs - 60_000,
      closeTimeMs,
      open: px,
      high: px + 0.3,
      low: px - 0.3,
      close: px + 0.1,
      tickVolume: 50
    });
    px += 0.1;
  }
  return out;
}

describe("Micro Edge frozen version + cost attribution", () => {
  it("outcome inherits prediction versions even if globals would be newer", () => {
    const t = Date.parse("2026-08-12T14:00:00.000Z");
    const m1 = bars(40, t);
    const quote = buildQuote({
      bid: 2400,
      ask: 2400.2,
      brokerTimestamp: new Date(t).toISOString(),
      nowMs: t,
      freshness: "LIVE"
    });
    const { prediction } = createPrediction({
      candleCloseEpochMs: t,
      m1,
      m5: [],
      m15: [],
      quote,
      spreadHistory: [0.2, 0.21],
      nowMs: t
    });

    // Simulate an immutable historical prediction with OLD versions.
    const oldPred: MicroPrediction = {
      ...prediction,
      modelVersion: "logistic-champion-v0.9.0-OLD",
      costModelVersion: "cost-proxy-v0.9.0-OLD",
      labelVersion: "label-theta-v0.9.0-OLD",
      featureVersion: "features-v0.9.0-OLD",
      calibrationVersion: "calibration-none-v0.9.0-OLD",
      regimeVersion: "regime-v0.9.0-OLD",
      costAssumptions: {
        ...prediction.costAssumptions,
        costModelVersion: "cost-proxy-v0.9.0-OLD",
        entrySlippageProxy: 0.03,
        exitSlippageProxy: 0.03,
        executionBuffer: 0.01,
        entryHalfSpread: 0.1,
        estimatedExitHalfSpread: 0.1,
        assumedLatencyMs: 250,
        slippageMethod: "PROXY",
        estimatedFriction: 0.27
      },
      labelThetaByHorizon: { "1m": 0.05, "5m": 0.08, "15m": 0.12 }
    };

    const exit = buildQuote({
      bid: 2400.6,
      ask: 2400.8,
      brokerTimestamp: new Date(t + 60_000).toISOString(),
      nowMs: t + 60_000,
      freshness: "LIVE"
    });
    const outcome = scoreHorizon({
      prediction: oldPred,
      horizon: "1m",
      pathQuotes: [exit],
      nowMs: t + 61_000
    });

    expect(outcome.modelVersion).toBe("logistic-champion-v0.9.0-OLD");
    expect(outcome.costModelVersion).toBe("cost-proxy-v0.9.0-OLD");
    expect(outcome.labelVersion).toBe("label-theta-v0.9.0-OLD");
    expect(outcome.featureVersion).toBe("features-v0.9.0-OLD");
    expect(outcome.calibrationVersion).toBe("calibration-none-v0.9.0-OLD");
    expect(outcome.regimeVersion).toBe("regime-v0.9.0-OLD");
    expect(outcome.costAssumptions?.costModelVersion).toBe("cost-proxy-v0.9.0-OLD");
    expect(outcome.executionBuffer).toBe(0.01);
    expect(outcome.slippageProxy).toBeCloseTo(0.06, 8);
  });

  it("outcome NET uses frozen prediction cost assumptions (not regenerated)", () => {
    const t = Date.parse("2026-08-12T15:00:00.000Z");
    const m1 = bars(40, t);
    const quote = buildQuote({
      bid: 2500,
      ask: 2500.4,
      brokerTimestamp: new Date(t).toISOString(),
      nowMs: t,
      freshness: "LIVE"
    });
    const { prediction } = createPrediction({
      candleCloseEpochMs: t,
      m1,
      m5: [],
      m15: [],
      quote,
      spreadHistory: [0.4],
      nowMs: t
    });

    // Freeze weird historical costs that differ from what estimateFriction would produce today.
    const frozenPred: MicroPrediction = {
      ...prediction,
      costAssumptions: {
        entryHalfSpread: 0.2,
        estimatedExitHalfSpread: 0.25,
        entrySlippageProxy: 0.11,
        exitSlippageProxy: 0.11,
        executionBuffer: 0.07,
        assumedLatencyMs: 999,
        slippageMethod: "PROXY",
        costModelVersion: prediction.costModelVersion,
        estimatedFriction: 0.74
      }
    };

    const exit = buildQuote({
      bid: 2501,
      ask: 2501.4,
      brokerTimestamp: new Date(t + 60_000).toISOString(),
      nowMs: t + 60_000,
      freshness: "LIVE"
    });
    const outcome = scoreHorizon({
      prediction: frozenPred,
      horizon: "1m",
      pathQuotes: [exit],
      nowMs: t + 61_000
    });

    const grossLong = exit.bid - frozenPred.ask;
    const grossShort = frozenPred.bid - exit.ask;
    expect(outcome.grossLong).toBeCloseTo(grossLong, 8);
    expect(outcome.grossShort).toBeCloseTo(grossShort, 8);
    // Do NOT subtract spread again — only frozen slip + buffer.
    expect(outcome.netLong).toBeCloseTo(grossLong - 0.11 - 0.11 - 0.07, 8);
    expect(outcome.netShort).toBeCloseTo(grossShort - 0.11 - 0.11 - 0.07, 8);
    expect(outcome.costAssumptions?.assumedLatencyMs).toBe(999);
    expect(outcome.costAssumptions?.entryHalfSpread).toBe(0.2);
  });

  it("prediction persists full cost assumption fields", () => {
    const t = Date.parse("2026-08-12T16:00:00.000Z");
    const m1 = bars(40, t);
    const quote = buildQuote({
      bid: 2600,
      ask: 2600.3,
      brokerTimestamp: new Date(t).toISOString(),
      nowMs: t,
      freshness: "LIVE"
    });
    const { prediction } = createPrediction({
      candleCloseEpochMs: t,
      m1,
      m5: [],
      m15: [],
      quote,
      spreadHistory: [0.3, 0.28],
      nowMs: t
    });
    const c = prediction.costAssumptions;
    expect(c.slippageMethod).toBe("PROXY");
    expect(c.costModelVersion).toBeTruthy();
    expect(Number.isFinite(c.entryHalfSpread)).toBe(true);
    expect(Number.isFinite(c.estimatedExitHalfSpread)).toBe(true);
    expect(Number.isFinite(c.entrySlippageProxy)).toBe(true);
    expect(Number.isFinite(c.exitSlippageProxy)).toBe(true);
    expect(Number.isFinite(c.executionBuffer)).toBe(true);
    expect(Number.isFinite(c.assumedLatencyMs)).toBe(true);
    expect(prediction.labelThetaByHorizon["5m"]).toBeGreaterThan(0);
  });

  it("correct direction but insufficient NET edge labels NO_EDGE", () => {
    const friction = estimateFriction({
      currentSpread: 0.35,
      historicalSpreads: [0.35, 0.34]
    });
    const edges = netEdgeFromSignedMove(0.04, friction.estimatedFriction);
    expect(edges.netEdgeUp).toBeLessThan(0);
    // Tiny positive long NET below theta → NO_EDGE
    expect(
      labelFromNets({ horizon: "5m", netLong: 0.03, netShort: -0.4, theta: 0.08 }).actualClass
    ).toBe("NO_EDGE");
  });
});
