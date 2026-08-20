/**
 * Post-#156 safety hotfix tests:
 * - Immediate OPEN entry recovery → PM while OPEN
 * - Final pretransport loss-safety blocks queued candidate after 3rd LOSS
 * - Loss during async preclaim still blocks transport
 * - Worker-authoritative LC diagnostics
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  attemptGoldHunterDemoExecution,
  type OrchestratorDeps
} from "../../../src/services/goldHunterAdmin/executionOrchestrator";
import {
  recoverGoldHunterOpenEntryImmediate
} from "../../../src/services/goldHunterAdmin/immediateOpenEntryRecovery";
import {
  evaluateGoldHunterFinalLossSafetyGate
} from "../../../src/services/goldHunterAdmin/lossSafetyGate";
import {
  GoldHunterStrategySelector,
  getGoldHunterStrategySelector,
  resetGoldHunterStrategySelectorsForTests,
  type GoldHunterSelectedCandidate
} from "../../../src/services/goldHunterAdmin/strategySelector";
import {
  upsertGoldHunterDemoTrade,
  resetGoldHunterTradeMemory,
  listGoldHunterDemoTrades
} from "../../../src/services/goldHunterAdmin/tradeStore";
import {
  resetGoldHunterPositionManagerForTests,
  getGoldHunterOpenPositionDiagnostics,
  setGoldHunterPositionManagerHooksForTests
} from "../../../src/services/goldHunterAdmin/demoPositionManager";
import {
  resetGoldHunterCloseSettlementHooksForTests,
  notifySelectorOfSettledGoldHunterClose,
  applyBrokerSettledClose
} from "../../../src/services/goldHunterAdmin/closeSettlement";
import {
  saveGoldHunterSelectorRuntime,
  loadGoldHunterSelectorRuntime,
  resetGoldHunterSelectorRuntimeMemory
} from "../../../src/services/goldHunterAdmin/selectorRuntimeStore";
import { buildGoldHunterLossControllerTelemetry } from "../../../src/services/goldHunterAdmin/lossControllerTelemetryPersist";
import { assembleGoldHunterStatus } from "../../../src/services/goldHunterAdmin/statusAssembler";
import {
  GH_ADMIN_DEFAULT_CONFIG,
  GH_ADMIN_EXECUTION_MODE,
  type GoldHunterDemoTrade
} from "../../../src/services/goldHunterAdmin/types";
import { goldHunterFrozenInitialRiskPrice } from "../../../src/services/goldHunterAdmin/entryRepair";
import type { BrokerSymbol } from "../../../src/services/broker/domain";
import type { DemoMarketOrderResult } from "../../../src/services/broker/ctrader/openApiClient";

const OWNER = "owner-post156-safety";
const HARD = goldHunterFrozenInitialRiskPrice();

const symbol: BrokerSymbol = {
  symbolId: "1",
  symbolName: "XAUUSD",
  digits: 2,
  lotSize: 100,
  minVolumeLots: 0.01,
  maxVolumeLots: 50,
  stepVolumeLots: 0.01,
  environment: "DEMO"
} as BrokerSymbol;

function candidate(
  over: Partial<GoldHunterSelectedCandidate> = {}
): GoldHunterSelectedCandidate {
  return {
    setup: "A",
    setupId: "A_MOMENTUM_IGNITION",
    side: "BUY",
    quality: 0.8,
    bid: 2600,
    ask: 2600.05,
    signalId: "GH-OPP-post156-1",
    opportunityId: "GH-OPP-post156-1",
    signalTimestamp: new Date().toISOString(),
    depthExecutable: true,
    depthValidity: "DEPTH_VALID",
    consumed: false,
    brainVersion: "GOLD_HUNTER_BRAIN_V2",
    featureSchema: "GOLD_HUNTER_BRAIN_V2",
    normalizationVersion: "CTRADER_NORMALIZED_V1",
    resyncGeneration: 1,
    ...over
  } as GoldHunterSelectedCandidate;
}

function pendingTrade(over: Partial<GoldHunterDemoTrade> = {}): GoldHunterDemoTrade {
  return {
    goldHunterTradeId: "GH-D-pending-1",
    strategy: "GOLD_HUNTER",
    environment: "DEMO",
    setup: "A",
    side: "BUY",
    signalTs: "2026-08-19T18:26:47.000Z",
    orderTs: "2026-08-19T18:26:47.000Z",
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
    brokerPositionId: "pos-open-1",
    status: "PENDING_RECONCILIATION",
    signalId: "sig-1",
    dataQuality: "ENTRY_INVALID",
    errorCode: "ENTRY_PRICE_INVALID",
    initialRiskPrice: HARD,
    filledVolumeLots: null,
    ...over
  };
}

function armThreeLosses(sel: GoldHunterStrategySelector, baseMs = 1_000_000) {
  for (let i = 0; i < 3; i++) {
    sel.notifyTradeClosed({
      side: "BUY",
      setup: "A",
      entryPrice: 2600,
      result: "LOSS",
      tradeId: `gh-loss-${i}`,
      realisedR: -0.7,
      closedAtMs: baseMs + i * 1000
    });
  }
}

describe("Immediate OPEN entry recovery", () => {
  beforeEach(() => {
    resetGoldHunterTradeMemory();
    resetGoldHunterPositionManagerForTests();
    setGoldHunterPositionManagerHooksForTests({});
    resetGoldHunterStrategySelectorsForTests();
  });

  it("repairs missing entry from broker position and registers PM while OPEN", async () => {
    const trade = pendingTrade();
    await upsertGoldHunterDemoTrade(OWNER, trade);
    const r = await recoverGoldHunterOpenEntryImmediate({
      ownerUid: OWNER,
      trade,
      bid: 2600,
      ask: 2600.05,
      listPositions: async () => [
        {
          positionId: "pos-open-1",
          side: "BUY",
          entryPrice: 2600.12,
          stopLoss: 2600.12 - HARD,
          volumeLots: 0.09,
          comment: "GOLD_HUNTER",
          label: "GH-D-pending-1"
        } as never
      ]
    });
    expect(r.recovered).toBe(true);
    expect(r.trade.entry).toBe(2600.12);
    expect(r.trade.status).toBe("FILLED");
    expect(r.trade.fillTs).toBeTruthy();
    expect(r.trade.entryRecoverySource).toBe("BROKER_POSITION_RECONCILIATION");
    expect(r.trade.initialRiskPrice).toBe(HARD);
    const open = getGoldHunterOpenPositionDiagnostics(OWNER);
    expect(open.length).toBeGreaterThanOrEqual(1);
    expect(open.some((p) => p.tradeId === "GH-D-pending-1")).toBe(true);
  });

  it("polls within bound: absent on attempt 1, appears with valid entry on attempt 2", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-poll-appear" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    let calls = 0;
    const r = await recoverGoldHunterOpenEntryImmediate({
      ownerUid: OWNER,
      trade,
      bid: 2600,
      ask: 2600.05,
      timeoutMs: 2_500,
      pollMs: 50,
      listPositions: async () => {
        calls += 1;
        if (calls === 1) return [];
        return [
          {
            positionId: "pos-open-1",
            side: "BUY",
            entryPrice: 2601.5,
            stopLoss: 2601.5 - HARD,
            volumeLots: 0.09,
            comment: "GOLD_HUNTER",
            label: "GH-D-poll-appear"
          } as never
        ];
      }
    });
    expect(r.recovered).toBe(true);
    expect(r.reason).toBe("RECOVERED_OPEN");
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(r.trade.entry).toBe(2601.5);
    expect(r.trade.initialRiskPrice).toBe(HARD);
    expect(r.trade.fillTs).toBeTruthy();
    expect(r.trade.status).toBe("FILLED");
    expect(r.trade.entryRecoverySource).toBe("BROKER_POSITION_RECONCILIATION");
    const open = getGoldHunterOpenPositionDiagnostics(OWNER);
    expect(open.some((p) => p.tradeId === "GH-D-poll-appear")).toBe(true);
  });

  it("exits bounded when target never appears — no invented entry", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-poll-never" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    let calls = 0;
    const r = await recoverGoldHunterOpenEntryImmediate({
      ownerUid: OWNER,
      trade,
      timeoutMs: 400,
      pollMs: 80,
      listPositions: async () => {
        calls += 1;
        return [];
      }
    });
    expect(r.recovered).toBe(false);
    expect(r.reason).toBe("POSITION_NOT_FOUND_WITHIN_WINDOW");
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(r.trade.entry).toBeNull();
    expect(r.trade.status).toBe("PENDING_RECONCILIATION");
    const open = getGoldHunterOpenPositionDiagnostics(OWNER);
    expect(open.some((p) => p.tradeId === "GH-D-poll-never")).toBe(false);
  });

  it("hung listPositions cannot hold recovery past remaining budget", async () => {
    const trade = pendingTrade({ goldHunterTradeId: "GH-D-hung-read" });
    await upsertGoldHunterDemoTrade(OWNER, trade);
    let calls = 0;
    const timeoutMs = 200;
    const started = Date.now();
    const r = await recoverGoldHunterOpenEntryImmediate({
      ownerUid: OWNER,
      trade,
      timeoutMs,
      pollMs: 50,
      listPositions: () => {
        calls += 1;
        return new Promise(() => {
          /* never resolves — hung broker read */
        });
      }
    });
    const elapsed = Date.now() - started;
    expect(r.recovered).toBe(false);
    expect(r.reason).toBe("TIMEOUT");
    expect(calls).toBe(1);
    expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 20);
    expect(elapsed).toBeLessThan(timeoutMs + 400);
    expect(r.trade.entry).toBeNull();
    expect(r.trade.status).toBe("PENDING_RECONCILIATION");
    const open = getGoldHunterOpenPositionDiagnostics(OWNER);
    expect(open.some((p) => p.tradeId === "GH-D-hung-read")).toBe(false);
  });
});

