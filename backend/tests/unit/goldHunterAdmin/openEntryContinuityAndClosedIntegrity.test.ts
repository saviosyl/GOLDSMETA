/**
 * GH OPEN entry continuity + terminal CLOSED integrity.
 * Does not retune A/B/C, PM, Loss, risk, or sizing.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { openTrade } from "../../../src/services/goldHunterAdmin/abc/exits";
import { frozenGhFastSoakConfig } from "../../../src/services/goldHunterAdmin/abc";
import {
  applyBrokerSettledClose,
  resetGoldHunterCloseSettlementHooksForTests
} from "../../../src/services/goldHunterAdmin/closeSettlement";
import {
  closeGoldHunterDemoPosition,
  getGoldHunterOpenPositionDiagnostics,
  registerGoldHunterOpenPositionForOwner,
  resetGoldHunterPositionManagerForTests,
  setGoldHunterPositionManagerHooksForTests,
  unregisterGoldHunterManagedPosition
} from "../../../src/services/goldHunterAdmin/demoPositionManager";
import {
  isProvenBrokerOpenEntryIntegrityDefect,
  syncGoldHunterOpenEntryIntegrityHealth
} from "../../../src/services/goldHunterAdmin/entryIntegrity";
import { recoverGoldHunterOpenEntryImmediate } from "../../../src/services/goldHunterAdmin/immediateOpenEntryRecovery";
import {
  ensureGoldHunterKnownPositionEntrySupervisor,
  getGoldHunterSupervisorNewOrderCallCount,
  resetKnownPositionEntrySupervisorForTests,
  setKnownPositionEntrySupervisorHooksForTests
} from "../../../src/services/goldHunterAdmin/knownBrokerPositionEntrySupervisor";
import {
  evaluateGoldHunterFinalLossSafetyGate
} from "../../../src/services/goldHunterAdmin/lossSafetyGate";
import {
  getGoldHunterStrategySelector,
  resetGoldHunterStrategySelectorsForTests
} from "../../../src/services/goldHunterAdmin/strategySelector";
import {
  getGoldHunterDemoTrade,
  listGoldHunterDemoTrades,
  resetGoldHunterTradeMemory,
  upsertGoldHunterDemoTrade
} from "../../../src/services/goldHunterAdmin/tradeStore";
import {
  GH_ADMIN_DEFAULT_CONFIG,
  GH_ADMIN_EXECUTION_MODE,
  type GoldHunterDemoTrade
} from "../../../src/services/goldHunterAdmin/types";
import { goldHunterFrozenInitialRiskPrice } from "../../../src/services/goldHunterAdmin/entryRepair";

const OWNER = "owner-open-entry-continuity";
const HARD = goldHunterFrozenInitialRiskPrice();

function pendingTrade(
  over: Partial<GoldHunterDemoTrade> = {}
): GoldHunterDemoTrade {
  return {
    goldHunterTradeId: "GH-D-pending-sup-1",
    strategy: "GOLD_HUNTER",
    environment: "DEMO",
    setup: "A",
    side: "BUY",
    signalTs: "2026-08-20T11:41:30.000Z",
    orderTs: "2026-08-20T11:41:30.000Z",
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
    brokerOrderId: "70609421",
    brokerPositionId: "54726281",
    status: "PENDING_RECONCILIATION",
    signalId: "GH-OPP-sup-1",
    clientOrderId: "gh_client_sup_1",
    dataQuality: "ENTRY_INVALID",
    errorCode: "ENTRY_PRICE_INVALID",
    initialRiskPrice: HARD,
    filledVolumeLots: 9,
    ...over
  };
}

function filledOpen(over: Partial<GoldHunterDemoTrade> = {}): GoldHunterDemoTrade {
  return {
    ...pendingTrade(),
    goldHunterTradeId: "GH-D-open-1",
    status: "FILLED",
    result: "OPEN",
    entry: 2600.1,
    fillTs: "2026-08-20T11:42:40.000Z",
    dataQuality: null,
    errorCode: null,
    brokerPositionId: "54726731",
    ...over
  };
}

describe("GH OPEN entry continuity + CLOSED integrity", () => {
  beforeEach(() => {
    resetGoldHunterTradeMemory();
    resetGoldHunterPositionManagerForTests();
    setGoldHunterPositionManagerHooksForTests({});
    resetGoldHunterCloseSettlementHooksForTests();
    resetGoldHunterStrategySelectorsForTests();
    resetKnownPositionEntrySupervisorForTests();
  });

  it("1. immediate 2500ms fail → supervisor continues → FILLED OPEN + PM", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-sup-later" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    const immediate = await recoverGoldHunterOpenEntryImmediate({
      ownerUid: OWNER,
      trade,
      timeoutMs: 80,
      pollMs: 20,
      listPositions: async () => [
        {
          positionId: "54726281",
          side: "BUY",
          entryPrice: 0,
          volumeLots: 9,
          comment: "GOLD_HUNTER",
          label: "GH-D-sup-later"
        } as never
      ]
    });
    expect(immediate.recovered).toBe(false);
    expect(immediate.reason).toBe("ENTRY_INVALID_WITHIN_WINDOW");

    let n = 0;
    const r = await ensureGoldHunterKnownPositionEntrySupervisor({
      ownerUid: OWNER,
      trade: immediate.trade,
      timeoutMs: 400,
      pollMs: 20,
      listPositions: async () => {
        n += 1;
        return [
          {
            positionId: "54726281",
            side: "BUY",
            entryPrice: n >= 3 ? 4478.35 : 0,
            volumeLots: 9,
            comment: "GOLD_HUNTER",
            label: "GH-D-sup-later"
          } as never
        ];
      }
    });
    expect(r.recovered).toBe(true);
    expect(r.reason).toBe("RECOVERED_OPEN");
    expect(r.trade.status).toBe("FILLED");
    expect(r.trade.result).toBe("OPEN");
    expect(r.trade.entry).toBe(4478.35);
    expect(r.trade.fillTs).toBeTruthy();
    expect(r.trade.initialRiskPrice).toBe(HARD);
    expect(r.trade.entryRecoverySource).toBe("BROKER_POSITION_RECONCILIATION");
    expect(r.pmRegistered).toBe(true);
    expect(r.trade.openEntryPmRegisteredAt).toBeTruthy();
    expect(r.trade.openEntryRecoveryLastReason).toBe("RECOVERED_OPEN");
    expect(
      getGoldHunterOpenPositionDiagnostics(OWNER).some(
        (p) => p.tradeId === "GH-D-sup-later"
      )
    ).toBe(true);
  });

  it("2. invalid open-position entry + historical opening execution → OPEN + PM", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-sup-order" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    setKnownPositionEntrySupervisorHooksForTests({
      findHistoricalOrder: async () => ({
        orderId: "70609421",
        positionId: "54726281",
        clientOrderId: "gh_client_sup_1",
        orderStatus: "ORDER_FILLED",
        orderStatusCode: 2,
        tradeSide: "BUY",
        symbolId: "41",
        label: "GH-D-sup-order",
        comment: "GOLD_HUNTER",
        executionPrice: 4478.35,
        executedVolumeLots: 9,
        createdAt: "2026-08-20T11:41:30.900Z",
        updatedAt: "2026-08-20T11:41:30.960Z",
        closingOrder: false
      }),
      findOpeningDeal: async () => null,
      findClosingDeal: async () => null
    });
    const r = await ensureGoldHunterKnownPositionEntrySupervisor({
      ownerUid: OWNER,
      trade,
      timeoutMs: 300,
      pollMs: 20,
      listPositions: async () => [
        {
          positionId: "54726281",
          side: "BUY",
          entryPrice: 0,
          volumeLots: 9,
          comment: "GOLD_HUNTER",
          label: "GH-D-sup-order"
        } as never
      ]
    });
    expect(r.recovered).toBe(true);
    expect(r.trade.entry).toBe(4478.35);
    expect(r.trade.status).toBe("FILLED");
    expect(r.trade.entryRecoverySource).toBe(
      "BROKER_ORDER_EXECUTION_RECONCILIATION"
    );
    expect(r.pmRegistered).toBe(true);
  });

  it("3. historical price exists but position gone → do not promote OPEN", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-sup-gone" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    setKnownPositionEntrySupervisorHooksForTests({
      findHistoricalOrder: async () => ({
        orderId: "70609421",
        positionId: "54726281",
        clientOrderId: "gh_client_sup_1",
        orderStatus: "ORDER_FILLED",
        orderStatusCode: 2,
        tradeSide: "BUY",
        symbolId: "41",
        label: "GH-D-sup-gone",
        comment: "GOLD_HUNTER",
        executionPrice: 4478.35,
        executedVolumeLots: 9,
        createdAt: "2026-08-20T11:41:30.900Z",
        updatedAt: "2026-08-20T11:41:30.960Z",
        closingOrder: false
      }),
      findOpeningDeal: async () => ({
        dealId: "61009849",
        orderId: "70609421",
        positionId: "54726281",
        executionPrice: 4478.35,
        executedAt: "2026-08-20T11:41:30.960Z",
        filledVolumeLots: 9,
        tradeSide: "BUY",
        isClosing: false,
        close: null,
        label: "GH-D-sup-gone",
        comment: "GOLD_HUNTER",
        symbolId: "41",
        dealStatus: "FILLED"
      }),
      findClosingDeal: async () => ({ dealId: "61009849" })
    });
    const r = await ensureGoldHunterKnownPositionEntrySupervisor({
      ownerUid: OWNER,
      trade,
      timeoutMs: 250,
      pollMs: 20,
      listPositions: async () => []
    });
    expect(r.recovered).toBe(false);
    expect(r.reason).toBe("POSITION_CLOSED_BEFORE_RECOVERY");
    expect(r.trade.status).toBe("PENDING_RECONCILIATION");
    expect(r.trade.entry).toBeNull();
    expect(r.pmRegistered).toBe(false);
    expect(getGoldHunterOpenPositionDiagnostics(OWNER).length).toBe(0);
  });

  it("4. supervisor expires bounded — no invented entry, zero NewOrder", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-sup-expire" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    const r = await ensureGoldHunterKnownPositionEntrySupervisor({
      ownerUid: OWNER,
      trade,
      timeoutMs: 180,
      pollMs: 30,
      listPositions: async () => [
        {
          positionId: "54726281",
          side: "BUY",
          entryPrice: 0,
          volumeLots: 9,
          comment: "GOLD_HUNTER",
          label: "GH-D-sup-expire"
        } as never
      ]
    });
    expect(r.recovered).toBe(false);
    expect(r.reason).toBe("ENTRY_INVALID_WITHIN_WINDOW");
    expect(r.trade.entry).toBeNull();
    expect(r.newOrderCalls).toBe(0);
    expect(getGoldHunterSupervisorNewOrderCallCount()).toBe(0);
  });

  it("5. AutoTrade OFF during recovery — existing position still recovers", async () => {
    expect(GH_ADMIN_DEFAULT_CONFIG.demoAutoTradeEnabled).toBe(false);
    expect(GH_ADMIN_EXECUTION_MODE).toBe("DEMO_ONLY");
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-sup-off" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    const r = await ensureGoldHunterKnownPositionEntrySupervisor({
      ownerUid: OWNER,
      trade,
      timeoutMs: 200,
      pollMs: 20,
      listPositions: async () => [
        {
          positionId: "54726281",
          side: "BUY",
          entryPrice: 4478.35,
          volumeLots: 9,
          comment: "GOLD_HUNTER",
          label: "GH-D-sup-off"
        } as never
      ]
    });
    expect(r.recovered).toBe(true);
    expect(r.trade.status).toBe("FILLED");
    expect(GH_ADMIN_DEFAULT_CONFIG.demoAutoTradeEnabled).toBe(false);
  });

  it("6. PM close held → settlement CLOSED → stale callback cannot regress", async () => {
    const trade = filledOpen();
    await upsertGoldHunterDemoTrade(OWNER, trade);
    const cfg = frozenGhFastSoakConfig();
    const state = openTrade({
      tradeId: trade.goldHunterTradeId,
      side: "BUY",
      setup: "A_MOMENTUM_IGNITION",
      entryTs: Date.now(),
      bid: 2600.1,
      ask: 2600.15,
      trailDistance: cfg.trailDistance
    });
    registerGoldHunterOpenPositionForOwner({
      ownerUid: OWNER,
      trade,
      bid: 2600.1,
      ask: 2600.15
    });

    let release!: (v: { accepted: boolean; errorCode: string | null }) => void;
    const held = new Promise<{ accepted: boolean; errorCode: string | null }>(
      (res) => {
        release = res;
      }
    );
    setGoldHunterPositionManagerHooksForTests({
      closePosition: async () => held
    });

    const closing = closeGoldHunterDemoPosition({
      ownerUid: OWNER,
      trade,
      exitReason: "HARD_PROTECTION",
      bid: 2600,
      ask: 2600.05,
      state
    });

    for (let i = 0; i < 20; i++) {
      const cur = await getGoldHunterDemoTrade(OWNER, trade.goldHunterTradeId);
      if (cur?.status === "CLOSE_REQUESTED") break;
      await new Promise((r) => setTimeout(r, 10));
    }

    const settled = applyBrokerSettledClose({
      trade: {
        ...(await getGoldHunterDemoTrade(OWNER, trade.goldHunterTradeId))!,
        status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT"
      },
      deal: {
        dealId: "61009964",
        orderId: "70609700",
        positionId: "54726731",
        closePrice: 4477.82,
        closedAt: "2026-08-20T11:42:58.176Z",
        grossPnl: 1.31,
        commission: -0.54,
        swap: 0,
        netPnl: 0.77,
        closedVolumeLots: 9,
        entryPrice: 4477.65
      },
      exitReason: "TRAIL_HIT"
    });
    await upsertGoldHunterDemoTrade(OWNER, settled);

    release({ accepted: false, errorCode: "CTRADER_ORDER_TIMEOUT" });
    const outcome = await closing;
    expect(outcome).toBe("SETTLED");

    const final = await getGoldHunterDemoTrade(OWNER, trade.goldHunterTradeId);
    expect(final?.status).toBe("CLOSED");
    expect(final?.result).toBe("WIN");
    expect(final?.netPnlEur).toBe(0.77);
    expect(final?.exit).toBe(4477.82);
    expect(final?.closeTs).toBe("2026-08-20T11:42:58.176Z");
    expect(final?.brokerDealId).toBe("61009964");
    expect(final?.brokerSettlementTs).toBe("2026-08-20T11:42:58.176Z");
    expect(final?.entry).toBe(2600.1);
  });

  it("7. stale MFE/MAE write after CLOSED stays CLOSED", async () => {
    const closed = applyBrokerSettledClose({
      trade: filledOpen({ goldHunterTradeId: "GH-D-stale-mfe" }),
      deal: {
        dealId: "d-closed",
        orderId: "o1",
        positionId: "54726731",
        closePrice: 2600.4,
        closedAt: "2026-08-20T11:42:58.176Z",
        grossPnl: 1.31,
        commission: -0.54,
        swap: 0,
        netPnl: 0.77,
        closedVolumeLots: 9,
        entryPrice: 2600.1
      }
    });
    await upsertGoldHunterDemoTrade(OWNER, closed);
    const stale = await upsertGoldHunterDemoTrade(OWNER, {
      ...closed,
      status: "FILLED",
      result: "OPEN",
      closeTs: null,
      exit: null,
      netPnlEur: null,
      mfe: 9.99,
      mae: -9.99
    });
    expect(stale.rejectedRegression).toBe(true);
    expect(stale.trade.status).toBe("CLOSED");
    expect(stale.trade.result).toBe("WIN");
    expect(stale.trade.netPnlEur).toBe(0.77);
    expect(stale.trade.exit).toBe(2600.4);
    expect(stale.trade.closeTs).toBe("2026-08-20T11:42:58.176Z");
    expect(stale.trade.brokerDealId).toBe("d-closed");
  });

  it("8. unresolved proven-open invalid entry → entryIntegrityHealthy=false", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-unhealthy" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    expect(isProvenBrokerOpenEntryIntegrityDefect(trade)).toBe(true);
    const sel = getGoldHunterStrategySelector(OWNER);
    expect(sel.getLossControllerEntryState().unknownRGuardActive).toBe(false);
    const sync = await syncGoldHunterOpenEntryIntegrityHealth(OWNER);
    expect(sync.healthy).toBe(false);
    expect(sync.defectCount).toBe(1);
    expect(sel.getLossControllerEntryState().entryIntegrityHealthy).toBe(false);
    expect(sel.getLossControllerEntryState().unknownRGuardActive).toBe(false);
    expect(sel.getLossControllerEntryState().unknownRealisedRLossCount).toBe(0);
  });

  it("9. authoritative recovery returns entryIntegrityHealthy=true", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-healthy-again" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    await syncGoldHunterOpenEntryIntegrityHealth(OWNER);
    expect(
      getGoldHunterStrategySelector(OWNER).getLossControllerEntryState()
        .entryIntegrityHealthy
    ).toBe(false);

    const r = await ensureGoldHunterKnownPositionEntrySupervisor({
      ownerUid: OWNER,
      trade,
      timeoutMs: 200,
      pollMs: 20,
      listPositions: async () => [
        {
          positionId: "54726281",
          side: "BUY",
          entryPrice: 4478.35,
          volumeLots: 9,
          comment: "GOLD_HUNTER",
          label: "GH-D-healthy-again"
        } as never
      ]
    });
    expect(r.recovered).toBe(true);
    expect(
      getGoldHunterStrategySelector(OWNER).getLossControllerEntryState()
        .entryIntegrityHealthy
    ).toBe(true);
  });

  it("10. PR #157 third-loss pretransport still blocks", () => {
    const sel = getGoldHunterStrategySelector(OWNER);
    for (let i = 0; i < 3; i++) {
      sel.notifyTradeClosed({
        side: "BUY",
        setup: "A",
        entryPrice: 2600,
        result: "LOSS",
        tradeId: `gh-loss-${i}`,
        realisedR: -0.7,
        closedAtMs: 1_000_000 + i * 1000
      });
    }
    const gate = evaluateGoldHunterFinalLossSafetyGate({
      ownerUid: OWNER,
      side: "BUY",
      atMs: 1_000_000 + 4000,
      mid: 2600,
      signedImbalance1s: 0.2,
      midVel250: 0.001
    });
    expect(gate.ok).toBe(false);
    expect(gate.rejectionReason).toBe("WAIT_LOSS_STREAK_GUARD");
  });

  it("11. hung immediate-read still times out (no invent)", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-hung-keep" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    const timeoutMs = 200;
    const started = Date.now();
    const r = await recoverGoldHunterOpenEntryImmediate({
      ownerUid: OWNER,
      trade,
      timeoutMs,
      pollMs: 50,
      listPositions: () =>
        new Promise(() => {
          /* hung */
        })
    });
    const elapsed = Date.now() - started;
    expect(r.recovered).toBe(false);
    expect(r.reason).toBe("TIMEOUT");
    expect(r.trade.entry).toBeNull();
    expect(elapsed).toBeLessThan(800);
  });

  it("safety defaults unchanged", () => {
    expect(GH_ADMIN_DEFAULT_CONFIG.demoAutoTradeEnabled).toBe(false);
    expect(GH_ADMIN_DEFAULT_CONFIG.maxOpenTrades).toBe(1);
    expect(GH_ADMIN_DEFAULT_CONFIG.riskPerTradePct).toBe(1);
    expect(GH_ADMIN_EXECUTION_MODE).toBe("DEMO_ONLY");
    expect(HARD).toBe(frozenGhFastSoakConfig().hardStop);
  });
});

describe("unregister after CLOSED", () => {
  beforeEach(() => {
    resetGoldHunterTradeMemory();
    resetGoldHunterPositionManagerForTests();
    resetGoldHunterStrategySelectorsForTests();
  });

  it("drops managed state when trade is already CLOSED", async () => {
    const trade = filledOpen({ goldHunterTradeId: "GH-D-unreg" });
    registerGoldHunterOpenPositionForOwner({
      ownerUid: OWNER,
      trade,
      bid: 2600,
      ask: 2600.05
    });
    expect(
      getGoldHunterOpenPositionDiagnostics(OWNER).some(
        (p) => p.tradeId === "GH-D-unreg"
      )
    ).toBe(true);
    unregisterGoldHunterManagedPosition(OWNER, "GH-D-unreg");
    expect(
      getGoldHunterOpenPositionDiagnostics(OWNER).some(
        (p) => p.tradeId === "GH-D-unreg"
      )
    ).toBe(false);
    const rows = await listGoldHunterDemoTrades(OWNER);
    expect(rows.length).toBe(0);
  });
});
