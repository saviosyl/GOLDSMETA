/**
 * Gold Hunter — post-claim / broker-submit outcome correctness.
 * Root cause (2026-08-17 observation): durable claims burned by local
 * MAX OPEN after SUBMITTING telemetry, with ACCEPTED_PENDING_FILL not
 * counting toward maxOpen; nested NEWORDER send timeout must not be
 * treated as proven non-send.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import type { BrokerSymbol } from "../../../src/services/broker/domain";
import type { GoldHunterDemoTrade } from "../../../src/services/goldHunterAdmin/types";
import { GH_ADMIN_DEFAULT_CONFIG } from "../../../src/services/goldHunterAdmin/types";

vi.mock("../../../src/services/broker/ctrader/connectionStore", () => ({
  getConnection: vi.fn()
}));

vi.mock("../../../src/services/broker/ctrader/flags", () => ({
  isCTraderLiveEnabled: () => false,
  isCTraderDemoOrderSubmissionEnabled: () => true,
  isBrokerExecutionEnabled: () => false
}));

vi.mock("../../../src/services/goldHunterAdmin/accountSnapshot", () => ({
  fetchGoldHunterAccountSnapshot: vi.fn(async () => ({
    authState: "CONNECTED",
    environment: "DEMO",
    validForRisk: true,
    balance: 10000,
    equity: 10000,
    freeMargin: 9000,
    currency: "EUR",
    accountMasked: "***",
    brokerName: "Pepperstone",
    openPositionCount: 0,
    snapshotAgeMs: 0,
    lastSyncAt: new Date().toISOString(),
    source: "TEST"
  })),
  evaluateGoldHunterArmingReadiness: vi.fn()
}));

vi.mock("../../../src/services/marketFeed/sharedMarketData", () => ({
  getSharedXauusdQuote: vi.fn(async () => ({
    marketStatus: "OPEN",
    updatedAt: new Date().toISOString(),
    bid: 2600,
    ask: 2600.12
  }))
}));

import { getConnection } from "../../../src/services/broker/ctrader/connectionStore";
import {
  countsTowardGoldHunterMaxOpen,
  listGoldHunterDemoTrades,
  resetGoldHunterTradeMemory,
  upsertGoldHunterDemoTrade
} from "../../../src/services/goldHunterAdmin/tradeStore";
import { attemptGoldHunterDemoExecution } from "../../../src/services/goldHunterAdmin/executionOrchestrator";
import {
  acquireGoldHunterSignalClaim,
  getGoldHunterSignalClaim,
  resetGoldHunterSignalClaimsForTests
} from "../../../src/services/goldHunterAdmin/signalClaimStore";
import { resetGoldHunterStrategySelectorsForTests } from "../../../src/services/goldHunterAdmin/strategySelector";
import { saveGoldHunterConfig } from "../../../src/services/goldHunterAdmin/configStore";
import { submitGoldHunterDemoOrder } from "../../../src/services/goldHunterAdmin/demoExecutionAdapter";
import { fetchGoldHunterAccountSnapshot } from "../../../src/services/goldHunterAdmin/accountSnapshot";
import {
  isCTraderLiveEnabled,
  isBrokerExecutionEnabled
} from "../../../src/services/broker/ctrader/flags";
import { submitFastMarketOrder } from "../../../src/services/broker/ctrader/demoTransport/orderTransport";
import { BoundedOpTimeoutError } from "../../../src/services/broker/ctrader/demoTransport/boundedOp";

const OWNER = "gh-broker-outcome-owner";

function symbol(): BrokerSymbol {
  return {
    brokerId: "pepperstone_ctrader",
    environment: "DEMO",
    symbolId: "41",
    symbolName: "XAUUSD",
    displayName: "XAUUSD",
    baseAsset: "XAU",
    quoteAsset: "USD",
    digits: 2,
    pipPosition: 1,
    tickSize: 0.01,
    minVolume: 0.01,
    volumeStep: 0.01,
    maxVolume: 50,
    lotSize: 100,
    commissionType: null,
    commissionAmount: null,
    minCommission: null,
    swapLong: null,
    swapShort: null,
    minStopDistance: 0.1,
    rawSlDistance: 10,
    distanceSetIn: "POINTS",
    rawTpDistance: null,
    normalizedMinStopPriceDistance: 0.1,
    guaranteedStopAvailable: null,
    tradingScheduleId: "UTC",
    metadataComplete: true,
    missingFields: []
  };
}

function baseTrade(
  patch: Partial<GoldHunterDemoTrade> & { goldHunterTradeId: string }
): GoldHunterDemoTrade {
  return {
    goldHunterTradeId: patch.goldHunterTradeId,
    strategy: "GOLD_HUNTER",
    environment: "DEMO",
    setup: "A",
    side: "BUY",
    signalTs: new Date().toISOString(),
    orderTs: new Date().toISOString(),
    fillTs: null,
    closeTs: null,
    entry: 2600,
    exit: null,
    stop: 2590,
    entrySpread: 0.12,
    durationMs: null,
    mfe: null,
    mae: null,
    grossPnlEur: null,
    netPnlEur: null,
    result: null,
    exitReason: null,
    brokerOrderId: null,
    brokerPositionId: null,
    status: "ACCEPTED_PENDING_FILL",
    signalId: "sig",
    clientOrderId: "gh_x",
    ...patch
  };
}

function candidate(over: Partial<{ opportunityId: string }> = {}) {
  const opportunityId = over.opportunityId ?? `GH-OPP-AS-e${Date.now()}-test`;
  return {
    strategy: "GOLD_HUNTER" as const,
    opportunityId,
    signalId: opportunityId,
    setup: "A" as const,
    setupId: "A_MOMENTUM_IGNITION" as const,
    side: "SELL" as const,
    bid: 2600,
    ask: 2600.12,
    spread: 0.12,
    quality: 0.8,
    depthExecutable: true,
    depthValidity: "DEPTH_VALID" as const,
    consumed: false,
    signalTimestamp: new Date().toISOString(),
    receiveSeq: 1,
    latestReceiveSeq: 1,
    bookGeneration: 1,
    resyncGeneration: 0,
    normalizationVersion: "GH_FAST_MD_V1",
    featureSchema: "GOLD_HUNTER_FAST_V1",
    mid: 2600.06
  };
}

function orchBase(over: Partial<Parameters<typeof attemptGoldHunterDemoExecution>[2]> = {}) {
  return {
    isAdmin: true,
    marketOpen: true,
    feedFresh: true,
    symbol: symbol(),
    assertFresh: () => ({ ok: true as const }),
    refreshCandidate: ({ candidate }) => candidate,
    ...over
  };
}

beforeEach(async () => {
  resetGoldHunterTradeMemory();
  resetGoldHunterSignalClaimsForTests();
  resetGoldHunterStrategySelectorsForTests();
  await saveGoldHunterConfig(OWNER, {
    ...GH_ADMIN_DEFAULT_CONFIG,
    demoAutoTradeEnabled: true,
    mode: "DEMO_AUTO",
    maxOpenTrades: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: OWNER
  });
  vi.mocked(getConnection).mockResolvedValue({
    selectedAccountId: "48014710",
    selectedAccountIsLive: false,
    environment: "DEMO",
    oauthScope: "trading",
    brokerConfirmedPepperstone: true,
    symbolId: "41",
    symbolName: "XAUUSD",
    symbolDigits: 2
  } as never);
});

describe("Gold Hunter broker-submit outcome forensics", () => {
  it("ACCEPTED_PENDING_FILL counts toward maxOpen", () => {
    const t = baseTrade({ goldHunterTradeId: "GH-D-1" });
    expect(countsTowardGoldHunterMaxOpen(t)).toBe(true);
  });

  it("CLOSE_ACCEPTED_PENDING_SETTLEMENT does not count toward maxOpen", () => {
    const t = baseTrade({
      goldHunterTradeId: "GH-D-2",
      status: "CLOSE_ACCEPTED_PENDING_SETTLEMENT",
      errorCode: "CLOSE_SETTLEMENT_PENDING"
    });
    expect(countsTowardGoldHunterMaxOpen(t)).toBe(false);
  });

  it("max open blocks BEFORE durable claim (retryable, no NewOrder)", async () => {
    await upsertGoldHunterDemoTrade(
      OWNER,
      baseTrade({
        goldHunterTradeId: "GH-D-open",
        status: "ACCEPTED_PENDING_FILL",
        brokerOrderId: "1",
        brokerPositionId: "2"
      })
    );
    const open = await listGoldHunterDemoTrades(OWNER, { openOnly: true });
    expect(open).toHaveLength(1);

    let placeCalls = 0;
    const phases: string[] = [];
    const result = await attemptGoldHunterDemoExecution(OWNER, candidate(), {
      ...orchBase({
        placeOrder: async () => {
          placeCalls += 1;
          throw new Error("should_not_place");
        },
        onTelemetry: (ev) => phases.push(ev.phase)
      })
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers).toContain("WAIT — MAX OPEN TRADES");
    }
    expect(placeCalls).toBe(0);
    expect(phases).not.toContain("CLAIMED");
    expect(phases).not.toContain("SUBMITTING");
    expect(phases).toContain("PRECLAIM_BLOCKED");
  });

  it("SUBMITTING / submit_started only after local gates; fill path works", async () => {
    const phases: string[] = [];
    const timeline: string[] = [];
    let freshnessChecks = 0;
    let liveRefreshes = 0;
    let enteredTransport = false;
    const cand = candidate({ opportunityId: "GH-OPP-AS-e-fill-test" });
    const result = await attemptGoldHunterDemoExecution(OWNER, cand, {
      ...orchBase({
        assertFresh: () => {
          freshnessChecks += 1;
          timeline.push(`fresh_${freshnessChecks}`);
          return { ok: true as const };
        },
        refreshCandidate: ({ candidate: live }) => {
          liveRefreshes += 1;
          timeline.push(`refresh_${liveRefreshes}`);
          return live;
        },
        placeOrder: async (args) => {
          enteredTransport = true;
          timeline.push("place_order");
          expect(args.clientOrderId).toBeTruthy();
          return {
            accepted: true,
            executionType: "ORDER_FILLED",
            orderId: "ord-1",
            positionId: "pos-1",
            errorCode: null,
            clientOrderId: args.clientOrderId ?? "c",
            fillPrice: 2600.1,
            stopLoss: 2590,
            takeProfit: null,
            filledVolumeLots: 0.01,
            ctidTraderAccountId: "48014710",
            outcome: "BROKER_FILLED",
            requestSent: true,
            newOrderReqCount: 1
          };
        },
        onTelemetry: (ev) => {
          phases.push(ev.phase);
          timeline.push(ev.phase);
        }
      })
    });

    expect(enteredTransport).toBe(true);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.outcome).toBe("FILLED");
    const claimIdx = phases.indexOf("CLAIMED");
    const submitIdx = phases.indexOf("SUBMITTING");
    expect(claimIdx).toBeGreaterThanOrEqual(0);
    expect(submitIdx).toBeGreaterThan(claimIdx);
    expect(freshnessChecks).toBe(3);
    expect(liveRefreshes).toBe(3); // pre-claim, final pretransport, post-fill
    expect(timeline.indexOf("fresh_2")).toBeLessThan(timeline.indexOf("CLAIMING"));
    expect(timeline.indexOf("refresh_2")).toBeLessThan(timeline.indexOf("SUBMITTING"));
    expect(timeline.indexOf("SUBMITTING")).toBeLessThan(timeline.indexOf("place_order"));
    const claim = await getGoldHunterSignalClaim(OWNER, cand.opportunityId);
    expect(claim?.state).toBe("OPEN");
    expect(claim?.brokerOrderId).toBe("ord-1");
  });

  it("can create the durable claim atomically as SUBMITTING", async () => {
    const claim = await acquireGoldHunterSignalClaim({
      ownerUid: OWNER,
      signalId: "GH-OPP-atomic-submitting",
      goldHunterTradeId: "GH-D-atomic-submitting",
      clientOrderId: "gh_atomic_submitting",
      setup: "A",
      side: "BUY",
      initialState: "SUBMITTING"
    });
    expect(claim.ok).toBe(true);
    expect(claim.claim.state).toBe("SUBMITTING");
  });

  it("AutoTrade switched OFF during preclaim blocks before claim and transport", async () => {
    let placeCalls = 0;
    const phases: string[] = [];
    vi.mocked(fetchGoldHunterAccountSnapshot).mockImplementationOnce(async () => {
      await saveGoldHunterConfig(OWNER, {
        demoAutoTradeEnabled: false,
        mode: "RESEARCH",
        updatedAt: new Date().toISOString(),
        updatedBy: OWNER
      });
      return {
        environment: "DEMO",
        validForRisk: true,
        freeMargin: 9_000
      } as never;
    });

    const cand = candidate({ opportunityId: "GH-OPP-off-during-preclaim" });
    const result = await attemptGoldHunterDemoExecution(OWNER, cand, {
      ...orchBase({
        placeOrder: async () => {
          placeCalls += 1;
          throw new Error("must_not_transport");
        },
        onTelemetry: (ev) => phases.push(ev.phase)
      })
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers).toEqual(["WAIT — AUTOTRADE OFF"]);
    }
    expect(placeCalls).toBe(0);
    expect(phases).not.toContain("CLAIMING");
    expect(phases).not.toContain("CLAIMED");
    expect(await getGoldHunterSignalClaim(OWNER, cand.opportunityId)).toBeNull();
  });

  it("local gate failure after claim does not enter transport", async () => {
    let placeCalls = 0;
    const r = await submitGoldHunterDemoOrder({
      ownerUid: OWNER,
      isAdmin: true,
      side: "BUY",
      lots: 0.01,
      goldHunterTradeId: "GH-D-gate",
      clientOrderId: "gh_gate",
      signalId: "sig-gate",
      marketOpen: true,
      feedFresh: true,
      depthValid: true,
      spreadOk: true,
      capitalOk: true,
      dailyLossOk: true,
      openTradeCount: 1, // maxOpen=1
      signalPresent: true,
      signalConsumed: false,
      accountSnapshotValid: true,
      onEnterBrokerTransport: async () => {
        throw new Error("should_not_enter_transport");
      },
      placeOrder: async () => {
        placeCalls += 1;
        throw new Error("nope");
      }
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blockers).toContain("WAIT — MAX OPEN TRADES");
    expect(placeCalls).toBe(0);
  });

  it("uncertain NEWORDER_SEND timeout → BROKER_OUTCOME_UNKNOWN (not proven non-send)", async () => {
    const result = await submitFastMarketOrder({
      request: {
        ctidTraderAccountId: "48014710",
        symbolId: "41",
        side: "BUY",
        volume: 1,
        clientOrderId: "gh_uncertain_send"
      },
      transport: {
        sendNewOrder: async () => {
          await new Promise(() => undefined);
          return { confirmedSent: true, response: {} };
        },
        onEvent: () => () => undefined
      },
      sendTimeoutMs: 30,
      sendUncertaintyMs: 40,
      eventWaitMs: 10
    });
    expect(result.outcome).toBe("BROKER_OUTCOME_UNKNOWN");
    expect(result.errorCode).toBe("NEWORDER_SEND_TIMEOUT");
    expect(result.errorCode).not.toBe("NEWORDER_NOT_SENT");
  });

  it("adapter maps uncertain broker outcome to PENDING_RECONCILIATION", async () => {
    const r = await submitGoldHunterDemoOrder({
      ownerUid: OWNER,
      isAdmin: true,
      side: "BUY",
      lots: 0.01,
      goldHunterTradeId: "GH-D-unk",
      clientOrderId: "gh_unk",
      signalId: "sig-unk",
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
      placeOrder: async () => ({
        accepted: false,
        executionType: null,
        orderId: null,
        positionId: null,
        errorCode: "NEWORDER_SEND_TIMEOUT",
        clientOrderId: "gh_unk",
        fillPrice: null,
        stopLoss: null,
        takeProfit: null,
        filledVolumeLots: null,
        ctidTraderAccountId: "48014710",
        outcome: "BROKER_OUTCOME_UNKNOWN",
        requestSent: false,
        newOrderReqCount: 0
      })
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.outcome).toBe("PENDING_RECONCILIATION");
      expect(r.trade?.status).toBe("PENDING_RECONCILIATION");
    }
  });

  it("actual broker rejection stays BROKER_REJECTED", async () => {
    const r = await submitGoldHunterDemoOrder({
      ownerUid: OWNER,
      isAdmin: true,
      side: "BUY",
      lots: 0.01,
      goldHunterTradeId: "GH-D-rej",
      clientOrderId: "gh_rej",
      signalId: "sig-rej",
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
      placeOrder: async () => ({
        accepted: false,
        executionType: "ORDER_REJECTED",
        orderId: "o-rej",
        positionId: null,
        errorCode: "MARKET_CLOSED",
        clientOrderId: "gh_rej",
        fillPrice: null,
        stopLoss: null,
        takeProfit: null,
        filledVolumeLots: null,
        ctidTraderAccountId: "48014710",
        outcome: "BROKER_REJECTED",
        requestSent: true,
        newOrderReqCount: 1
      })
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.outcome).toBe("BROKER_REJECTED");
      expect(r.trade?.status).toBe("BROKER_REJECTED");
      expect(r.trade?.errorCode).toBe("MARKET_CLOSED");
    }
  });

  it("durable claim prevents duplicate NewOrder on second attempt", async () => {
    const cand = candidate({ opportunityId: "GH-OPP-AS-e-dup-test" });
    let places = 0;
    const first = await attemptGoldHunterDemoExecution(OWNER, cand, {
      ...orchBase({
        placeOrder: async () => {
          places += 1;
          return {
            accepted: true,
            executionType: "ORDER_FILLED",
            orderId: "ord-dup",
            positionId: "pos-dup",
            errorCode: null,
            clientOrderId: "c",
            fillPrice: 2600,
            stopLoss: 2590,
            takeProfit: null,
            filledVolumeLots: 0.01,
            ctidTraderAccountId: "48014710",
            outcome: "BROKER_FILLED",
            requestSent: true,
            newOrderReqCount: 1
          };
        }
      })
    });
    expect(first.ok).toBe(true);
    const second = await attemptGoldHunterDemoExecution(OWNER, cand, {
      ...orchBase({
        placeOrder: async () => {
          places += 1;
          throw new Error("dup");
        }
      })
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.blockers[0]).toMatch(/DUPLICATE|MAX OPEN/);
    }
    expect(places).toBe(1);
  });

  it("Live remains impossible", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
    expect(isBrokerExecutionEnabled()).toBe(false);
    expect(isCTraderLiveEnabled({ CTRADER_LIVE_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("BoundedOpTimeoutError identity retained for nested timeout analysis", () => {
    const e = new BoundedOpTimeoutError("NEWORDER_SEND", 8000);
    expect(e.op).toBe("NEWORDER_SEND");
    expect(e.timeoutMs).toBe(8000);
  });
});
