/**
 * Exit-side PENDING_RECONCILIATION ghost trades (CLOSE_VOLUME_UNKNOWN).
 * Broker-closed positions must leave maxOpen via authoritative reconcile only.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyBrokerSettledClose,
  isGoldHunterCloseSettlementPending,
  setGoldHunterCloseSettlementHooksForTests,
  resetGoldHunterCloseSettlementHooksForTests
} from "../../../src/services/goldHunterAdmin/closeSettlement";
import {
  isGoldHunterExitPendingReconciliation,
  reconcileGoldHunterPendingEntries,
  reconcileGoldHunterPendingExitReconciliations,
  runGoldHunterReconcilePass,
  resetGoldHunterReconcileRuntimeForTests,
  setGoldHunterReconcileHooksForTests
} from "../../../src/services/goldHunterAdmin/reconciliationRuntime";
import {
  closeGoldHunterDemoPosition,
  resetGoldHunterPositionManagerForTests,
  setGoldHunterPositionManagerHooksForTests
} from "../../../src/services/goldHunterAdmin/demoPositionManager";
import {
  countsTowardGoldHunterMaxOpen,
  resetGoldHunterTradeMemory,
  upsertGoldHunterDemoTrade,
  listGoldHunterDemoTrades
} from "../../../src/services/goldHunterAdmin/tradeStore";
import { openTrade } from "../../../src/services/goldHunterAdmin/abc/exits";
import { frozenGhFastSoakConfig } from "../../../src/services/goldHunterAdmin/abc";
import { assertGoldHunterDemoOnlyEnvironment } from "../../../src/services/goldHunterAdmin/orderGates";
import {
  GH_ADMIN_STRATEGY_ID,
  type GoldHunterDemoTrade
} from "../../../src/services/goldHunterAdmin/types";

const OWNER = "gh-ghost-exit-owner";

function ghostTradeDoc(
  over: Partial<GoldHunterDemoTrade> = {}
): GoldHunterDemoTrade {
  return {
    goldHunterTradeId: "GH-D-ghost1",
    strategy: GH_ADMIN_STRATEGY_ID,
    environment: "DEMO",
    setup: "A",
    side: "BUY",
    signalTs: "2026-08-17T07:21:03.779Z",
    orderTs: "2026-08-17T07:21:03.779Z",
    fillTs: null,
    closeTs: null,
    entry: 0,
    exit: null,
    stop: 4397.09,
    entrySpread: null,
    durationMs: null,
    mfe: 4405.5,
    mae: 0,
    grossPnlEur: null,
    netPnlEur: null,
    result: null,
    exitReason: "HARVEST_FADE",
    brokerOrderId: "70252031",
    brokerPositionId: "54326887",
    status: "PENDING_RECONCILIATION",
    signalId: "GH-OPP-ghost1",
    clientOrderId: "gh_ghost1",
    filledVolumeLots: 0,
    errorCode: "CLOSE_VOLUME_UNKNOWN",
    ...over
  };
}

beforeEach(() => {
  resetGoldHunterTradeMemory();
  resetGoldHunterReconcileRuntimeForTests();
  resetGoldHunterCloseSettlementHooksForTests();
  resetGoldHunterPositionManagerForTests();
});

describe("Orphan condition (why prior reconcile missed ghosts)", () => {
  it("exit-side PENDING_RECONCILIATION is excluded from pending-entry, disappeared, and close-settlement filters", async () => {
    const ghost = ghostTradeDoc();
    await upsertGoldHunterDemoTrade(OWNER, ghost);

    expect(isGoldHunterExitPendingReconciliation(ghost)).toBe(true);
    expect(isGoldHunterCloseSettlementPending(ghost.status)).toBe(false);
    expect(countsTowardGoldHunterMaxOpen(ghost)).toBe(true);

    // Pending-entry only accepts PENDING_RECONCILIATION without exitReason.
    const entries = await reconcileGoldHunterPendingEntries({
      ownerUid: OWNER,
      positionsReadOk: true,
      brokerPositions: []
    });
    expect(entries.recoveredOpen).toBe(0);
    expect(entries.stillPending).toBe(0);

    const still = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(still.status).toBe("PENDING_RECONCILIATION");
    expect(still.errorCode).toBe("CLOSE_VOLUME_UNKNOWN");
  });
});

describe("Exit-side PENDING_RECONCILIATION reconcile", () => {
  it("A: broker still open → remains pending and maxOpen-counting", async () => {
    await upsertGoldHunterDemoTrade(OWNER, ghostTradeDoc());
    setGoldHunterReconcileHooksForTests({
      listPositions: async () => [
        {
          positionId: "54326887",
          symbolId: "1",
          side: "BUY",
          volumeLots: 0.18,
          volumeUnits: 18,
          entryPrice: 4400,
          stopLoss: 4397,
          takeProfit: null,
          unrealisedPnl: null,
          usedMargin: null,
          openTimestamp: null,
          label: "GH-D-ghost1",
          comment: "GOLD_HUNTER"
        }
      ]
    });

    const pass = await runGoldHunterReconcilePass({
      ownerUid: OWNER,
      force: true
    });
    expect(pass.positionsReadOk).toBe(true);
    expect(pass.exitPendingStillOpen).toBe(1);
    expect(pass.exitPendingSettled).toBe(0);

    const row = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(row.status).toBe("PENDING_RECONCILIATION");
    expect(row.errorCode).toBe("CLOSE_VOLUME_UNKNOWN");
    expect(countsTowardGoldHunterMaxOpen(row)).toBe(true);
    expect(
      (await listGoldHunterDemoTrades(OWNER, { openOnly: true })).length
    ).toBe(1);
  });

  it("B: broker position absent → CLOSE_ACCEPTED_PENDING_SETTLEMENT", async () => {
    await upsertGoldHunterDemoTrade(OWNER, ghostTradeDoc());
    setGoldHunterCloseSettlementHooksForTests({
      fetchClose: async () => null
    });
    setGoldHunterReconcileHooksForTests({
      listPositions: async () => []
    });

    const pass = await runGoldHunterReconcilePass({
      ownerUid: OWNER,
      force: true
    });
    expect(pass.exitPendingSettlementPending).toBe(1);
    expect(pass.exitPendingSettled).toBe(0);

    const row = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(row.status).toBe("CLOSE_ACCEPTED_PENDING_SETTLEMENT");
    expect(row.netPnlEur).toBeNull();
    expect(countsTowardGoldHunterMaxOpen(row)).toBe(false);
  });

  it("C: broker absent + closing deal → CLOSED with authoritative P/L", async () => {
    await upsertGoldHunterDemoTrade(OWNER, ghostTradeDoc());
    setGoldHunterCloseSettlementHooksForTests({
      fetchClose: async () => ({
        dealId: "60800160",
        orderId: "70252032",
        positionId: "54326887",
        closePrice: 4396.81,
        closedAt: "2026-08-17T07:21:31.927Z",
        grossPnl: -9.47,
        commission: -1.08,
        swap: 0,
        netPnl: -10.55,
        closedVolumeLots: 0.18
      })
    });
    setGoldHunterReconcileHooksForTests({
      listPositions: async () => []
    });

    const pass = await runGoldHunterReconcilePass({
      ownerUid: OWNER,
      force: true
    });
    expect(pass.exitPendingSettled).toBe(1);

    const row = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(row.status).toBe("CLOSED");
    expect(row.netPnlEur).toBe(-10.55);
    expect(row.grossPnlEur).toBe(-9.47);
    expect(row.exit).toBe(4396.81);
    expect(row.brokerDealId).toBe("60800160");
    expect(row.exitReason).toBe("HARVEST_FADE");
    expect(row.errorCode).toBeNull();
    expect(countsTowardGoldHunterMaxOpen(row)).toBe(false);
  });

  it("D: deal delayed → pending settlement releases maxOpen; later settles CLOSED", async () => {
    await upsertGoldHunterDemoTrade(OWNER, ghostTradeDoc());
    let dealReady = false;
    setGoldHunterCloseSettlementHooksForTests({
      fetchClose: async () => {
        if (!dealReady) return null;
        return {
          dealId: "deal-late",
          orderId: null,
          positionId: "54326887",
          closePrice: 4396.9,
          closedAt: new Date().toISOString(),
          grossPnl: -5,
          commission: -0.5,
          swap: 0,
          netPnl: -5.5,
          closedVolumeLots: 0.18
        };
      }
    });
    setGoldHunterReconcileHooksForTests({
      listPositions: async () => []
    });

    const first = await reconcileGoldHunterPendingExitReconciliations({
      ownerUid: OWNER,
      positionsReadOk: true,
      brokerPositions: []
    });
    expect(first.settlementPending).toBe(1);
    let row = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(row.status).toBe("CLOSE_ACCEPTED_PENDING_SETTLEMENT");
    expect(row.netPnlEur).toBeNull();
    expect(countsTowardGoldHunterMaxOpen(row)).toBe(false);
    expect(
      (await listGoldHunterDemoTrades(OWNER, { openOnly: true })).length
    ).toBe(0);

    dealReady = true;
    resetGoldHunterReconcileRuntimeForTests();
    setGoldHunterReconcileHooksForTests({
      listPositions: async () => []
    });
    const second = await runGoldHunterReconcilePass({
      ownerUid: OWNER,
      force: true
    });
    expect(second.closesSettled).toBeGreaterThanOrEqual(1);
    row = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(row.status).toBe("CLOSED");
    expect(row.netPnlEur).toBe(-5.5);
  });

  it("E: broker open-position read fails → fail-closed, keep maxOpen block", async () => {
    await upsertGoldHunterDemoTrade(OWNER, ghostTradeDoc());
    setGoldHunterReconcileHooksForTests({
      listPositions: async () => {
        throw new Error("TIMEOUT");
      }
    });

    const pass = await runGoldHunterReconcilePass({
      ownerUid: OWNER,
      force: true
    });
    expect(pass.positionsReadOk).toBe(false);
    expect(pass.exitPendingSettled).toBe(0);
    expect(pass.exitPendingSettlementPending).toBe(0);

    const row = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(row.status).toBe("PENDING_RECONCILIATION");
    expect(row.errorCode).toBe("CLOSE_VOLUME_UNKNOWN");
    expect(countsTowardGoldHunterMaxOpen(row)).toBe(true);
  });

  it("E2: positionsReadOk=false skips even with empty broker list", async () => {
    await upsertGoldHunterDemoTrade(OWNER, ghostTradeDoc());
    const r = await reconcileGoldHunterPendingExitReconciliations({
      ownerUid: OWNER,
      positionsReadOk: false,
      brokerPositions: []
    });
    expect(r.skipped).toBe(true);
    const row = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(row.status).toBe("PENDING_RECONCILIATION");
    expect(countsTowardGoldHunterMaxOpen(row)).toBe(true);
  });

  it("F: CLOSE_VOLUME_UNKNOWN + broker already absent → no second close order; settle from deal", async () => {
    const trade = ghostTradeDoc({ filledVolumeLots: 0 });
    await upsertGoldHunterDemoTrade(OWNER, trade);

    let closeMutations = 0;
    setGoldHunterPositionManagerHooksForTests({
      closePosition: async () => {
        closeMutations += 1;
        return {
          accepted: true,
          executionType: null,
          positionId: "54326887",
          errorCode: null
        };
      }
    });

    // Re-confirm close path refuses mutation when volume unknown.
    const cfg = frozenGhFastSoakConfig();
    const state = openTrade({
      tradeId: trade.goldHunterTradeId,
      side: "BUY",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: Date.now(),
      bid: 4400,
      ask: 4400.1,
      trailDistance: cfg.trailDistance
    });
    await closeGoldHunterDemoPosition({
      ownerUid: OWNER,
      trade,
      exitReason: "HARVEST_FADE",
      bid: 4400,
      ask: 4400.1,
      state
    });
    expect(closeMutations).toBe(0);

    setGoldHunterCloseSettlementHooksForTests({
      fetchClose: async () => ({
        dealId: "60800160",
        orderId: "70252032",
        positionId: "54326887",
        closePrice: 4396.81,
        closedAt: "2026-08-17T07:21:31.927Z",
        grossPnl: -9.47,
        commission: -1.08,
        swap: 0,
        netPnl: -10.55,
        closedVolumeLots: 0.18
      })
    });
    setGoldHunterReconcileHooksForTests({
      listPositions: async () => [],
      settleClose: async ({ trade: t }) => {
        // Exit reconcile must settle without close mutation.
        expect(closeMutations).toBe(0);
        const settled = applyBrokerSettledClose({
          trade: t,
          deal: {
            dealId: "60800160",
            orderId: "70252032",
            positionId: "54326887",
            closePrice: 4396.81,
            closedAt: "2026-08-17T07:21:31.927Z",
            grossPnl: -9.47,
            commission: -1.08,
            swap: 0,
            netPnl: -10.55,
            closedVolumeLots: 0.18
          }
        });
        await upsertGoldHunterDemoTrade(OWNER, settled);
        return { settled: true, trade: settled };
      }
    });

    const pass = await runGoldHunterReconcilePass({
      ownerUid: OWNER,
      force: true
    });
    expect(pass.exitPendingSettled).toBe(1);
    expect(closeMutations).toBe(0);
    const row = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(row.status).toBe("CLOSED");
    expect(row.netPnlEur).toBe(-10.55);
  });

  it("G: never invents P/L when deal missing", async () => {
    await upsertGoldHunterDemoTrade(OWNER, ghostTradeDoc());
    setGoldHunterCloseSettlementHooksForTests({
      fetchClose: async () => null
    });
    setGoldHunterReconcileHooksForTests({
      listPositions: async () => []
    });

    await runGoldHunterReconcilePass({ ownerUid: OWNER, force: true });
    const row = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(row.status).toBe("CLOSE_ACCEPTED_PENDING_SETTLEMENT");
    expect(row.netPnlEur).toBeNull();
    expect(row.grossPnlEur).toBeNull();
    expect(row.result).toBeNull();
  });

  it("H: no duplicate order / no broker close mutation on exit reconcile", async () => {
    await upsertGoldHunterDemoTrade(OWNER, ghostTradeDoc());
    let closeMutations = 0;
    setGoldHunterPositionManagerHooksForTests({
      closePosition: async () => {
        closeMutations += 1;
        return {
          accepted: true,
          executionType: null,
          positionId: "54326887",
          errorCode: null
        };
      }
    });
    setGoldHunterCloseSettlementHooksForTests({
      fetchClose: async () => null
    });
    setGoldHunterReconcileHooksForTests({
      listPositions: async () => []
    });

    await runGoldHunterReconcilePass({ ownerUid: OWNER, force: true });
    expect(closeMutations).toBe(0);
    const trades = await listGoldHunterDemoTrades(OWNER, { limit: 20 });
    expect(trades).toHaveLength(1);
    expect(trades[0]!.brokerOrderId).toBe("70252031");
  });

  it("I: FAST isolation unchanged — unmatched Fast positions untouched", async () => {
    await upsertGoldHunterDemoTrade(OWNER, ghostTradeDoc());
    setGoldHunterCloseSettlementHooksForTests({
      fetchClose: async () => ({
        dealId: "d1",
        orderId: null,
        positionId: "54326887",
        closePrice: 4396.8,
        closedAt: new Date().toISOString(),
        grossPnl: -1,
        commission: 0,
        swap: 0,
        netPnl: -1,
        closedVolumeLots: 0.18
      })
    });
    setGoldHunterReconcileHooksForTests({
      listPositions: async () => [
        {
          positionId: "fast-99",
          symbolId: "42",
          side: "BUY",
          volumeLots: 0.1,
          volumeUnits: 10,
          entryPrice: 2600,
          stopLoss: 2599,
          takeProfit: null,
          unrealisedPnl: null,
          usedMargin: null,
          openTimestamp: null,
          label: "FAT-99",
          comment: "FAST_AUTOTRADE_V1"
        }
      ]
    });

    const pass = await runGoldHunterReconcilePass({
      ownerUid: OWNER,
      force: true
    });
    expect(pass.exitPendingSettled).toBe(1);
    expect(pass.unmatched).toBe(1);
    const trades = await listGoldHunterDemoTrades(OWNER, { limit: 20 });
    expect(trades.every((t) => t.strategy === GH_ADMIN_STRATEGY_ID)).toBe(true);
  });

  it("J: Live execution remains impossible", () => {
    expect(() => assertGoldHunterDemoOnlyEnvironment("LIVE")).toThrow(
      /DEMO|LIVE/i
    );
    const text = readFileSync(
      resolve(process.cwd(), "src/services/goldHunterAdmin/reconciliationRuntime.ts"),
      "utf8"
    );
    expect(text).toContain('t.environment !== "DEMO"');
    expect(text).toContain("reconcileGoldHunterPendingExitReconciliations");
  });
});