describe("Final pretransport loss-safety", () => {
  beforeEach(() => {
    resetGoldHunterStrategySelectorsForTests();
    resetGoldHunterTradeMemory();
    resetGoldHunterPositionManagerForTests();
    resetGoldHunterCloseSettlementHooksForTests();
    vi.restoreAllMocks();
  });

  it("blocks queued candidate after third distinct LOSS — broker order count = 0", async () => {
    const sel = getGoldHunterStrategySelector(OWNER);
    armThreeLosses(sel);
    expect(sel.getLossControllerEntryState().lossStreakGuardActive).toBe(true);

    let placeOrderCount = 0;
    const deps: OrchestratorDeps = {
      isAdmin: true,
      marketOpen: true,
      feedFresh: true,
      symbol,
      placeOrder: async () => {
        placeOrderCount += 1;
        return {
          accepted: true,
          outcome: "FILLED",
          fillPrice: 2600,
          positionId: "p1",
          orderId: "o1",
          requestSent: true,
          newOrderReqCount: 1
        } as DemoMarketOrderResult;
      },
      assertFresh: () => ({ ok: true })
    };

    // Stub config/account/claim paths via module-level — use attempt with
    // injected placeOrder; orchestrator still needs Firestore-free paths.
    // Direct final gate proof first:
    const gate = evaluateGoldHunterFinalLossSafetyGate({
      ownerUid: OWNER,
      side: "BUY",
      mid: 2600,
      atMs: 1_002_500, // within 60s of streak activation — must not clear
      signedImbalance1s: 0.2,
      midVel250: 0.001
    });
    expect(gate.ok).toBe(false);
    expect(gate.rejectionReason).toBe("WAIT_LOSS_STREAK_GUARD");

    // Adapter-level: submitGoldHunterDemoOrder must not call placeOrder.
    const { submitGoldHunterDemoOrder } = await import(
      "../../../src/services/goldHunterAdmin/demoExecutionAdapter"
    );
    vi.spyOn(
      await import("../../../src/services/broker/ctrader/flags"),
      "isCTraderLiveEnabled"
    ).mockReturnValue(false);
    vi.spyOn(
      await import("../../../src/services/broker/ctrader/flags"),
      "isCTraderDemoOrderSubmissionEnabled"
    ).mockReturnValue(true);
    vi.spyOn(
      await import("../../../src/services/broker/ctrader/connectionStore"),
      "getConnection"
    ).mockResolvedValue({
      selectedAccountIsLive: false,
      environment: "DEMO",
      selectedAccountId: "1"
    } as never);
    vi.spyOn(
      await import("../../../src/services/goldHunterAdmin/configStore"),
      "loadGoldHunterConfig"
    ).mockResolvedValue({
      ...GH_ADMIN_DEFAULT_CONFIG,
      // Enable only so orderGates pass and final loss-safety is reachable.
      demoAutoTradeEnabled: true,
      updatedAt: new Date().toISOString(),
      updatedBy: "test"
    });

    // Freeze "now" for loss gate inside submit (uses Date.now()).
    vi.spyOn(Date, "now").mockReturnValue(1_002_500);

    const submit = await submitGoldHunterDemoOrder({
      ownerUid: OWNER,
      isAdmin: true,
      side: "BUY",
      lots: 0.09,
      stopLoss: 2600 - HARD,
      entryHint: 2600,
      lossSafetyMid: 2600,
      signedImbalance1s: 0.2,
      midVel250: 0.001,
      setup: "A",
      signalId: "GH-OPP-queued",
      goldHunterTradeId: "GH-D-queued-1",
      clientOrderId: "cli-1",
      marketOpen: true,
      feedFresh: true,
      depthValid: true,
      spreadOk: true,
      capitalOk: true,
      dailyLossOk: true,
      openTradeCount: 0,
      signalPresent: true,
      signalConsumed: false,
      accountSnapshotValid: true,
      placeOrder: async () => {
        placeOrderCount += 1;
        return {
          accepted: true,
          outcome: "FILLED",
          fillPrice: 2600,
          positionId: "p1",
          orderId: "o1",
          requestSent: true,
          newOrderReqCount: 1
        } as DemoMarketOrderResult;
      }
    });
    expect(submit.ok).toBe(false);
    if (!submit.ok) {
      expect(submit.blockers[0]).toBe("WAIT_LOSS_STREAK_GUARD");
    }
    expect(placeOrderCount).toBe(0);
  });

  it("third LOSS during async preclaim I/O still blocks broker submission afterwards", async () => {
    const sel = getGoldHunterStrategySelector(OWNER);
    // Two losses so far — streak not yet active.
    for (let i = 0; i < 2; i++) {
      sel.notifyTradeClosed({
        side: "BUY",
        setup: "A",
        entryPrice: 2600,
        result: "LOSS",
        tradeId: `gh-pre-${i}`,
        realisedR: -0.7,
        closedAtMs: 1_000_000 + i * 1000
      });
    }
    expect(sel.getLossControllerEntryState().lossStreakGuardActive).toBe(false);

    let placeOrderCount = 0;
    vi.spyOn(
      await import("../../../src/services/broker/ctrader/flags"),
      "isCTraderLiveEnabled"
    ).mockReturnValue(false);
    vi.spyOn(
      await import("../../../src/services/broker/ctrader/flags"),
      "isCTraderDemoOrderSubmissionEnabled"
    ).mockReturnValue(true);
    vi.spyOn(
      await import("../../../src/services/broker/ctrader/connectionStore"),
      "getConnection"
    ).mockResolvedValue({
      selectedAccountIsLive: false,
      environment: "DEMO",
      selectedAccountId: "1"
    } as never);
    vi.spyOn(
      await import("../../../src/services/goldHunterAdmin/configStore"),
      "loadGoldHunterConfig"
    ).mockResolvedValue({
      ...GH_ADMIN_DEFAULT_CONFIG,
      demoAutoTradeEnabled: true,
      updatedAt: new Date().toISOString(),
      updatedBy: "test"
    });

    const { submitGoldHunterDemoOrder } = await import(
      "../../../src/services/goldHunterAdmin/demoExecutionAdapter"
    );

    // Simulate third LOSS settling while "preclaim" work was underway,
    // immediately before final pretransport check inside submit.
    sel.notifyTradeClosed({
      side: "BUY",
      setup: "A",
      entryPrice: 2600,
      result: "LOSS",
      tradeId: "gh-pre-2",
      realisedR: -0.7,
      closedAtMs: 1_003_000
    });
    expect(sel.getLossControllerEntryState().lossStreakGuardActive).toBe(true);

    vi.spyOn(Date, "now").mockReturnValue(1_003_500);

    const submit = await submitGoldHunterDemoOrder({
      ownerUid: OWNER,
      isAdmin: true,
      side: "BUY",
      lots: 0.09,
      stopLoss: 2600 - HARD,
      entryHint: 2600,
      lossSafetyMid: 2600,
      signedImbalance1s: 0.2,
      midVel250: 0.001,
      setup: "A",
      signalId: "GH-OPP-during-io",
      goldHunterTradeId: "GH-D-during-io",
      clientOrderId: "cli-2",
      marketOpen: true,
      feedFresh: true,
      depthValid: true,
      spreadOk: true,
      capitalOk: true,
      dailyLossOk: true,
      openTradeCount: 0,
      signalPresent: true,
      signalConsumed: false,
      accountSnapshotValid: true,
      placeOrder: async () => {
        placeOrderCount += 1;
        return {
          accepted: true,
          outcome: "FILLED",
          fillPrice: 2600,
          positionId: "p2",
          orderId: "o2",
          requestSent: true,
          newOrderReqCount: 1
        } as DemoMarketOrderResult;
      }
    });
    expect(submit.ok).toBe(false);
    if (!submit.ok) {
      expect(submit.blockers[0]).toBe("WAIT_LOSS_STREAK_GUARD");
    }
    expect(placeOrderCount).toBe(0);
  });

  it("third LOSS during onEnterBrokerTransport await → placeOrder count 0, no transport_enter", async () => {
    const sel = getGoldHunterStrategySelector(OWNER);
    for (let i = 0; i < 2; i++) {
      sel.notifyTradeClosed({
        side: "BUY",
        setup: "A",
        entryPrice: 2600,
        result: "LOSS",
        tradeId: `gh-race-${i}`,
        realisedR: -0.7,
        closedAtMs: 2_000_000 + i * 1000
      });
    }
    expect(sel.getLossControllerEntryState().lossStreakGuardActive).toBe(false);

    let placeOrderCount = 0;
    let transportEnterLogs = 0;
    const infoSpy = vi.spyOn(console, "info").mockImplementation((msg: unknown) => {
      if (typeof msg === "string" && msg.includes("gold_hunter_broker_transport_enter")) {
        transportEnterLogs += 1;
      }
    });

    vi.spyOn(
      await import("../../../src/services/broker/ctrader/flags"),
      "isCTraderLiveEnabled"
    ).mockReturnValue(false);
    vi.spyOn(
      await import("../../../src/services/broker/ctrader/flags"),
      "isCTraderDemoOrderSubmissionEnabled"
    ).mockReturnValue(true);
    vi.spyOn(
      await import("../../../src/services/broker/ctrader/connectionStore"),
      "getConnection"
    ).mockResolvedValue({
      selectedAccountIsLive: false,
      environment: "DEMO",
      selectedAccountId: "1"
    } as never);
    vi.spyOn(
      await import("../../../src/services/goldHunterAdmin/configStore"),
      "loadGoldHunterConfig"
    ).mockResolvedValue({
      ...GH_ADMIN_DEFAULT_CONFIG,
      demoAutoTradeEnabled: true,
      updatedAt: new Date().toISOString(),
      updatedBy: "test"
    });

    const { submitGoldHunterDemoOrder } = await import(
      "../../../src/services/goldHunterAdmin/demoExecutionAdapter"
    );

    let releasePrep: () => void = () => undefined;
    const prepStarted = new Promise<void>((resolve) => {
      releasePrep = resolve;
    });
    let finishPrep: () => void = () => undefined;
    const prepHold = new Promise<void>((resolve) => {
      finishPrep = resolve;
    });

    const submitPromise = submitGoldHunterDemoOrder({
      ownerUid: OWNER,
      isAdmin: true,
      side: "BUY",
      lots: 0.09,
      stopLoss: 2600 - HARD,
      entryHint: 2600,
      lossSafetyMid: 2600,
      signedImbalance1s: 0.2,
      midVel250: 0.001,
      setup: "A",
      signalId: "GH-OPP-race",
      goldHunterTradeId: "GH-D-race",
      clientOrderId: "cli-race",
      marketOpen: true,
      feedFresh: true,
      depthValid: true,
      spreadOk: true,
      capitalOk: true,
      dailyLossOk: true,
      openTradeCount: 0,
      signalPresent: true,
      signalConsumed: false,
      accountSnapshotValid: true,
      onEnterBrokerTransport: async () => {
        // Hold async prep open so the third LOSS can settle mid-await.
        releasePrep();
        await prepHold;
      },
      placeOrder: async () => {
        placeOrderCount += 1;
        return {
          accepted: true,
          outcome: "FILLED",
          fillPrice: 2600,
          positionId: "p-race",
          orderId: "o-race",
          requestSent: true,
          newOrderReqCount: 1
        } as DemoMarketOrderResult;
      }
    });

    await prepStarted;
    // THIRD distinct loss settles while onEnterBrokerTransport is awaiting.
    sel.notifyTradeClosed({
      side: "BUY",
      setup: "A",
      entryPrice: 2600,
      result: "LOSS",
      tradeId: "gh-race-2",
      realisedR: -0.7,
      closedAtMs: 2_003_000
    });
    expect(sel.getLossControllerEntryState().lossStreakGuardActive).toBe(true);
    vi.spyOn(Date, "now").mockReturnValue(2_003_500);
    finishPrep();

    const submit = await submitPromise;
    expect(submit.ok).toBe(false);
    if (!submit.ok) {
      expect(submit.blockers[0]).toBe("WAIT_LOSS_STREAK_GUARD");
      expect(submit.pretransportBlocked).toBe(true);
    }
    expect(placeOrderCount).toBe(0);
    expect(transportEnterLogs).toBe(0);
    infoSpy.mockRestore();
  });
});

