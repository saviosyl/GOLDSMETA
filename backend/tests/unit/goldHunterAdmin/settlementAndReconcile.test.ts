/**
 * Gold Hunter broker settlement + reconciliation hardening tests.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  applyBrokerSettledClose,
  settleGoldHunterCloseFromBroker,
  setGoldHunterCloseSettlementHooksForTests,
  resetGoldHunterCloseSettlementHooksForTests
} from "../../../src/services/goldHunterAdmin/closeSettlement";
import {
  closeGoldHunterDemoPosition,
  resetGoldHunterPositionManagerForTests,
  setGoldHunterPositionManagerHooksForTests,
  tickGoldHunterPositionManager,
  getGoldHunterMfeMaePersistWriteCount,
  restoreGoldHunterPositionManager,
  registerGoldHunterOpenPositionForOwner
} from "../../../src/services/goldHunterAdmin/demoPositionManager";
import {
  runGoldHunterReconcilePass,
  reconcileGoldHunterPendingEntries,
  resetGoldHunterReconcileRuntimeForTests,
  setGoldHunterReconcileHooksForTests
} from "../../../src/services/goldHunterAdmin/reconciliationRuntime";
import {
  resetGoldHunterTradeMemory,
  upsertGoldHunterDemoTrade,
  listGoldHunterDemoTrades,
  computeDemoPerformance,
  todayNetPnlEur
} from "../../../src/services/goldHunterAdmin/tradeStore";
import { evaluateGoldHunterOrderGates } from "../../../src/services/goldHunterAdmin/orderGates";
import { plannedDailyLossBudgetEur } from "../../../src/services/goldHunterAdmin/riskSizing";
import {
  getGoldHunterStrategySelector,
  resetGoldHunterStrategySelectorsForTests
} from "../../../src/services/goldHunterAdmin/strategySelector";
import {
  acquireGoldHunterSignalClaim,
  resetGoldHunterSignalClaimsForTests
} from "../../../src/services/goldHunterAdmin/signalClaimStore";
import { openTrade } from "../../../src/services/goldHunterAdmin/abc/exits";
import { frozenGhFastSoakConfig } from "../../../src/services/goldHunterAdmin/abc";
import {
  GH_ADMIN_DEFAULT_CONFIG,
  GH_ADMIN_STRATEGY_ID,
  type GoldHunterDemoTrade
} from "../../../src/services/goldHunterAdmin/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const OWNER = "gh-settle-owner";

function baseTrade(
  over: Partial<GoldHunterDemoTrade> = {}
): GoldHunterDemoTrade {
  return {
    goldHunterTradeId: "GH-D-settle1",
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
    mfe: 0.1,
    mae: -0.05,
    grossPnlEur: null,
    netPnlEur: null,
    result: "OPEN",
    exitReason: null,
    brokerOrderId: "o1",
    brokerPositionId: "p1",
    status: "FILLED",
    signalId: "GH-OPP-AB-e1",
    clientOrderId: "gh_opp1",
    filledVolumeLots: 0.1,
    ...over
  };
}

beforeEach(() => {
  resetGoldHunterTradeMemory();
  resetGoldHunterPositionManagerForTests();
  resetGoldHunterCloseSettlementHooksForTests();
  resetGoldHunterReconcileRuntimeForTests();
  resetGoldHunterStrategySelectorsForTests();
  resetGoldHunterSignalClaimsForTests();
});

describe("Authoritative close settlement", () => {
  it("broker close accepted + confirmed deal → CLOSED with real net P/L", async () => {
    const trade = baseTrade();
    await upsertGoldHunterDemoTrade(OWNER, trade);
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

    setGoldHunterPositionManagerHooksForTests({
      closePosition: async () => ({
        accepted: true,
        executionType: "ORDER_FILLED",
        positionId: "p1",
        errorCode: null
      }),
      settleClose: async ({ trade: t }) => {
        const settled = applyBrokerSettledClose({
          trade: t,
          deal: {
            dealId: "d1",
            orderId: "o-close",
            positionId: "p1",
            closePrice: 2600.4,
            closedAt: new Date().toISOString(),
            grossPnl: -12.5,
            commission: -0.4,
            swap: -0.1,
            netPnl: -13.0,
            closedVolumeLots: 0.1
          }
        });
        await upsertGoldHunterDemoTrade(OWNER, settled);
        return { settled: true, trade: settled };
      }
    });

    const outcome = await closeGoldHunterDemoPosition({
      ownerUid: OWNER,
      trade,
      exitReason: "TRAIL_HIT",
      bid: 2600.35,
      ask: 2600.4,
      state
    });
    expect(outcome).toBe("SETTLED");
    const rows = await listGoldHunterDemoTrades(OWNER, { limit: 10 });
    const closed = rows.find((t) => t.goldHunterTradeId === trade.goldHunterTradeId)!;
    expect(closed.status).toBe("CLOSED");
    expect(closed.netPnlEur).toBe(-13.0);
    expect(closed.grossPnlEur).toBe(-12.5);
    expect(closed.commissionEur).toBe(-0.4);
    expect(closed.swapEur).toBe(-0.1);
    expect(closed.exit).toBe(2600.4);
    expect(closed.brokerDealId).toBe("d1");
    expect(closed.result).toBe("LOSS");
  });

  it("commission + swap included in net via applyBrokerSettledClose", () => {
    const settled = applyBrokerSettledClose({
      trade: baseTrade({ status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT" }),
      deal: {
        dealId: "d2",
        orderId: null,
        positionId: "p1",
        closePrice: 2601,
        closedAt: new Date().toISOString(),
        grossPnl: 10,
        commission: -0.5,
        swap: -0.25,
        netPnl: 9.25,
        closedVolumeLots: 0.1
      }
    });
    expect(settled.netPnlEur).toBe(9.25);
    expect(settled.commissionEur).toBe(-0.5);
    expect(settled.swapEur).toBe(-0.25);
    expect(settled.status).toBe("CLOSED");
  });

  it("broker close accepted but deal delayed → settlement pending, not fake CLOSED", async () => {
    setGoldHunterCloseSettlementHooksForTests({
      fetchClose: async () => null
    });
    const trade = baseTrade({
      status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT",
      exitReason: "RAPID_ABORT",
      result: null
    });
    const r = await settleGoldHunterCloseFromBroker({
      ownerUid: OWNER,
      trade
    });
    expect(r.settled).toBe(false);
    expect(r.trade.status).toBe("CLOSE_ACCEPTED_PENDING_SETTLEMENT");
    expect(r.trade.netPnlEur).toBeNull();
    expect(r.trade.status).not.toBe("CLOSED");
  });

  it("settlement retry later resolves correctly", async () => {
    let calls = 0;
    setGoldHunterCloseSettlementHooksForTests({
      fetchClose: async () => {
        calls += 1;
        if (calls < 2) return null;
        return {
          dealId: "d-late",
          orderId: null,
          positionId: "p1",
          closePrice: 2599.8,
          closedAt: new Date().toISOString(),
          grossPnl: -5,
          commission: -0.2,
          swap: 0,
          netPnl: -5.2,
          closedVolumeLots: 0.1
        };
      }
    });
    const trade = baseTrade({
      status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT",
      exitReason: "HARD_PROTECTION",
      result: null
    });
    const first = await settleGoldHunterCloseFromBroker({
      ownerUid: OWNER,
      trade
    });
    expect(first.settled).toBe(false);
    const second = await settleGoldHunterCloseFromBroker({
      ownerUid: OWNER,
      trade: first.trade
    });
    expect(second.settled).toBe(true);
    expect(second.trade.status).toBe("CLOSED");
    expect(second.trade.netPnlEur).toBe(-5.2);
  });

  it("broker close rejected → PENDING_RECONCILIATION, not CLOSED", async () => {
    const trade = baseTrade();
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
    setGoldHunterPositionManagerHooksForTests({
      closePosition: async () => ({
        accepted: false,
        executionType: null,
        positionId: "p1",
        errorCode: "CLOSE_DENIED"
      })
    });
    const outcome = await closeGoldHunterDemoPosition({
      ownerUid: OWNER,
      trade,
      exitReason: "DATA_STALE",
      bid: 2600,
      ask: 2600.1,
      state
    });
    expect(outcome).toBe(false);
    const row = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(row.status).toBe("PENDING_RECONCILIATION");
    expect(row.netPnlEur).toBeNull();
  });

  it("broker close timeout/unknown → PENDING_RECONCILIATION", async () => {
    const trade = baseTrade();
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
    setGoldHunterPositionManagerHooksForTests({
      closePosition: async () => {
        throw new Error("TIMEOUT");
      }
    });
    const outcome = await closeGoldHunterDemoPosition({
      ownerUid: OWNER,
      trade,
      exitReason: "SPREAD_UNSAFE",
      bid: 2600,
      ask: 2600.2,
      state
    });
    expect(outcome).toBe(false);
    const row = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(row.status).toBe("PENDING_RECONCILIATION");
    expect(row.errorCode).toContain("TIMEOUT");
  });
});

describe("Entry / pending-fill reconciliation", () => {
  it("PENDING entry reconciliation finds existing GH position", async () => {
    await upsertGoldHunterDemoTrade(
      OWNER,
      baseTrade({
        status: "PENDING_RECONCILIATION",
        result: null,
        exitReason: null,
        brokerPositionId: null,
        entry: null
      })
    );
    const r = await reconcileGoldHunterPendingEntries({
      ownerUid: OWNER,
      brokerPositions: [
        {
          positionId: "p-found",
          label: "GH-D-settle1",
          comment: "GOLD_HUNTER",
          side: "BUY",
          entryPrice: 2600.2,
          stopLoss: 2599.65,
          volumeLots: 0.1
        }
      ]
    });
    expect(r.recoveredOpen).toBe(1);
    const row = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(row.status).toBe("FILLED");
    expect(row.brokerPositionId).toBe("p-found");
    expect(row.entry).toBe(2600.2);
  });

  it("same pending signal never resubmitted (claim stays terminal)", async () => {
    await acquireGoldHunterSignalClaim({
      ownerUid: OWNER,
      signalId: "GH-OPP-pending",
      goldHunterTradeId: "GH-D-x",
      clientOrderId: "gh_x",
      setup: "A",
      side: "BUY"
    });
    const again = await acquireGoldHunterSignalClaim({
      ownerUid: OWNER,
      signalId: "GH-OPP-pending",
      goldHunterTradeId: "GH-D-y",
      clientOrderId: "gh_y",
      setup: "A",
      side: "BUY"
    });
    expect(again.ok).toBe(false);
  });

  it("ACCEPTED_PENDING_FILL resolves to OPEN/FILLED", async () => {
    await upsertGoldHunterDemoTrade(
      OWNER,
      baseTrade({
        status: "ACCEPTED_PENDING_FILL",
        result: null,
        fillTs: null,
        entry: null,
        brokerPositionId: "p-acc"
      })
    );
    const r = await reconcileGoldHunterPendingEntries({
      ownerUid: OWNER,
      brokerPositions: [
        {
          positionId: "p-acc",
          label: "GH-D-settle1",
          comment: "GOLD_HUNTER",
          side: "BUY",
          entryPrice: 2600.15,
          stopLoss: 2599.6,
          volumeLots: 0.1
        }
      ]
    });
    expect(r.recoveredOpen).toBe(1);
    const row = (await listGoldHunterDemoTrades(OWNER, { limit: 5 }))[0]!;
    expect(row.status).toBe("FILLED");
    expect(row.result).toBe("OPEN");
  });
});

describe("Restart + unmatched isolation", () => {
  it("worker restart restores proven GH position", async () => {
    await upsertGoldHunterDemoTrade(
      OWNER,
      baseTrade({ mfe: 0.22, mae: -0.03, status: "PROTECTED" })
    );
    const mgr = await restoreGoldHunterPositionManager(OWNER);
    expect(mgr.restored).toBe(1);
  });

  it("unmatched / Fast positions untouched in reconcile pass", async () => {
    setGoldHunterReconcileHooksForTests({
      listPositions: async () => [
        {
          positionId: "fast-1",
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
          label: "FAT-1",
          comment: "FAST_AUTOTRADE_V1"
        }
      ]
    });
    const r = await runGoldHunterReconcilePass({
      ownerUid: OWNER,
      force: true
    });
    expect(r.unmatched).toBe(1);
    expect(r.restored).toBe(0);
  });
});

describe("Daily loss + performance from settled broker P/L", () => {
  it("daily loss guard blocks after real settled loss threshold", async () => {
    const config = {
      ...GH_ADMIN_DEFAULT_CONFIG,
      allocatedCapitalEur: 5000,
      dailyLossLimitPct: 3,
      demoAutoTradeEnabled: true,
      updatedAt: new Date().toISOString(),
      updatedBy: OWNER
    };
    const budget = plannedDailyLossBudgetEur(config);
    expect(budget).toBe(150);

    await upsertGoldHunterDemoTrade(
      OWNER,
      baseTrade({
        goldHunterTradeId: "GH-D-loss1",
        status: "CLOSED",
        result: "LOSS",
        netPnlEur: -80,
        closeTs: new Date().toISOString(),
        exit: 2599
      })
    );
    await upsertGoldHunterDemoTrade(
      OWNER,
      baseTrade({
        goldHunterTradeId: "GH-D-loss2",
        status: "CLOSED",
        result: "LOSS",
        netPnlEur: -75,
        closeTs: new Date().toISOString(),
        exit: 2599
      })
    );
    // Unsettled pending must NOT count
    await upsertGoldHunterDemoTrade(
      OWNER,
      baseTrade({
        goldHunterTradeId: "GH-D-pending",
        status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT",
        result: null,
        netPnlEur: null,
        exitReason: "TRAIL_HIT"
      })
    );

    const trades = await listGoldHunterDemoTrades(OWNER, { limit: 50 });
    const todayPnl = todayNetPnlEur(trades);
    expect(todayPnl).toBe(-155);
    const dailyLossOk = todayPnl > -budget;
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
    expect(gates.ok).toBe(false);
    expect(gates.blockers).toContain("WAIT — DAILY LOSS LIMIT");
  });

  it("Performance includes broker-settled trade and excludes unsettled pending", async () => {
    await upsertGoldHunterDemoTrade(
      OWNER,
      baseTrade({
        goldHunterTradeId: "GH-D-win",
        status: "CLOSED",
        result: "WIN",
        netPnlEur: 20,
        closeTs: new Date().toISOString()
      })
    );
    await upsertGoldHunterDemoTrade(
      OWNER,
      baseTrade({
        goldHunterTradeId: "GH-D-unsettle",
        status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT",
        result: null,
        netPnlEur: null,
        exitReason: "HARVEST_FADE"
      })
    );
    const trades = await listGoldHunterDemoTrades(OWNER, { limit: 20 });
    const perf = computeDemoPerformance(trades, "today");
    expect(perf.trades).toBe(1);
    expect(perf.netPnl).toBe(20);
  });
});

describe("MFE/MAE persistence bounds", () => {
  it("MFE/MAE persistence bounded under high-rate market events", async () => {
    const sel = getGoldHunterStrategySelector(OWNER);
    sel.processInjectedSelectionForTests({
      selected: {
        setup: "A_MOMENTUM_IGNITION",
        side: "BUY",
        quality: 0.8
      },
      receivedAtMs: Date.now()
    });
    const trade = baseTrade();
    await upsertGoldHunterDemoTrade(OWNER, trade);
    registerGoldHunterOpenPositionForOwner({
      ownerUid: OWNER,
      trade,
      bid: 2600,
      ask: 2600.1
    });
    const before = getGoldHunterMfeMaePersistWriteCount(OWNER);
    for (let i = 0; i < 40; i++) {
      sel.processInjectedSelectionForTests({
        selected: {
          setup: "A_MOMENTUM_IGNITION",
          side: "BUY",
          quality: 0.8
        },
        receivedAtMs: Date.now() + i,
        bid: 2600 + i * 0.001,
        ask: 2600.1 + i * 0.001
      });
      await tickGoldHunterPositionManager({ ownerUid: OWNER });
    }
    const writes = getGoldHunterMfeMaePersistWriteCount(OWNER) - before;
    expect(writes).toBeLessThan(40);
    expect(writes).toBeLessThanOrEqual(5);
  });
});

describe("Production call sites + Fast isolation", () => {
  it("quote worker wires reconcile on startup/reconnect", () => {
    const text = readFileSync(
      resolve(
        process.cwd(),
        "src/services/broker/ctrader/persistentQuoteWorker.ts"
      ),
      "utf8"
    );
    expect(text).toContain("runGoldHunterReconcilePass");
    expect(text).toContain("enqueueGoldHunterReconcilePass");
  });

  it("close settlement uses fetchConfirmedCloseForPosition path", () => {
    const text = readFileSync(
      resolve(
        process.cwd(),
        "src/services/goldHunterAdmin/closeSettlement.ts"
      ),
      "utf8"
    );
    expect(text).toContain("fetchConfirmedCloseForPosition");
    expect(text).toContain("CLOSE_ACCEPTED_PENDING_SETTLEMENT");
    expect(text).not.toMatch(/netPnlEur:\s*0/);
  });
});
