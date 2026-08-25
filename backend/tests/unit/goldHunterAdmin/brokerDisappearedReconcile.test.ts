/**
 * Broker-disappeared open-position reconciliation + close-volume safety.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  applyBrokerSettledClose,
  setGoldHunterCloseSettlementHooksForTests,
  resetGoldHunterCloseSettlementHooksForTests
} from "../../../src/services/goldHunterAdmin/closeSettlement";
import {
  reconcileGoldHunterDisappearedOpenPositions,
  runGoldHunterReconcilePass,
  resetGoldHunterReconcileRuntimeForTests,
  setGoldHunterReconcileHooksForTests
} from "../../../src/services/goldHunterAdmin/reconciliationRuntime";
import {
  resolveGoldHunterCloseVolumeLots,
  closeGoldHunterDemoPosition,
  resetGoldHunterPositionManagerForTests,
  setGoldHunterPositionManagerHooksForTests
} from "../../../src/services/goldHunterAdmin/demoPositionManager";
import {
  resetGoldHunterTradeMemory,
  upsertGoldHunterDemoTrade,
  listGoldHunterDemoTrades,
  todayNetPnlEur
} from "../../../src/services/goldHunterAdmin/tradeStore";
import { evaluateGoldHunterOrderGates } from "../../../src/services/goldHunterAdmin/orderGates";
import { plannedDailyLossBudgetEur } from "../../../src/services/goldHunterAdmin/riskSizing";
import { openTrade } from "../../../src/services/goldHunterAdmin/abc/exits";
import { frozenGhFastSoakConfig } from "../../../src/services/goldHunterAdmin/abc";
import {
  GH_ADMIN_DEFAULT_CONFIG,
  GH_ADMIN_STRATEGY_ID,
  type GoldHunterDemoTrade
} from "../../../src/services/goldHunterAdmin/types";

const OWNER = "gh-disappeared-owner";

function openTradeDoc(
  over: Partial<GoldHunterDemoTrade> = {}
): GoldHunterDemoTrade {
  return {
    goldHunterTradeId: "GH-D-open1",
    strategy: GH_ADMIN_STRATEGY_ID,
    environment: "DEMO",
    setup: "A",
    side: "BUY",
    signalTs: new Date().toISOString(),
    orderTs: new Date().toISOString(),
    fillTs: new Date().toISOString(),
    closeTs: null,
    entry: 2600.1,
    exit: null,
    stop: 2599.55,
    entrySpread: 0.12,
    durationMs: null,
    mfe: 0.05,
    mae: -0.02,
    grossPnlEur: null,
    netPnlEur: null,
    result: "OPEN",
    exitReason: null,
    brokerOrderId: "o1",
    brokerPositionId: "p1",
    status: "FILLED",
    signalId: "GH-OPP-open1",
    clientOrderId: "gh_open1",
    filledVolumeLots: 0.25,
    ...over
  };
}

beforeEach(() => {
  resetGoldHunterTradeMemory();
  resetGoldHunterReconcileRuntimeForTests();
  resetGoldHunterCloseSettlementHooksForTests();
  resetGoldHunterPositionManagerForTests();
});

describe("Broker-disappeared open position reconciliation", () => {
  it("hard-stop: successful open query missing p1 + confirmed deal → CLOSED with netPnl", async () => {
    await upsertGoldHunterDemoTrade(OWNER, openTradeDoc({ stop: 2599.55 }));

    setGoldHunterReconcileHooksForTests({
      listPositions: async () => [], // successful empty snapshot — p1 gone
      settleClose: async ({ trade }) => {
        const settled = applyBrokerSettledClose({
          trade,
          deal: {
            dealId: "deal-sl",
            orderId: "o-sl",
            positionId: "p1",
            closePrice: 2599.55,
            closedAt: new Date().toISOString(),
            grossPnl: -13.5,
            commission: -0.4,
            swap: -0.1,
            netPnl: -14.0,
            closedVolumeLots: 0.25
          },
          exitReason: "BROKER_EXTERNAL_CLOSE"
        });
        await upsertGoldHunterDemoTrade(OWNER, settled);
        return { settled: true, trade: settled };
      }
    });

    const pass = await runGoldHunterReconcilePass({
      ownerUid: OWNER,
      force: true
    });
    expect(pass.positionsReadOk).toBe(true);
    expect(pass.disappearedSettled).toBe(1);

    const row = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(row.status).toBe("CLOSED");
    expect(row.netPnlEur).toBe(-14.0);
    expect(row.exit).toBe(2599.55);
    expect(row.brokerDealId).toBe("deal-sl");
    expect(row.exitReason).toBe("BROKER_EXTERNAL_CLOSE");

    const today = todayNetPnlEur(await listGoldHunterDemoTrades(OWNER, { limit: 20 }));
    expect(today).toBe(-14.0);

    const config = {
      ...GH_ADMIN_DEFAULT_CONFIG,
      allocatedCapitalEur: 5000,
      dailyLossLimitPct: 0.2, // €10 budget — loss exceeds
      demoAutoTradeEnabled: true,
      updatedAt: new Date().toISOString(),
      updatedBy: OWNER
    };
    const budget = plannedDailyLossBudgetEur(config);
    expect(budget).toBe(10);
    const dailyLossOk = today > -budget;
    expect(dailyLossOk).toBe(false);
    const gates = evaluateGoldHunterOrderGates({
      config,
      brokerEnvironment: "DEMO",
      brokerConnected: true,
      accountSnapshotValid: true,
      marketOpen: true,
      feedFresh: true,
      depthValid: true,
      spreadOk: true,
      capitalOk: true,
      dailyLossOk,
      openTradeCount: 0,
      signalPresent: true,
      signalConsumed: false,
      isAdmin: true
    });
    expect(gates.blockers).toContain("WAIT — DAILY LOSS LIMIT");
  });

  it("delayed settlement: position gone, deal missing → pending; later → CLOSED", async () => {
    await upsertGoldHunterDemoTrade(OWNER, openTradeDoc());
    let dealReady = false;

    setGoldHunterCloseSettlementHooksForTests({
      fetchClose: async () => {
        if (!dealReady) return null;
        return {
          dealId: "deal-late",
          orderId: null,
          positionId: "p1",
          closePrice: 2599.8,
          closedAt: new Date().toISOString(),
          grossPnl: -8,
          commission: -0.2,
          swap: 0,
          netPnl: -8.2,
          closedVolumeLots: 0.25
        };
      }
    });

    const first = await reconcileGoldHunterDisappearedOpenPositions({
      ownerUid: OWNER,
      positionsReadOk: true,
      brokerPositions: [] // successful read, p1 absent
    });
    expect(first.settled).toBe(0);
    expect(first.settlementPending).toBe(1);
    let row = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(row.status).toBe("CLOSE_ACCEPTED_PENDING_SETTLEMENT");
    expect(row.netPnlEur).toBeNull();
    expect(row.status).not.toBe("CLOSED");

    dealReady = true;
    setGoldHunterReconcileHooksForTests({
      listPositions: async () => [],
      settleClose: undefined
    });
    // Reset settle to use closeSettlement hooks via default settleGoldHunterCloseFromBroker
    resetGoldHunterReconcileRuntimeForTests();
    setGoldHunterCloseSettlementHooksForTests({
      fetchClose: async () => ({
        dealId: "deal-late",
        orderId: null,
        positionId: "p1",
        closePrice: 2599.8,
        closedAt: new Date().toISOString(),
        grossPnl: -8,
        commission: -0.2,
        swap: 0,
        netPnl: -8.2,
        closedVolumeLots: 0.25
      })
    });

    const second = await runGoldHunterReconcilePass({
      ownerUid: OWNER,
      force: true
    });
    // Already pending settlement — close settlements path resolves it
    expect(second.closesSettled + second.disappearedSettled).toBeGreaterThanOrEqual(1);
    row = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(row.status).toBe("CLOSED");
    expect(row.netPnlEur).toBe(-8.2);
  });

  it("broker query failure → do NOT treat as disappeared / do NOT mutate", async () => {
    await upsertGoldHunterDemoTrade(OWNER, openTradeDoc());
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
    expect(pass.disappearedSettled).toBe(0);
    expect(pass.disappearedPending).toBe(0);
    const row = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(row.status).toBe("FILLED");
    expect(row.result).toBe("OPEN");
    expect(row.netPnlEur).toBeNull();
  });

  it("positionsReadOk=false skips disappeared detection even with empty list arg", async () => {
    await upsertGoldHunterDemoTrade(OWNER, openTradeDoc());
    const r = await reconcileGoldHunterDisappearedOpenPositions({
      ownerUid: OWNER,
      positionsReadOk: false,
      brokerPositions: []
    });
    expect(r.skipped).toBe(true);
    const row = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(row.status).toBe("FILLED");
  });

  it("Fast / unmatched positions untouched when GH open disappears", async () => {
    await upsertGoldHunterDemoTrade(OWNER, openTradeDoc());
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
      ],
      settleClose: async ({ trade }) => {
        const settled = applyBrokerSettledClose({
          trade,
          deal: {
            dealId: "d",
            orderId: null,
            positionId: "p1",
            closePrice: 2599.5,
            closedAt: new Date().toISOString(),
            grossPnl: -1,
            commission: 0,
            swap: 0,
            netPnl: -1,
            closedVolumeLots: 0.25
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
    expect(pass.unmatched).toBe(1);
    expect(pass.disappearedSettled).toBe(1);
    const trades = await listGoldHunterDemoTrades(OWNER, { limit: 20 });
    expect(trades.every((t) => t.strategy === GH_ADMIN_STRATEGY_ID)).toBe(true);
  });
});

describe("Close volume sanity", () => {
  it("refuses unknown volume — never defaults to 0.01", () => {
    expect(
      resolveGoldHunterCloseVolumeLots({ filledVolumeLots: null })
    ).toEqual({ ok: false, reason: "CLOSE_VOLUME_UNKNOWN" });
    expect(
      resolveGoldHunterCloseVolumeLots({ filledVolumeLots: 0 })
    ).toEqual({ ok: false, reason: "CLOSE_VOLUME_UNKNOWN" });
    expect(
      resolveGoldHunterCloseVolumeLots({
        filledVolumeLots: null,
        brokerOpenVolumeLots: 0.25
      })
    ).toEqual({ ok: true, lots: 0.25 });
  });

  it("close path fails closed when volume unknown — no broker mutation", async () => {
    const trade = openTradeDoc({ filledVolumeLots: null });
    let brokerCalls = 0;
    setGoldHunterPositionManagerHooksForTests({
      closePosition: async () => {
        brokerCalls += 1;
        return {
          accepted: true,
          executionType: null,
          positionId: "p1",
          errorCode: null
        };
      }
    });
    const cfg = frozenGhFastSoakConfig();
    const state = openTrade({
      tradeId: trade.goldHunterTradeId,
      side: "BUY",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: Date.now(),
      bid: 2600,
      ask: 2600.1,
      trailDistance: cfg.trailDistance
    });
    const outcome = await closeGoldHunterDemoPosition({
      ownerUid: OWNER,
      trade,
      exitReason: "TRAIL_HIT",
      bid: 2600,
      ask: 2600.1,
      state
    });
    expect(outcome).toBe(false);
    expect(brokerCalls).toBe(0);
    const row = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(row.errorCode).toBe("CLOSE_VOLUME_UNKNOWN");
    expect(row.status).toBe("PENDING_RECONCILIATION");
  });
});
