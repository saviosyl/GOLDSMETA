/**
 * Entry reconciliation / integrity hotfix tests.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  reconcileGoldHunterDemoPositions
} from "../../../src/services/goldHunterAdmin/reconcilePositions";
import {
  repairGoldHunterTradeFromBrokerPosition,
  repairGoldHunterTradeEntryFromDeal,
  preserveGoldHunterEntryOnClose,
  goldHunterFrozenInitialRiskPrice
} from "../../../src/services/goldHunterAdmin/entryRepair";
import {
  applyBrokerSettledClose,
  notifySelectorOfSettledGoldHunterClose,
  realisedRFromSettledDemoTrade,
  resetGoldHunterCloseSettlementHooksForTests
} from "../../../src/services/goldHunterAdmin/closeSettlement";
import {
  GoldHunterStrategySelector,
  getGoldHunterStrategySelector,
  resetGoldHunterStrategySelectorsForTests
} from "../../../src/services/goldHunterAdmin/strategySelector";
import {
  registerGoldHunterOpenPositionForOwner,
  resetGoldHunterPositionManagerForTests,
  setGoldHunterPositionManagerHooksForTests
} from "../../../src/services/goldHunterAdmin/demoPositionManager";
import {
  upsertGoldHunterDemoTrade,
  resetGoldHunterTradeMemory
} from "../../../src/services/goldHunterAdmin/tradeStore";
import type { GoldHunterDemoTrade } from "../../../src/services/goldHunterAdmin/types";
import {
  defaultGhFastConfig,
  SMART_LOSS_PERSIST_SNAPSHOTS,
  openGhAbcTrade as openTrade,
  updateGhAbcOpenTrade as updateOpenTrade,
  evaluateGhAbcOpenExit as evaluateOpenExit
} from "../../../src/services/goldHunterAdmin/abc";
import type { GhFastFeatureSnapshot } from "../../../src/services/goldHunterAdmin/abc/features";
import type { DepthBookStats } from "../../../src/services/goldHunterAdmin/abc/depthBook";
import {
  GH_ADMIN_DEFAULT_CONFIG,
  GH_ADMIN_EXECUTION_MODE
} from "../../../src/services/goldHunterAdmin/types";

const OWNER = "owner-entry-repair-test";
const HARD = goldHunterFrozenInitialRiskPrice();

function baseTrade(over: Partial<GoldHunterDemoTrade> = {}): GoldHunterDemoTrade {
  return {
    goldHunterTradeId: "GH-D-repair-1",
    strategy: "GOLD_HUNTER",
    environment: "DEMO",
    setup: "A",
    side: "BUY",
    signalTs: "2026-08-19T15:18:11.000Z",
    orderTs: "2026-08-19T15:18:11.000Z",
    fillTs: null,
    closeTs: null,
    entry: null,
    exit: null,
    stop: 2600 - HARD,
    entrySpread: null,
    durationMs: null,
    mfe: null,
    mae: null,
    grossPnlEur: null,
    netPnlEur: null,
    result: null,
    exitReason: null,
    brokerOrderId: "ord-1",
    brokerPositionId: "pos-1",
    status: "PENDING_RECONCILIATION",
    signalId: "sig-1",
    dataQuality: "ENTRY_INVALID",
    errorCode: "ENTRY_PRICE_INVALID",
    initialRiskPrice: HARD,
    filledVolumeLots: null,
    ...over
  };
}

function feat(bid: number, ask: number, over: Partial<GhFastFeatureSnapshot> = {}): GhFastFeatureSnapshot {
  const mid = (bid + ask) / 2;
  const depthBase = {
    available: true,
    topBidDepth: 10,
    topAskDepth: 10,
    bidDepthN: 10,
    askDepthN: 10,
    bidLevels: 3,
    askLevels: 3,
    depthRatio: 1,
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
    bestBid: bid,
    bestAsk: ask,
    spread: ask - bid,
    crossed: false,
    lastUpdateMs: 0,
    lastValidBookMs: 0,
    consecutiveInvalidSnapshots: 0,
    bookGeneration: 1,
    resyncCount: 0,
    deleteHits: 0
  } as DepthBookStats;
  return {
    bid, ask, mid, spread: ask - bid,
    bidVel250: 0, bidVel500: 0, bidVel1s: 0, bidVel2s: 0, bidVel3s: 0, askVel1s: 0,
    midVel250: 0, midVel500: 0, midVel1s: 0, midVel2s: 0, midVel3s: 0,
    acceleration: 0, updateRate1s: 10, signedImbalance1s: 0,
    efficiency1s: 0.5, efficiency3s: 0.5,
    high1s: mid, low1s: mid, high2s: mid, low2s: mid, high5s: mid, low5s: mid,
    high10s: mid, low10s: mid, high15s: mid, low15s: mid, high30s: mid, low30s: mid,
    priorHigh5s: mid, priorLow5s: mid, priorHigh10s: mid, priorLow10s: mid,
    distHigh1s: 0, distLow1s: 0, distHigh5s: 0, distLow5s: 0,
    distPriorHigh5s: 0, distPriorLow5s: 0, upTouches5s: 0, downTouches5s: 0,
    depth: depthBase,
    ...over,
    depth: (over.depth ? { ...depthBase, ...over.depth } : depthBase) as DepthBookStats
  };
}

describe("Entry repair from broker position", () => {
  it("backfills missing entry/volume/stop without overwriting valid entry", () => {
    const trade = baseTrade();
    const r = repairGoldHunterTradeFromBrokerPosition({
      trade,
      position: {
        positionId: "pos-1",
        side: "BUY",
        entryPrice: 2600.12,
        stopLoss: 2599.57,
        volumeLots: 0.09
      }
    });
    expect(r.entryRepaired).toBe(true);
    expect(r.trade.entry).toBe(2600.12);
    expect(r.trade.entryRecoverySource).toBe("BROKER_POSITION_RECONCILIATION");
    expect(r.trade.status).toBe("FILLED");
    expect(r.trade.filledVolumeLots).toBe(0.09);
    expect(r.trade.dataQuality).toBeNull();
    expect(r.trade.initialRiskPrice).toBe(HARD);

    const keep = repairGoldHunterTradeFromBrokerPosition({
      trade: { ...r.trade, entry: 2600.12 },
      position: {
        positionId: "pos-1",
        entryPrice: 9999,
        volumeLots: 0.09,
        stopLoss: 2599.57
      }
    });
    expect(keep.trade.entry).toBe(2600.12);
    expect(keep.entryRepaired).toBe(false);
  });

  it("reconcileGoldHunterDemoPositions repairs existing PENDING_RECONCILIATION", async () => {
    resetGoldHunterTradeMemory();
    const pending = baseTrade({ goldHunterTradeId: "GH-D-recon-1" });
    await upsertGoldHunterDemoTrade(OWNER, pending);
    const r = await reconcileGoldHunterDemoPositions({
      ownerUid: OWNER,
      brokerPositions: [
        {
          positionId: "pos-1",
          label: "GH-D-recon-1",
          comment: "GOLD_HUNTER",
          side: "BUY",
          entryPrice: 2601.5,
          stopLoss: 2601.5 - HARD,
          volumeLots: 0.09
        }
      ]
    });
    expect(r.entryRepaired).toBeGreaterThanOrEqual(1);
    const repaired = r.restored.find((t) => t.goldHunterTradeId === "GH-D-recon-1");
    expect(repaired?.entry).toBe(2601.5);
    expect(repaired?.status).toBe("FILLED");
    expect(repaired?.entryRecoverySource).toBe("BROKER_POSITION_RECONCILIATION");
  });
});

describe("Settlement entry integrity + true R", () => {
  it("never clears known entry; deal entryPrice repairs null entry; R calculable", () => {
    const withEntry = baseTrade({
      entry: 2600,
      status: "FILLED",
      fillTs: "2026-08-19T15:18:11.000Z",
      dataQuality: null,
      errorCode: null
    });
    const cleared = preserveGoldHunterEntryOnClose(withEntry, {
      ...withEntry,
      entry: null,
      status: "CLOSED"
    });
    expect(cleared.entry).toBe(2600);

    const nullEntry = baseTrade({
      status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT",
      exitReason: "BROKER_EXTERNAL_CLOSE"
    });
    const settled = applyBrokerSettledClose({
      trade: nullEntry,
      deal: {
        dealId: "d1",
        orderId: "o1",
        positionId: "pos-1",
        netPnl: -6.25,
        grossPnl: -5.7,
        commission: -0.55,
        swap: 0,
        closePrice: 2599.45,
        entryPrice: 2600,
        closedAt: "2026-08-19T15:18:14.000Z",
        closedVolumeLots: 0.09
      }
    });
    expect(settled.entry).toBe(2600);
    expect(settled.entryRecoverySource).toBe("BROKER_DEAL_SETTLEMENT");
    expect(settled.initialRiskPrice).toBe(HARD);
    expect(realisedRFromSettledDemoTrade(settled)).toBeCloseTo(
      (2599.45 - 2600) / HARD,
      6
    );
  });
});

describe("Unknown realised-R fail-safe", () => {
  beforeEach(() => {
    resetGoldHunterStrategySelectorsForTests();
  });

  function armUnknownRGuard(sel: GoldHunterStrategySelector, baseMs = 1_000_000) {
    for (let i = 0; i < 3; i++) {
      sel.notifyTradeClosed({
        side: "BUY",
        setup: "A",
        entryPrice: null,
        result: "LOSS",
        tradeId: `gh-unk-${i}`,
        realisedR: null,
        closedAtMs: baseMs + i * 1000
      });
    }
  }

  it("A) 3 consecutive unknown-R losses => WAIT_REALISED_R_INCOMPLETE active", () => {
    const sel = new GoldHunterStrategySelector();
    armUnknownRGuard(sel);
    const st = sel.getLossControllerEntryState();
    expect(st.consecutiveUnknownRLosses).toBe(3);
    expect(st.unknownRealisedRLossCount).toBe(3);
    expect(st.unknownRGuardActive).toBe(true);
    expect(st.entryIntegrityHealthy).toBe(false);
    expect(st.rollingSampleCount).toBe(0);

    const gate = sel.evaluateAntiChurnGateForTests({
      side: "BUY",
      atMs: 1_002_000,
      mid: 2599,
      signedImbalance1s: 0.2,
      midVel250: 0.001
    });
    expect(gate.ok).toBe(false);
    expect(gate.rejectionReason).toBe("WAIT_REALISED_R_INCOMPLETE");
  });

  it("B) time+structure+direction without integrity recovery still gated", () => {
    const sel = new GoldHunterStrategySelector();
    armUnknownRGuard(sel);
    // 60s+ elapsed; null entryPrice makes structural reset auto-complete;
    // directional confirmation present — but no integrity recovery signal.
    const gate = sel.evaluateAntiChurnGateForTests({
      side: "BUY",
      atMs: 1_002_000 + 60_000,
      mid: 2599,
      signedImbalance1s: 0.2,
      midVel250: 0.001
    });
    expect(gate.ok).toBe(false);
    expect(gate.rejectionReason).toBe("WAIT_REALISED_R_INCOMPLETE");
    expect(sel.getLossControllerEntryState().unknownRGuardActive).toBe(true);
    expect(sel.getLossControllerEntryState().entryIntegrityHealthy).toBe(false);
  });

  it("C) integrity recovery + time + structure + direction clears guard", () => {
    const sel = new GoldHunterStrategySelector();
    armUnknownRGuard(sel);
    const recoveredAt = 1_002_000 + 30_000;
    sel.notifyEntryIntegrityRecovered({
      atMs: recoveredAt,
      reason: "BROKER_POSITION_ENTRY_REPAIRED",
      tradeId: "GH-D-repaired"
    });
    expect(sel.getLossControllerEntryState().entryIntegrityHealthy).toBe(true);
    expect(sel.getLossControllerEntryState().entryIntegrityRecoveredAtMs).toBe(
      recoveredAt
    );

    const gate = sel.evaluateAntiChurnGateForTests({
      side: "BUY",
      atMs: 1_002_000 + 60_000,
      mid: 2599,
      signedImbalance1s: 0.2,
      midVel250: 0.001
    });
    expect(gate.ok).toBe(true);
    expect(gate.rejectionReason).toBeNull();
    expect(sel.getLossControllerEntryState().unknownRGuardActive).toBe(false);
  });

  it("D) after recovery, true-R settlement enters rollingRealisedR exactly once", () => {
    const sel = getGoldHunterStrategySelector(OWNER);
    armUnknownRGuard(sel);
    sel.notifyEntryIntegrityRecovered({
      atMs: 1_050_000,
      reason: "BROKER_POSITION_ENTRY_REPAIRED"
    });
    sel.evaluateAntiChurnGateForTests({
      side: "BUY",
      atMs: 1_070_000,
      mid: 2599,
      signedImbalance1s: 0.2,
      midVel250: 0.001
    });
    expect(sel.getLossControllerEntryState().unknownRGuardActive).toBe(false);

    const settled = applyBrokerSettledClose({
      trade: baseTrade({
        goldHunterTradeId: "GH-D-true-r-1",
        entry: 2600,
        status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT",
        dataQuality: null,
        errorCode: null,
        fillTs: "2026-08-19T15:18:11.000Z",
        initialRiskPrice: HARD
      }),
      deal: {
        dealId: "d-true",
        orderId: "o-true",
        positionId: "pos-1",
        netPnl: -3.5,
        grossPnl: -3.2,
        commission: -0.3,
        swap: 0,
        closePrice: 2600 - HARD * 0.7,
        entryPrice: 2600,
        closedAt: "2026-08-19T15:20:00.000Z",
        closedVolumeLots: 0.09
      },
      exitReason: "SMART_SOFT_MAX_LOSS"
    });
    const r = realisedRFromSettledDemoTrade(settled);
    expect(r).toBeCloseTo(-0.7, 6);
    notifySelectorOfSettledGoldHunterClose({ ownerUid: OWNER, trade: settled });
    const st = sel.getLossControllerEntryState();
    expect(st.rollingSampleCount).toBe(1);
    expect(st.rollingRealisedR).toBeCloseTo(-0.7, 6);
  });

  it("E) duplicate settlement cannot clear/alter integrity state incorrectly", () => {
    const sel = getGoldHunterStrategySelector(OWNER);
    armUnknownRGuard(sel);
    expect(sel.getLossControllerEntryState().entryIntegrityHealthy).toBe(false);
    expect(sel.getLossControllerEntryState().unknownRGuardActive).toBe(true);

    const settled = applyBrokerSettledClose({
      trade: baseTrade({
        goldHunterTradeId: "GH-D-dup-1",
        entry: null,
        status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT",
        exitReason: "BROKER_EXTERNAL_CLOSE"
      }),
      deal: {
        dealId: "d-dup",
        orderId: "o-dup",
        positionId: "pos-1",
        netPnl: -5,
        grossPnl: -4.5,
        commission: -0.5,
        swap: 0,
        closePrice: 2599.4,
        // No entryPrice on deal — R stays unknown
        entryPrice: null,
        closedAt: "2026-08-19T15:20:00.000Z",
        closedVolumeLots: 0.09
      }
    });
    notifySelectorOfSettledGoldHunterClose({ ownerUid: OWNER, trade: settled });
    notifySelectorOfSettledGoldHunterClose({ ownerUid: OWNER, trade: settled });
    const st = sel.getLossControllerEntryState();
    // Duplicate must not invent integrity recovery or clear the latch.
    expect(st.entryIntegrityHealthy).toBe(false);
    expect(st.unknownRGuardActive).toBe(true);
    expect(st.entryIntegrityRecoveredAtMs).toBeNull();
    expect(st.rollingSampleCount).toBe(0);

    // Still gated without integrity recovery even after 60s + direction.
    const gate = sel.evaluateAntiChurnGateForTests({
      side: "BUY",
      atMs: 1_070_000,
      mid: 2599,
      signedImbalance1s: 0.2,
      midVel250: 0.001
    });
    expect(gate.ok).toBe(false);
    expect(gate.rejectionReason).toBe("WAIT_REALISED_R_INCOMPLETE");
  });

  it("reconcile entry repair signals integrity recovery", async () => {
    resetGoldHunterTradeMemory();
    const sel = getGoldHunterStrategySelector(OWNER);
    armUnknownRGuard(sel);
    expect(sel.getLossControllerEntryState().entryIntegrityHealthy).toBe(false);

    await upsertGoldHunterDemoTrade(
      OWNER,
      baseTrade({ goldHunterTradeId: "GH-D-int-rec" })
    );
    const r = await reconcileGoldHunterDemoPositions({
      ownerUid: OWNER,
      brokerPositions: [
        {
          positionId: "pos-1",
          label: "GH-D-int-rec",
          comment: "GOLD_HUNTER",
          side: "BUY",
          entryPrice: 2601.5,
          stopLoss: 2601.5 - HARD,
          volumeLots: 0.09
        }
      ]
    });
    expect(r.entryRepaired).toBeGreaterThanOrEqual(1);
    const st = sel.getLossControllerEntryState();
    expect(st.entryIntegrityHealthy).toBe(true);
    expect(st.entryIntegrityRecoveredAtMs).not.toBeNull();
    expect([
      "BROKER_POSITION_ENTRY_REPAIRED",
      "RECONCILE_CYCLE_ALL_OPEN_ENTRIES_VALID"
    ]).toContain(st.lastEntryIntegrityRecoveryReason);
  });
});

describe("Integration: PENDING_RECONCILIATION → repair → Smart Loss / PM → true R", () => {
  beforeEach(() => {
    resetGoldHunterStrategySelectorsForTests();
    resetGoldHunterPositionManagerForTests();
    setGoldHunterPositionManagerHooksForTests({});
    resetGoldHunterCloseSettlementHooksForTests();
    resetGoldHunterTradeMemory();
  });

  it("full recover path registers PM and soft-max can fire; settlement R notifies once", async () => {
    const trade = baseTrade({
      goldHunterTradeId: "GH-D-int-1",
      brokerPositionId: "pos-int-1",
      stop: 2600 - HARD
    });
    await upsertGoldHunterDemoTrade(OWNER, trade);

    const r = await reconcileGoldHunterDemoPositions({
      ownerUid: OWNER,
      brokerPositions: [
        {
          positionId: "pos-int-1",
          label: "GH-D-int-1",
          comment: "GOLD_HUNTER",
          side: "BUY",
          entryPrice: 2600,
          stopLoss: 2600 - HARD,
          volumeLots: 0.09
        }
      ]
    });
    const repaired = r.restored.find((t) => t.goldHunterTradeId === "GH-D-int-1")!;
    expect(repaired.entry).toBe(2600);
    expect(repaired.status).toBe("FILLED");

    registerGoldHunterOpenPositionForOwner({
      ownerUid: OWNER,
      trade: repaired,
      bid: 2600,
      ask: 2600.05
    });

    // Smart Loss soft max after registration via pure evaluate path
    const cfg = defaultGhFastConfig({
      smartPositionManagerEnabled: true,
      smartLossControllerEnabled: true
    });
    const open = openTrade({
      tradeId: repaired.goldHunterTradeId,
      side: "BUY",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: Date.now(),
      bid: 2599.95,
      ask: 2600,
      trailDistance: cfg.trailDistance
    });
    open.initialRiskPrice = HARD;
    const softBid = 2600 - HARD * 0.72;
    updateOpenTrade(open, softBid, softBid + 0.05, cfg);
    expect(
      evaluateOpenExit({
        trade: open,
        f: feat(softBid, softBid + 0.05),
        cfg,
        dataOk: true
      })
    ).toBe("SMART_SOFT_MAX_LOSS");

    // +1R handoff / PM protect still works
    const winner = openTrade({
      tradeId: "win-1",
      side: "BUY",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: Date.now(),
      bid: 2599.95,
      ask: 2600,
      trailDistance: cfg.trailDistance
    });
    updateOpenTrade(winner, 2600 + HARD * 1.05, 2600 + HARD * 1.05 + 0.05, cfg);
    expect(winner.smartPmState).toBe("PROTECTED");
    expect(SMART_LOSS_PERSIST_SNAPSHOTS).toBe(2);

    const settled = applyBrokerSettledClose({
      trade: {
        ...repaired,
        status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT",
        exitReason: "SMART_SOFT_MAX_LOSS"
      },
      deal: {
        dealId: "d-int",
        orderId: "o-int",
        positionId: "pos-int-1",
        netPnl: -3.5,
        grossPnl: -3.2,
        commission: -0.3,
        swap: 0,
        closePrice: 2600 - HARD * 0.7,
        entryPrice: 2600,
        closedAt: "2026-08-19T15:20:00.000Z",
        closedVolumeLots: 0.09
      }
    });
    expect(realisedRFromSettledDemoTrade(settled)).toBeCloseTo(-0.7, 6);

    getGoldHunterStrategySelector(OWNER);
    notifySelectorOfSettledGoldHunterClose({ ownerUid: OWNER, trade: settled });
    notifySelectorOfSettledGoldHunterClose({ ownerUid: OWNER, trade: settled });
    const st = getGoldHunterStrategySelector(OWNER).getLossControllerEntryState();
    expect(st.rollingSampleCount).toBe(1);
    expect(st.rollingRealisedR).toBeCloseTo(-0.7, 6);
  });
});

describe("Safety unchanged", () => {
  it("Demo only / risk / maxOpen unchanged", () => {
    expect(GH_ADMIN_EXECUTION_MODE).toBe("DEMO_ONLY");
    expect(GH_ADMIN_DEFAULT_CONFIG.demoAutoTradeEnabled).toBe(false);
    expect(GH_ADMIN_DEFAULT_CONFIG.maxOpenTrades).toBe(1);
    expect(GH_ADMIN_DEFAULT_CONFIG.riskPerTradePct).toBe(1);
  });
});
