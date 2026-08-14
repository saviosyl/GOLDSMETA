/**
 * Reference paper simulator — hypothetical P/L only. No broker surface.
 */
import { describe, expect, it } from "vitest";
import {
  REFERENCE_PAPER_MODE,
  REFERENCE_PAPER_POLICY,
  REFERENCE_POSITION_VALUE_EUR,
  ReferencePaperSimulator,
  hypotheticalEurPnlFromNetMove
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
    selectedCandidate: true,
    depthValidity: "DEPTH_VALID",
    derivedDataContaminated: false
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
      features: feat(),
      dataOk: true
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
      features: feat(),
      dataOk: true
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
        features: feat(),
        dataOk: true
      });
    }
    const s = sim.summary();
    expect(s.open).toBe(1);
    expect(s.paperTrades).toBe(1);
    expect(sim.snapshot().history).toHaveLength(0);
  });

  it("dataOk=false cannot open paper trade; dataOk=true may open later", () => {
    const sim = new ReferencePaperSimulator();
    sim.onMarketTick({
      bid: 4390.0,
      ask: 4390.1,
      tsMs: 1000,
      receiveSeq: 1,
      specialists: [selected("A_MOMENTUM_IGNITION", "BUY")],
      features: feat(),
      dataOk: false
    });
    expect(sim.summary().paperTrades).toBe(0);
    expect(sim.summary().open).toBe(0);
    expect(sim.summary().paperEntriesBlockedDataNotOk).toBe(1);

    sim.onMarketTick({
      bid: 4390.0,
      ask: 4390.1,
      tsMs: 1100,
      receiveSeq: 2,
      specialists: [selected("A_MOMENTUM_IGNITION", "BUY")],
      features: feat(),
      dataOk: true
    });
    expect(sim.summary().open).toBe(1);
    expect(sim.summary().paperTrades).toBe(1);
  });

  it("DATA_STALE close cannot immediately reopen while dataOk=false", () => {
    const sim = new ReferencePaperSimulator();
    sim.onMarketTick({
      bid: 4390.0,
      ask: 4390.1,
      tsMs: 1000,
      receiveSeq: 1,
      specialists: [selected("A_MOMENTUM_IGNITION", "BUY")],
      features: feat(),
      dataOk: true
    });
    expect(sim.summary().open).toBe(1);

    // Force DATA_STALE via dataOk=false while open
    sim.onMarketTick({
      bid: 4390.0,
      ask: 4390.1,
      tsMs: 1100,
      receiveSeq: 2,
      specialists: [],
      features: feat(),
      dataOk: false
    });
    expect(sim.summary().open).toBe(0);
    expect(sim.summary().paperDataStaleExits).toBe(1);
    expect(sim.snapshot().history[0]?.exitReason).toBe("DATA_STALE");

    // After rearm, selected + dataOk=false still blocked
    sim.onMarketTick({
      bid: 4391.0,
      ask: 4391.1,
      tsMs: 1100 + rearm + 10,
      receiveSeq: 3,
      specialists: [selected("B_FAST_BREAKOUT", "SELL")],
      features: feat(),
      dataOk: false
    });
    expect(sim.summary().open).toBe(0);
    expect(sim.summary().paperEntriesBlockedDataNotOk).toBeGreaterThanOrEqual(1);

    sim.onMarketTick({
      bid: 4391.0,
      ask: 4391.1,
      tsMs: 1100 + rearm + 20,
      receiveSeq: 4,
      specialists: [selected("B_FAST_BREAKOUT", "SELL")],
      features: feat(),
      dataOk: true
    });
    expect(sim.summary().open).toBe(1);
  });

  it("P/L, friction, MFE/MAE math", () => {
    const sim = new ReferencePaperSimulator();
    sim.onMarketTick({
      bid: 4390.0,
      ask: 4390.1,
      tsMs: 1000,
      receiveSeq: 1,
      specialists: [selected("A_MOMENTUM_IGNITION", "BUY")],
      features: feat(),
      dataOk: true
    });
    sim.onMarketTick({
      bid: 4390.4,
      ask: 4390.5,
      tsMs: 1100,
      receiveSeq: 2,
      specialists: [],
      features: feat({ acceleration: 0, signedImbalance1s: 0 }),
      dataOk: true
    });
    const open = sim.snapshot().openTrade!;
    expect(open.mfe).toBeGreaterThan(0);
    expect(open.grossMove).toBeCloseTo(4390.4 - 4390.1, 5);
    expect(open.referenceFriction).toBeCloseTo(friction, 8);
    expect(open.netMove).toBeCloseTo(open.grossMove - friction, 8);

    sim.onResync({ tsMs: 1200, receiveSeq: 3 });
    const closed = sim.snapshot().history[0]!;
    expect(closed.exitReason).toBe("DATA_STALE");
    expect(closed.exitPrice).toBeCloseTo(4390.4, 5);
    expect(closed.grossMove).toBeCloseTo(4390.4 - 4390.1, 5);
    expect(closed.referenceFriction).toBeCloseTo(friction, 8);
    expect(closed.netMove).toBeCloseTo(closed.grossMove - friction, 8);
    expect(sim.summary().paperResyncExits).toBe(1);
    expect(sim.summary().paperDataStaleExits).toBe(1);
  });

  it("after exit + rearm, a new independent opportunity may open", () => {
    const sim = new ReferencePaperSimulator();
    sim.onMarketTick({
      bid: 4390.0,
      ask: 4390.1,
      tsMs: 1000,
      receiveSeq: 1,
      specialists: [selected("A_MOMENTUM_IGNITION", "BUY")],
      features: feat(),
      dataOk: true
    });
    sim.onResync({ tsMs: 1100, receiveSeq: 2 });
    expect(sim.summary().open).toBe(0);
    expect(sim.summary().paperTrades).toBe(1);

    sim.onMarketTick({
      bid: 4391.0,
      ask: 4391.1,
      tsMs: 1100 + rearm - 1,
      receiveSeq: 3,
      specialists: [selected("B_FAST_BREAKOUT", "SELL")],
      features: feat(),
      dataOk: true
    });
    expect(sim.summary().open).toBe(0);

    sim.onMarketTick({
      bid: 4391.0,
      ask: 4391.1,
      tsMs: 1100 + rearm + 1,
      receiveSeq: 4,
      specialists: [selected("B_FAST_BREAKOUT", "SELL")],
      features: feat(),
      dataOk: true
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
      features: feat(),
      dataOk: true
    });
    sim.onResync({ tsMs: 1100, receiveSeq: 2 });
    sim.onMarketTick({
      bid: 4395.0,
      ask: null,
      tsMs: 1100 + rearm + 10,
      receiveSeq: 3,
      specialists: [selected("A_MOMENTUM_IGNITION", "BUY")],
      features: feat(),
      dataOk: true
    });
    expect(sim.summary().open).toBe(0);
    sim.onMarketTick({
      bid: 4395.0,
      ask: 4395.1,
      tsMs: 1100 + rearm + 20,
      receiveSeq: 4,
      specialists: [selected("A_MOMENTUM_IGNITION", "BUY")],
      features: feat(),
      dataOk: true
    });
    expect(sim.snapshot().openTrade?.entryPrice).toBeCloseTo(4395.1, 5);
  });

  it(">80 closed trades retain cumulative totals; history capped at 80", () => {
    const sim = new ReferencePaperSimulator({ historyLimit: 80 });
    let ts = 1000;
    let seq = 0;
    // Force closes via DATA_STALE so we can accumulate many trades quickly
    for (let i = 0; i < 95; i++) {
      seq += 1;
      ts += rearm + 5;
      sim.onMarketTick({
        bid: 4390.0 + i * 0.01,
        ask: 4390.1 + i * 0.01,
        tsMs: ts,
        receiveSeq: seq,
        specialists: [selected("A_MOMENTUM_IGNITION", "BUY")],
        features: feat(),
        dataOk: true
      });
      expect(sim.summary().open).toBe(1);
      seq += 1;
      ts += 10;
      // Favorable then stale-close so nets are deterministic-ish
      sim.onMarketTick({
        bid: 4390.0 + i * 0.01 + 0.2,
        ask: 4390.1 + i * 0.01 + 0.2,
        tsMs: ts,
        receiveSeq: seq,
        specialists: [],
        features: feat(),
        dataOk: true
      });
      sim.onResync({ tsMs: ts + 1, receiveSeq: seq + 1 });
      seq += 1;
      ts += 1;
    }

    const s = sim.summary();
    expect(s.totalClosedTrades).toBe(95);
    expect(s.paperTrades).toBe(95);
    expect(s.historyRows).toBe(80);
    expect(sim.snapshot().history).toHaveLength(80);
    expect(s.wins + s.losses + s.breakeven).toBe(95);
    expect(s.netMoveSum).toBeCloseTo(s.grossMoveSum - s.frictionSum, 8);
    expect(s.frictionSum).toBeCloseTo(95 * friction, 8);
    // PF from cumulative, not history window
    const histNet = sim
      .snapshot()
      .history.reduce((a, t) => a + t.netMove, 0);
    // history is only last 80 — cumulative net must differ if early trades existed
    expect(s.netMoveSum).not.toBeCloseTo(histNet, 5);
    expect(s.profitFactor).not.toBeNull();
    expect(s.tradesPerHour).not.toBeNull();
    expect(s.tradesPerHourLabel).toBe("PAPER TRADES / HOUR — CURRENT RUNTIME");
    expect(s.paperResyncExits).toBe(95);
    expect(s.paperDataStaleExits).toBe(95);
  });

  it("PF and cumulative net use all closed trades, not only history window", () => {
    const sim = new ReferencePaperSimulator({ historyLimit: 3 });
    // Trade 1: big win via resync after favorable move
    sim.onMarketTick({
      bid: 4390,
      ask: 4390.1,
      tsMs: 1000,
      receiveSeq: 1,
      specialists: [selected("A_MOMENTUM_IGNITION", "BUY")],
      features: feat(),
      dataOk: true
    });
    sim.onMarketTick({
      bid: 4391.0,
      ask: 4391.1,
      tsMs: 1100,
      receiveSeq: 2,
      specialists: [],
      features: feat(),
      dataOk: true
    });
    sim.onResync({ tsMs: 1200, receiveSeq: 3 });
    const win1 = 4391.0 - 4390.1 - friction;

    // Trades 2-5: small losses (exit near entry via DATA_STALE immediately after open path)
    for (let i = 0; i < 4; i++) {
      const t0 = 2000 + i * (rearm + 50);
      sim.onMarketTick({
        bid: 4400,
        ask: 4400.1,
        tsMs: t0,
        receiveSeq: 10 + i * 2,
        specialists: [selected("B_FAST_BREAKOUT", "BUY")],
        features: feat(),
        dataOk: true
      });
      // Exit at same bid → gross = bid - ask = -0.1, net = -0.1 - 0.06
      sim.onResync({ tsMs: t0 + 5, receiveSeq: 11 + i * 2 });
    }
    const lossEach = Math.abs(4400 - 4400.1 - friction);
    const s = sim.summary();
    expect(s.totalClosedTrades).toBe(5);
    expect(s.historyRows).toBe(3);
    expect(sim.snapshot().history).toHaveLength(3);
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(4);
    expect(s.netMoveSum).toBeCloseTo(win1 - 4 * lossEach, 8);
    expect(s.profitFactor).toBeCloseTo(win1 / (4 * lossEach), 5);
  });

  it("hypothetical EUR P/L is display-only (netMove/entryPrice)*1000 with €500 paper balance", () => {
    expect(REFERENCE_POSITION_VALUE_EUR).toBe(1000);
    const eur = hypotheticalEurPnlFromNetMove(0.4, 4390);
    expect(eur).toBeCloseTo((0.4 / 4390) * 1000, 8);

    const sim = new ReferencePaperSimulator();
    sim.onMarketTick({
      bid: 4390.0,
      ask: 4390.1,
      tsMs: 1000,
      receiveSeq: 1,
      specialists: [selected("A_MOMENTUM_IGNITION", "BUY")],
      features: feat(),
      dataOk: true
    });
    sim.onMarketTick({
      bid: 4390.4,
      ask: 4390.5,
      tsMs: 1100,
      receiveSeq: 2,
      specialists: [],
      features: feat(),
      dataOk: true
    });
    sim.onResync({ tsMs: 1200, receiveSeq: 3 });
    const closed = sim.snapshot().history[0]!;
    const expected = (closed.netMove / closed.entryPrice) * 1000;
    expect(closed.hypotheticalEurPnl).toBeCloseTo(expected, 8);
    expect(closed.balanceAfterEur).toBeCloseTo(500 + expected, 8);
    expect(sim.summary().hypotheticalEurPnlSum).toBeCloseTo(expected, 8);
    expect(sim.summary().startingBalanceEur).toBe(500);
    expect(sim.summary().currentBalanceEur).toBeCloseTo(500 + expected, 8);
    expect(sim.summary().referenceMarketExposureEur).toBe(1000);
    expect(sim.summary().referenceMarginUsedEur).toBe(500);
    expect(sim.summary().marginRequirementPct).toBe(50);
    expect(sim.summary().hypotheticalEurPnlLabel).toContain("PAPER ACCOUNT");
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
    expect(REFERENCE_PAPER_POLICY.entry.invalidData).toMatch(/dataOk/);
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
