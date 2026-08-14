/**
 * Reference paper simulator — hypothetical P/L only. No broker surface.
 */
import { describe, expect, it } from "vitest";
import {
  REFERENCE_PAPER_MODE,
  REFERENCE_PAPER_POLICY,
  ReferencePaperSimulator
} from "../../../../src/services/microEdge/goldHunter/fast/research/referencePaperSimulator";
import { frozenGhFastSoakConfig } from "../../../../src/services/microEdge/goldHunter/fast/frozenConfig";
import type { ResearchFeatureTelemetry } from "../../../../src/services/microEdge/goldHunter/fast/research/researchTypes";
import type { ResearchSpecialistObservation } from "../../../../src/services/microEdge/goldHunter/fast/research/researchTypes";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const friction = frozenGhFastSoakConfig().friction;
const rearm = frozenGhFastSoakConfig().rearmFloorMs;

function feat(partial: Partial<ResearchFeatureTelemetry> = {}): ResearchFeatureTelemetry {
  return {
    midVel250: 0,
    midVel500: 0,
    midVel1s: 0,
    midVel2s: 0,
    midVel3s: 0,
    acceleration: 0,
    efficiency1s: 0,
    efficiency3s: 0,
    signedImbalance1s: 0,
    depthImbalance: 0,
    weightedImbalance: 0,
    liquidityAddedBid: 0,
    liquidityAddedAsk: 0,
    liquidityRemovedBid: 0,
    liquidityRemovedAsk: 0,
    addRateBid: 0,
    addRateAsk: 0,
    removeRateBid: 0,
    removeRateAsk: 0,
    updateRate1s: 1,
    distHigh5s: 0,
    distLow5s: 0,
    upTouches5s: 0,
    downTouches5s: 0,
    bid: 4390,
    ask: 4390.1,
    spread: 0.1,
    mid: 4390.05,
    ...partial
  };
}

function selected(
  setup: ResearchSpecialistObservation["setup"],
  side: "BUY" | "SELL"
): ResearchSpecialistObservation {
  return {
    setup,
    eligible: true,
    candidateSide: side,
    rawQuality: 0.7,
    failedConditions: [],
    selectedCandidate: true
  };
}

