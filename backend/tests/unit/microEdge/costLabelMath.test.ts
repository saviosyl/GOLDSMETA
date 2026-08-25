import { describe, expect, it } from "vitest";
import { estimateFriction, netEdgeFromSignedMove } from "../../../src/services/microEdge/prediction/costModel";
import { labelFromNets } from "../../../src/services/microEdge/prediction/labels";
import { scoreHorizon } from "../../../src/services/microEdge/outcomes/scorer";
import { createPrediction } from "../../../src/services/microEdge/prediction/predictor";
import { buildQuote } from "../../../src/services/microEdge/marketData/quoteRepository";
import type { MicroBar } from "../../../src/services/microEdge/types";

function bars(n: number, startMs: number, step = 60_000): MicroBar[] {
  const out: MicroBar[] = [];
  let px = 2000;
  for (let i = 0; i < n; i++) {
    const open = px;
    const close = px + ((i % 3) - 1) * 0.2;
    out.push({
      timeframe: "M1",
      openTimeMs: startMs + i * step,
      closeTimeMs: startMs + (i + 1) * step,
      open,
      high: Math.max(open, close) + 0.3,
      low: Math.min(open, close) - 0.3,
      close,
      tickVolume: 100 + i
    });
    px = close;
  }
  return out;
}

describe("Micro Edge cost/label math", () => {
  it("LONG gross = Bid_T - Ask_t and SHORT gross = Bid_t - Ask_T (no double spread)", () => {
    const t0 = Date.parse("2026-08-12T12:00:00.000Z");
    const m1 = bars(40, t0 - 40 * 60_000);
    const quote = buildQuote({
      bid: 2000,
      ask: 2000.2,
      brokerTimestamp: new Date(t0).toISOString(),
      nowMs: t0,
      freshness: "LIVE"
    });
    const { prediction } = createPrediction({
      candleCloseEpochMs: t0,
      m1,
      m5: m1.filter((_, i) => i % 5 === 4).map((b) => ({ ...b, timeframe: "M5" as const })),
      m15: m1.filter((_, i) => i % 15 === 14).map((b) => ({ ...b, timeframe: "M15" as const })),
      quote,
      spreadHistory: [0.2, 0.21, 0.19],
      nowMs: t0
    });
    const exit = buildQuote({
      bid: 2000.5,
      ask: 2000.7,
      brokerTimestamp: new Date(t0 + 60_000).toISOString(),
      nowMs: t0 + 60_000,
      freshness: "LIVE"
    });
    const outcome = scoreHorizon({
      prediction,
      horizon: "1m",
      pathQuotes: [exit],
      nowMs: t0 + 61_000
    });
    expect(outcome.scorable).toBe(true);
    expect(outcome.grossLong).toBeCloseTo(exit.bid - prediction.ask, 8);
    expect(outcome.grossShort).toBeCloseTo(prediction.bid - exit.ask, 8);
    // NET removes only slippage proxy + buffer, NOT spread again.
    const expectedNetLong =
      (outcome.grossLong ?? 0) -
      (outcome.slippageProxy ?? 0) -
      (outcome.executionBuffer ?? 0);
    expect(outcome.netLong).toBeCloseTo(expectedNetLong, 8);
  });

  it("small correct directional move becomes NO_EDGE after friction", () => {
    const friction = estimateFriction({
      currentSpread: 0.3,
      historicalSpreads: [0.3, 0.28, 0.32]
    });
    // Tiny up move 0.05 cannot beat friction ~0.3+
    const edges = netEdgeFromSignedMove(0.05, friction.estimatedFriction);
    expect(edges.netEdgeUp).toBeLessThan(0);
    const label = labelFromNets({
      horizon: "5m",
      netLong: 0.04,
      netShort: -0.2
    });
    expect(label.actualClass).toBe("NO_EDGE");
  });

  it("high probability alone does not imply tradeable edge when move < friction", () => {
    const friction = estimateFriction({
      currentSpread: 0.4,
      historicalSpreads: [0.4]
    });
    const edges = netEdgeFromSignedMove(0.05, friction.estimatedFriction);
    expect(edges.netEdgeUp).toBeLessThan(0);
    expect(edges.netEdgeDown).toBeLessThan(0);
  });
});