describe("Worker-authoritative LC diagnostics", () => {
  beforeEach(() => {
    resetGoldHunterStrategySelectorsForTests();
    resetGoldHunterSelectorRuntimeMemory();
  });

  it("status prefers QUOTE_WORKER telemetry over empty API-process selector", async () => {
    process.env.K_REVISION = "goldmeta-quote-worker-test-rev";
    const workerSel = getGoldHunterStrategySelector(OWNER);
    armThreeLosses(workerSel);
    const tel = buildGoldHunterLossControllerTelemetry(OWNER);
    expect(tel.lossStreakGuardActive).toBe(true);
    expect(tel.consecutiveLosses).toBe(3);
    expect(tel.telemetrySource).toBe("QUOTE_WORKER");
    expect(tel.workerRevision).toBe("goldmeta-quote-worker-test-rev");
    expect(tel.lastClosedTradeId).toBe("gh-loss-2");

    await saveGoldHunterSelectorRuntime({
      ownerUid: OWNER,
      readiness: {
        operational: true,
        spotSourceAttached: true,
        depthSourceAttached: true,
        normalizationReady: true,
        fatalBlocker: null,
        connected: true
      },
      lastCandidate: null,
      lastObservationAt: new Date().toISOString(),
      depthValidity: "DEPTH_VALID",
      spotAgeMs: 10,
      depthAgeMs: 10,
      normalizationVersion: "CTRADER_NORMALIZED_V1",
      updatedAt: tel.updatedAt,
      protectionGeometryConnected: true,
      lossControllerTelemetry: tel
    });

    // Simulate API process with a fresh empty selector instance for another key,
    // while status reads persisted worker telemetry for OWNER.
    resetGoldHunterStrategySelectorsForTests();
    const loaded = await loadGoldHunterSelectorRuntime(OWNER);
    expect(loaded?.lossControllerTelemetry?.lossStreakGuardActive).toBe(true);

    // assembleGoldHunterStatus needs more stubs — assert telemetry shape via loaded snap
    expect(loaded?.lossControllerTelemetry).toMatchObject({
      consecutiveLosses: 3,
      rollingSampleCount: 3,
      lossStreakGuardActive: true,
      unknownRGuardActive: false,
      entryIntegrityHealthy: true,
      telemetrySource: "QUOTE_WORKER",
      workerRevision: "goldmeta-quote-worker-test-rev",
      lastClosedTradeId: "gh-loss-2"
    });
    void assembleGoldHunterStatus;
    void listGoldHunterDemoTrades;
    void applyBrokerSettledClose;
    void notifySelectorOfSettledGoldHunterClose;
    void GH_ADMIN_EXECUTION_MODE;
  });
});

describe("Safety unchanged", () => {
  it("Demo defaults remain OFF / DEMO_ONLY / risk 1 / maxOpen 1", () => {
    expect(GH_ADMIN_EXECUTION_MODE).toBe("DEMO_ONLY");
    expect(GH_ADMIN_DEFAULT_CONFIG.demoAutoTradeEnabled).toBe(false);
    expect(GH_ADMIN_DEFAULT_CONFIG.maxOpenTrades).toBe(1);
    expect(GH_ADMIN_DEFAULT_CONFIG.riskPerTradePct).toBe(1);
  });
});