describe("ReferencePaperSimulator", () => {
  it("BUY uses ask entry / bid exit; SELL uses bid entry / ask exit", () => {
    const sim = new ReferencePaperSimulator();
    sim.onMarketTick({
      bid: 4390.0,
      ask: 4390.1,
      tsMs: 1000,
      receiveSeq: 1,
      specialists: [selected("A_MOMENTUM_IGNITION", "BUY")],
      features: feat()
    });
    expect(sim.snapshot().openTrade?.entryPrice).toBeCloseTo(4390.1, 5);
    expect(sim.snapshot().openTrade?.entryAsk).toBeCloseTo(4390.1, 5);
    expect(sim.snapshot().openTrade?.executableExitPrice).toBeCloseTo(4390.0, 5);

    const sim2 = new ReferencePaperSimulator();
    sim2.onMarketTick({
      bid: 4390.0,
      ask: 4390.1,
      tsMs: 1000,
      receiveSeq: 1,
      specialists: [selected("B_FAST_BREAKOUT", "SELL")],
      features: feat()
    });
    expect(sim2.snapshot().openTrade?.entryPrice).toBeCloseTo(4390.0, 5);
    expect(sim2.snapshot().openTrade?.executableExitPrice).toBeCloseTo(4390.1, 5);
  });

  it("same-side repeated selected signals do not duplicate trades (one position max)", () => {
    const sim = new ReferencePaperSimulator();
    for (let i = 0; i < 5; i++) {
      sim.onMarketTick({
        bid: 4390.0,
        ask: 4390.1,
        tsMs: 1000 + i,
        receiveSeq: i + 1,
        specialists: [selected("A_MOMENTUM_IGNITION", "BUY")],
        features: feat()
      });
    }
    const s = sim.summary();
    expect(s.open).toBe(1);
    expect(s.paperTrades).toBe(1);
    expect(sim.snapshot().history).toHaveLength(0);
  });

  it("P/L, friction, MFE/MAE math", () => {
    const sim = new ReferencePaperSimulator();
    sim.onMarketTick({
      bid: 4390.0,
      ask: 4390.1,
      tsMs: 1000,
      receiveSeq: 1,
      specialists: [selected("A_MOMENTUM_IGNITION", "BUY")],
      features: feat()
    });
    // Favorable move for BUY — bid rises
    sim.onMarketTick({
      bid: 4390.4,
      ask: 4390.5,
      tsMs: 1100,
      receiveSeq: 2,
      specialists: [],
      features: feat({ acceleration: 0, signedImbalance1s: 0 })
    });
    const open = sim.snapshot().openTrade!;
    expect(open.mfe).toBeGreaterThan(0);
    expect(open.grossMove).toBeCloseTo(4390.4 - 4390.1, 5);
    expect(open.referenceFriction).toBeCloseTo(friction, 8);
    expect(open.netMove).toBeCloseTo(open.grossMove - friction, 8);

    // Force DATA_STALE close
    sim.onResync({ tsMs: 1200, receiveSeq: 3 });
    const closed = sim.snapshot().history[0]!;
    expect(closed.exitReason).toBe("DATA_STALE");
    expect(closed.exitPrice).toBeCloseTo(4390.4, 5); // BUY exits at bid
    expect(closed.grossMove).toBeCloseTo(4390.4 - 4390.1, 5);
    expect(closed.referenceFriction).toBeCloseTo(friction, 8);
    expect(closed.netMove).toBeCloseTo(closed.grossMove - friction, 8);
    expect(closed.result).toBe(
      closed.netMove > 0 ? "WIN" : closed.netMove < 0 ? "LOSS" : "BREAKEVEN"
    );
  });

  it("after exit + rearm, a new independent opportunity may open", () => {
    const sim = new ReferencePaperSimulator();
    sim.onMarketTick({
      bid: 4390.0,
      ask: 4390.1,
      tsMs: 1000,
      receiveSeq: 1,
      specialists: [selected("A_MOMENTUM_IGNITION", "BUY")],
      features: feat()
    });
    sim.onResync({ tsMs: 1100, receiveSeq: 2 });
    expect(sim.summary().open).toBe(0);
    expect(sim.summary().paperTrades).toBe(1);

    // Within rearm — ignored
    sim.onMarketTick({
      bid: 4391.0,
      ask: 4391.1,
      tsMs: 1100 + rearm - 1,
      receiveSeq: 3,
      specialists: [selected("B_FAST_BREAKOUT", "SELL")],
      features: feat()
    });
    expect(sim.summary().open).toBe(0);

    sim.onMarketTick({
      bid: 4391.0,
      ask: 4391.1,
      tsMs: 1100 + rearm + 1,
      receiveSeq: 4,
      specialists: [selected("B_FAST_BREAKOUT", "SELL")],
      features: feat()
    });
    expect(sim.summary().open).toBe(1);
    expect(sim.snapshot().openTrade?.side).toBe("SELL");
    expect(sim.summary().paperTrades).toBe(2);
  });

  it("RESYNC clears side state — no stale pre-resync quote reuse", () => {
    const sim = new ReferencePaperSimulator();
    sim.onMarketTick({
      bid: 4390.0,
      ask: 4390.1,
      tsMs: 1000,
      receiveSeq: 1,
      specialists: [selected("A_MOMENTUM_IGNITION", "BUY")],
      features: feat()
    });
    sim.onResync({ tsMs: 1100, receiveSeq: 2 });
    // Bid-only after resync must not open with old ask
    sim.onMarketTick({
      bid: 4395.0,
      ask: null,
      tsMs: 1100 + rearm + 10,
      receiveSeq: 3,
      specialists: [selected("A_MOMENTUM_IGNITION", "BUY")],
      features: feat()
    });
    expect(sim.summary().open).toBe(0);
    sim.onMarketTick({
      bid: 4395.0,
      ask: 4395.1,
      tsMs: 1100 + rearm + 20,
      receiveSeq: 4,
      specialists: [selected("A_MOMENTUM_IGNITION", "BUY")],
      features: feat()
    });
    expect(sim.snapshot().openTrade?.entryPrice).toBeCloseTo(4395.1, 5);
  });

  it("has zero broker mutation surface and documented policy", () => {
    const s = new ReferencePaperSimulator().summary();
    expect(s.mode).toBe(REFERENCE_PAPER_MODE);
    expect(s.brokerRequests).toBe(0);
    expect(s.brokerOrders).toBe(0);
    expect(s.shadowOrders).toBe(0);
    expect(s.executionAdapter).toBe("NONE");
    expect(s.mutationSurface).toBe("NONE");
    expect(REFERENCE_PAPER_POLICY.friction.value).toBe(friction);
    expect(REFERENCE_PAPER_POLICY.exit.reasons).toContain("DATA_STALE");
  });

  it("reference paper module does not import broker/execution adapters", () => {
    const src = readFileSync(
      join(
        process.cwd(),
        "src/services/microEdge/goldHunter/fast/research/referencePaperSimulator.ts"
      ),
      "utf8"
    );
    expect(src).not.toMatch(/ShadowExecutionAdapter|submitOrder|ProtoOANewOrder/);
    expect(src).toMatch(/evaluateOpenExit/);
    expect(src).toMatch(/REFERENCE_PAPER_ONLY/);
  });
});
