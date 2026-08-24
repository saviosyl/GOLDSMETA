/**
 * Brain V6 Revision 03 reliability regressions.
 *
 * Covers the failure modes observed in the first Demo trial:
 * - worker restart/resync must not erase settled-loss protection;
 * - the first post-resync regime is a baseline, not proof of recovery;
 * - price/stop are refreshed after awaited prep and actual fill risk is durable;
 * - BUY and SELL risk geometry use the same authoritative fill semantics.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/services/broker/ctrader/connectionStore", () => ({
  getConnection: vi.fn(async () => ({
    selectedAccountId: "123",
    selectedAccountIsLive: false,
    environment: "DEMO"
  }))
}));

vi.mock("../../../src/services/broker/ctrader/flags", () => ({
  isCTraderLiveEnabled: () => false,
  isCTraderDemoOrderSubmissionEnabled: () => true
}));

import { submitGoldHunterDemoOrder } from "../../../src/services/goldHunterAdmin/demoExecutionAdapter";
import { saveGoldHunterConfig } from "../../../src/services/goldHunterAdmin/configStore";
import { hydrateGoldHunterLossStateFromClosedTrades } from "../../../src/services/goldHunterAdmin/lossStateHydration";
import {
  GOLD_HUNTER_LOSS_TELEMETRY_MAX_AGE_MS,
  resolveFreshLossTelemetryWaitReason
} from "../../../src/services/goldHunterAdmin/statusAssembler";
import {
  getGoldHunterStrategySelector,
  resetGoldHunterStrategySelectorsForTests
} from "../../../src/services/goldHunterAdmin/strategySelector";
import {
  resetGoldHunterTradeMemory,
  upsertGoldHunterDemoTrade
} from "../../../src/services/goldHunterAdmin/tradeStore";
import {
  GH_ADMIN_DEFAULT_CONFIG,
  type GoldHunterDemoTrade
} from "../../../src/services/goldHunterAdmin/types";
import type { DemoMarketOrderResult } from "../../../src/services/broker/ctrader/openApiClient";
import type { SubmitDemoMarketOrderArgs } from "../../../src/services/broker/ctrader/demoOrderExecution";

const OWNER = "gh-v6-r03-reliability";

function closedLoss(args: {
  id: string;
  side: "BUY" | "SELL";
  orderTs: string;
  closeTs: string;
}): GoldHunterDemoTrade {
  const entry = 2600;
  const initialRiskPrice = 0.55;
  const exit = args.side === "BUY" ? 2599.75 : 2600.25;
  const stop = args.side === "BUY" ? 2599.45 : 2600.55;
  return {
    goldHunterTradeId: args.id,
    strategy: "GOLD_HUNTER",
    environment: "DEMO",
    setup: "A",
    side: args.side,
    signalTs: args.orderTs,
    orderTs: args.orderTs,
    fillTs: args.orderTs,
    closeTs: args.closeTs,
    entry,
    exit,
    stop,
    initialRiskPrice,
    entrySpread: 0.05,
    durationMs: 10_000,
    mfe: 0.05,
    mae: 0.25,
    grossPnlEur: -5,
    netPnlEur: -5,
    result: "LOSS",
    exitReason: "SMART_SOFT_MAX_LOSS",
    brokerOrderId: `order-${args.id}`,
    brokerPositionId: `position-${args.id}`,
    status: "CLOSED",
    signalId: `signal-${args.id}`,
    clientOrderId: `client-${args.id}`,
    errorCode: null,
    filledVolumeLots: 0.09,
    takeProfit: null,
    dataQuality: null
  };
}

async function enableDemoAutoTrade(): Promise<void> {
  await saveGoldHunterConfig(OWNER, {
    ...GH_ADMIN_DEFAULT_CONFIG,
    demoAutoTradeEnabled: true,
    mode: "DEMO_AUTO",
    updatedAt: new Date().toISOString(),
    updatedBy: "test"
  });
}

function baseSubmitArgs() {
  return {
    ownerUid: OWNER,
    isAdmin: true,
    lots: 0.09,
    setup: "A" as const,
    marketOpen: true,
    feedFresh: true,
    depthValid: true,
    spreadOk: true,
    capitalOk: true,
    dailyLossOk: true,
    openTradeCount: 0,
    signalPresent: true,
    signalConsumed: false,
    accountSnapshotValid: true
  };
}

describe("Brain V6 R03 restart/resync loss protection", () => {
  beforeEach(() => {
    resetGoldHunterTradeMemory();
    resetGoldHunterStrategySelectorsForTests();
  });

  it("rehydrates two settled losses after process restart and preserves them on resync", async () => {
    await upsertGoldHunterDemoTrade(
      OWNER,
      closedLoss({
        id: "loss-1",
        side: "BUY",
        orderTs: "2026-08-24T08:00:00.000Z",
        closeTs: "2026-08-24T08:00:10.000Z"
      })
    );
    await upsertGoldHunterDemoTrade(
      OWNER,
      closedLoss({
        id: "loss-2",
        side: "BUY",
        orderTs: "2026-08-24T08:01:00.000Z",
        closeTs: "2026-08-24T08:01:10.000Z"
      })
    );

    // Simulate a clean process restart after durable trades already exist.
    resetGoldHunterStrategySelectorsForTests();
    const hydrated = await hydrateGoldHunterLossStateFromClosedTrades(OWNER);
    expect(hydrated).toEqual({
      closedTradesLoaded: 2,
      replayed: 2,
      lastClosedTradeId: "loss-2"
    });

    const selector = getGoldHunterStrategySelector(OWNER);
    const state = selector.getLossControllerEntryState();
    expect(state.consecutiveLosses).toBe(2);
    expect(state.lossStreakGuardActive).toBe(true);
    expect(state.rollingSampleCount).toBe(2);
    expect(state.rollingRealisedR).toBeCloseTo((-0.25 / 0.55) * 2, 8);
    expect(selector.getAntiChurnStateForTests()).toMatchObject({
      lastResult: "LOSS",
      lastSide: "BUY",
      lastEntryPrice: 2600,
      // The authoritative settled exit is already below the BUY entry.
      structuralResetComplete: true
    });

    selector.clearForResync();
    expect(selector.getLossControllerEntryState()).toMatchObject({
      consecutiveLosses: 2,
      lossStreakGuardActive: true,
      lastClosedTradeId: "loss-2"
    });
    expect(selector.getAntiChurnStateForTests().lastResult).toBe("LOSS");
  });

  it("does not latch the loss guard to an obsolete entry after settled hydration", async () => {
    await upsertGoldHunterDemoTrade(
      OWNER,
      closedLoss({
        id: "loss-recovery-a",
        side: "BUY",
        orderTs: "2026-08-24T08:00:00.000Z",
        closeTs: "2026-08-24T08:00:10.000Z"
      })
    );
    await upsertGoldHunterDemoTrade(
      OWNER,
      closedLoss({
        id: "loss-recovery-b",
        side: "BUY",
        orderTs: "2026-08-24T08:01:00.000Z",
        closeTs: "2026-08-24T08:01:10.000Z"
      })
    );

    resetGoldHunterStrategySelectorsForTests();
    await hydrateGoldHunterLossStateFromClosedTrades(OWNER);
    const selector = getGoldHunterStrategySelector(OWNER);
    expect(selector.getAntiChurnStateForTests().structuralResetComplete).toBe(true);

    const recovered = selector.evaluateAntiChurnGateForTests({
      side: "BUY",
      atMs:
        Date.parse("2026-08-24T08:01:10.000Z") +
        120_000 +
        1,
      // Price has continued above the obsolete losing entry; no artificial
      // revisit to 2600 is required because the settled exit proved the cross.
      mid: 2601,
      signedImbalance1s: 0.2,
      midVel250: 0.001
    });
    expect(recovered).toMatchObject({
      ok: true,
      structuralResetOk: true,
      timeFloorOk: true,
      rejectionReason: null
    });
    expect(selector.getLossControllerEntryState().lossStreakGuardActive).toBe(false);
  });

  it("recovers SELL loss hydration without requiring an obsolete entry revisit", async () => {
    await upsertGoldHunterDemoTrade(
      OWNER,
      closedLoss({
        id: "sell-loss-a",
        side: "SELL",
        orderTs: "2026-08-24T08:00:00.000Z",
        closeTs: "2026-08-24T08:00:10.000Z"
      })
    );
    await upsertGoldHunterDemoTrade(
      OWNER,
      closedLoss({
        id: "sell-loss-b",
        side: "SELL",
        orderTs: "2026-08-24T08:01:00.000Z",
        closeTs: "2026-08-24T08:01:10.000Z"
      })
    );

    resetGoldHunterStrategySelectorsForTests();
    await hydrateGoldHunterLossStateFromClosedTrades(OWNER);
    const selector = getGoldHunterStrategySelector(OWNER);
    expect(selector.getAntiChurnStateForTests()).toMatchObject({
      lastSide: "SELL",
      structuralResetComplete: true
    });

    const recovered = selector.evaluateAntiChurnGateForTests({
      side: "SELL",
      atMs:
        Date.parse("2026-08-24T08:01:10.000Z") +
        120_000 +
        1,
      mid: 2599,
      signedImbalance1s: -0.2,
      midVel250: -0.001
    });
    expect(recovered).toMatchObject({
      ok: true,
      structuralResetOk: true,
      timeFloorOk: true,
      rejectionReason: null
    });
  });

  it("keeps missing settled exits fail-closed during hydration", async () => {
    await upsertGoldHunterDemoTrade(OWNER, {
      ...closedLoss({
        id: "missing-exit",
        side: "BUY",
        orderTs: "2026-08-24T08:00:00.000Z",
        closeTs: "2026-08-24T08:00:10.000Z"
      }),
      exit: null
    });

    resetGoldHunterStrategySelectorsForTests();
    await hydrateGoldHunterLossStateFromClosedTrades(OWNER);
    expect(
      getGoldHunterStrategySelector(OWNER).getAntiChurnStateForTests()
        .structuralResetComplete
    ).toBe(false);
  });

  it("keeps contradictory settled exit geometry fail-closed during hydration", async () => {
    await upsertGoldHunterDemoTrade(OWNER, {
      ...closedLoss({
        id: "invalid-exit-geometry",
        side: "BUY",
        orderTs: "2026-08-24T08:00:00.000Z",
        closeTs: "2026-08-24T08:00:10.000Z"
      }),
      // A BUY loss cannot prove recovery with an exit above entry.
      exit: 2600.25
    });

    resetGoldHunterStrategySelectorsForTests();
    await hydrateGoldHunterLossStateFromClosedTrades(OWNER);
    expect(
      getGoldHunterStrategySelector(OWNER).getAntiChurnStateForTests()
        .structuralResetComplete
    ).toBe(false);
  });

  it("requires a second post-resync regime before a new Setup A opportunity", async () => {
    await upsertGoldHunterDemoTrade(
      OWNER,
      closedLoss({
        id: "loss-a",
        side: "BUY",
        orderTs: "2026-08-24T08:00:00.000Z",
        closeTs: "2026-08-24T08:00:10.000Z"
      })
    );
    await upsertGoldHunterDemoTrade(
      OWNER,
      closedLoss({
        id: "loss-b",
        side: "BUY",
        orderTs: "2026-08-24T08:01:00.000Z",
        closeTs: "2026-08-24T08:01:10.000Z"
      })
    );
    await hydrateGoldHunterLossStateFromClosedTrades(OWNER);
    const selector = getGoldHunterStrategySelector(OWNER);
    selector.clearForResync();

    const afterRecoveryFloor = Date.parse("2026-08-24T08:04:00.000Z");
    const baseline = selector.processInjectedSelectionForTests({
      selected: {
        setup: "A_MOMENTUM_IGNITION",
        side: "BUY",
        quality: 0.85
      },
      receivedAtMs: afterRecoveryFloor,
      bookGeneration: 10,
      bid: 2599,
      ask: 2599.05
    });
    expect(baseline.newOpportunity).toBe(false);
    expect(baseline.candidate?.antiChurnState?.rejectionReason).toBe(
      "WAIT_REGIME_RESET_AFTER_LOSSES"
    );

    const freshRegime = selector.processInjectedSelectionForTests({
      selected: {
        setup: "A_MOMENTUM_IGNITION",
        side: "BUY",
        quality: 0.85
      },
      receivedAtMs: afterRecoveryFloor + 1_000,
      bookGeneration: 11,
      bid: 2599.02,
      ask: 2599.07
    });
    expect(freshRegime.newOpportunity).toBe(true);
    expect(freshRegime.opportunity?.setup).toBe("A");
  });
});

describe("Brain V6 R03 status telemetry freshness", () => {
  const nowMs = Date.parse("2026-08-24T14:00:00.000Z");
  const telemetry = {
    updatedAt: new Date(nowMs - 1_000).toISOString(),
    workerRevision: "goldmeta-quote-worker-test",
    consecutiveLosses: 2,
    rollingRealisedR: -1,
    rollingSampleCount: 2,
    lossStreakGuardActive: true,
    lossCircuitBreakerActive: false,
    circuitBreakerReason: null,
    unknownRealisedRLossCount: 0,
    rollingUnknownRTradeCount: 0,
    consecutiveUnknownRLosses: 0,
    unknownRGuardActive: false,
    entryIntegrityHealthy: true,
    entryIntegrityRecoveredAtMs: null,
    lastEntryIntegrityRecoveryReason: null,
    lastClosedTradeId: "loss-2",
    lastUnknownRTradeId: null,
    lastUnknownRReason: null,
    telemetrySource: "QUOTE_WORKER" as const
  };

  it("uses a fresh authoritative worker loss reason", () => {
    expect(resolveFreshLossTelemetryWaitReason(telemetry, nowMs)).toBe(
      "WAIT_LOSS_STREAK_GUARD"
    );
  });

  it("rejects stale, future, invalid-time, and API fallback telemetry", () => {
    expect(
      resolveFreshLossTelemetryWaitReason(
        {
          ...telemetry,
          updatedAt: new Date(
            nowMs - GOLD_HUNTER_LOSS_TELEMETRY_MAX_AGE_MS - 1
          ).toISOString()
        },
        nowMs
      )
    ).toBeNull();
    expect(
      resolveFreshLossTelemetryWaitReason(
        { ...telemetry, updatedAt: new Date(nowMs + 1).toISOString() },
        nowMs
      )
    ).toBeNull();
    expect(
      resolveFreshLossTelemetryWaitReason(
        { ...telemetry, updatedAt: "invalid" },
        nowMs
      )
    ).toBeNull();
    expect(
      resolveFreshLossTelemetryWaitReason(
        { ...telemetry, telemetrySource: "API_PROCESS_FALLBACK" },
        nowMs
      )
    ).toBeNull();
  });

  it("preserves integrity, circuit-breaker, then streak priority", () => {
    expect(
      resolveFreshLossTelemetryWaitReason(
        {
          ...telemetry,
          unknownRGuardActive: true,
          lossCircuitBreakerActive: true
        },
        nowMs
      )
    ).toBe("WAIT_REALISED_R_INCOMPLETE");
    expect(
      resolveFreshLossTelemetryWaitReason(
        { ...telemetry, lossCircuitBreakerActive: true },
        nowMs
      )
    ).toBe("WAIT_LOSS_CIRCUIT_BREAKER");
  });
});

describe("Brain V6 R03 final pretransport pricing", () => {
  beforeEach(async () => {
    resetGoldHunterTradeMemory();
    resetGoldHunterStrategySelectorsForTests();
    await enableDemoAutoTrade();
  });

  it("reprices BUY protection after awaited prep and stores risk from actual fill", async () => {
    const stages: string[] = [];
    let sent: SubmitDemoMarketOrderArgs | null = null;
    const result = await submitGoldHunterDemoOrder({
      ...baseSubmitArgs(),
      side: "BUY",
      entryHint: 2600,
      stopLoss: 2599.45,
      lossSafetyMid: 2600,
      signedImbalance1s: 0.1,
      midVel250: 0.0001,
      signalId: "r03-buy",
      goldHunterTradeId: "GH-D-r03-buy",
      clientOrderId: "r03_buy",
      onEnterBrokerTransport: async () => {
        stages.push("prepared");
      },
      resolveFinalProtection: () => {
        stages.push("repriced");
        return {
          ok: true,
          entryHint: 2601,
          stopLoss: 2600.45,
          lossSafetyMid: 2600.975,
          signedImbalance1s: 0.35,
          midVel250: 0.0004
        };
      },
      placeOrder: async (args) => {
        stages.push("sent");
        sent = args;
        return {
          accepted: true,
          executionType: "FILL",
          orderId: "order-r03-buy",
          positionId: "position-r03-buy",
          errorCode: null,
          clientOrderId: "r03_buy",
          fillPrice: 2601.04,
          stopLoss: 2600.45,
          takeProfit: null,
          filledVolumeLots: 0.09,
          ctidTraderAccountId: "123"
        } satisfies DemoMarketOrderResult;
      }
    });

    expect(stages).toEqual(["prepared", "repriced", "sent"]);
    expect(sent).toMatchObject({ entryHint: 2601, stopLoss: 2600.45 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome).toBe("FILLED");
      expect(result.trade.entry).toBe(2601.04);
      expect(result.trade.stop).toBe(2600.45);
      expect(result.trade.initialRiskPrice).toBeCloseTo(0.59, 8);
    }
  });

  it("uses symmetric actual-fill risk for SELL", async () => {
    const result = await submitGoldHunterDemoOrder({
      ...baseSubmitArgs(),
      side: "SELL",
      entryHint: 2600,
      stopLoss: 2600.55,
      signalId: "r03-sell",
      goldHunterTradeId: "GH-D-r03-sell",
      clientOrderId: "r03_sell",
      resolveFinalProtection: () => ({
        ok: true,
        entryHint: 2599.9,
        stopLoss: 2600.45,
        lossSafetyMid: 2599.925,
        signedImbalance1s: -0.35,
        midVel250: -0.0004
      }),
      placeOrder: async () =>
        ({
          accepted: true,
          executionType: "FILL",
          orderId: "order-r03-sell",
          positionId: "position-r03-sell",
          errorCode: null,
          clientOrderId: "r03_sell",
          fillPrice: 2599.86,
          stopLoss: 2600.45,
          takeProfit: null,
          filledVolumeLots: 0.09,
          ctidTraderAccountId: "123"
        }) satisfies DemoMarketOrderResult
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trade.initialRiskPrice).toBeCloseTo(0.59, 8);
    }
  });

  it("fails closed when the final live candidate cannot be repriced", async () => {
    let placeCalls = 0;
    const result = await submitGoldHunterDemoOrder({
      ...baseSubmitArgs(),
      side: "BUY",
      entryHint: 2600,
      stopLoss: 2599.45,
      signalId: "r03-stale",
      goldHunterTradeId: "GH-D-r03-stale",
      clientOrderId: "r03_stale",
      resolveFinalProtection: () => ({
        ok: false,
        blocker: "WAIT — SIGNAL STALE"
      }),
      placeOrder: async () => {
        placeCalls += 1;
        throw new Error("must not send");
      }
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers).toEqual(["WAIT — SIGNAL STALE"]);
      expect(result.pretransportBlocked).toBe(true);
    }
    expect(placeCalls).toBe(0);
  });
});
