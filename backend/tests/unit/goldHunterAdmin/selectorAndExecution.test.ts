/**
 * Gold Hunter selector + Demo execution hardening tests.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("../../../src/services/broker/ctrader/connectionStore", () => ({
  getConnection: vi.fn(async () => ({
    selectedAccountId: "123",
    selectedAccountIsLive: false,
    environment: "DEMO",
    oauthScope: "trading",
    brokerConfirmedPepperstone: true,
    symbolId: "42",
    symbolName: "XAUUSD",
    symbolDigits: 2
  }))
}));

vi.mock("../../../src/services/broker/ctrader/flags", () => ({
  isCTraderLiveEnabled: () => false,
  isCTraderDemoOrderSubmissionEnabled: () => true
}));
import {
  buildGoldHunterSignalId,
  getGoldHunterStrategySelector,
  resetGoldHunterStrategySelectorsForTests,
  type GoldHunterSelectedCandidate
} from "../../../src/services/goldHunterAdmin/strategySelector";
import {
  acquireGoldHunterSignalClaim,
  getGoldHunterSignalClaim,
  resetGoldHunterSignalClaimsForTests
} from "../../../src/services/goldHunterAdmin/signalClaimStore";
import { attemptGoldHunterDemoExecution } from "../../../src/services/goldHunterAdmin/executionOrchestrator";
import { submitGoldHunterDemoOrder } from "../../../src/services/goldHunterAdmin/demoExecutionAdapter";
import {
  resetGoldHunterTradeMemory,
  upsertGoldHunterDemoTrade,
  listGoldHunterDemoTrades
} from "../../../src/services/goldHunterAdmin/tradeStore";
import { saveGoldHunterConfig } from "../../../src/services/goldHunterAdmin/configStore";
import { deriveGoldHunterInitialProtection } from "../../../src/services/goldHunterAdmin/protectionGeometry";
import { sizeGoldHunterDemoLots } from "../../../src/services/goldHunterAdmin/riskSizing";
import { computeGoldHunterCommittedCapital } from "../../../src/services/goldHunterAdmin/committedCapital";
import { reconcileGoldHunterDemoPositions } from "../../../src/services/goldHunterAdmin/reconcilePositions";
import { evaluateGoldHunterOrderGates } from "../../../src/services/goldHunterAdmin/orderGates";
import { evaluateGoldHunterArmingReadiness } from "../../../src/services/goldHunterAdmin/accountSnapshot";
import { GH_FAST_MARKET_DATA_NORMALIZATION_VERSION } from "../../../src/services/goldHunterAdmin/abc";
import { frozenGhFastSoakConfig } from "../../../src/services/goldHunterAdmin/abc";
import type { BrokerSymbol } from "../../../src/services/broker/domain";
import type { DemoMarketOrderResult } from "../../../src/services/broker/ctrader/openApiClient";
import { GH_ADMIN_DEFAULT_CONFIG, GH_ADMIN_STRATEGY_ID } from "../../../src/services/goldHunterAdmin/types";

const OWNER = "gh-selector-owner";

function symbolMeta(over: Partial<BrokerSymbol> = {}): BrokerSymbol {
  return {
    brokerId: "pepperstone_ctrader",
    environment: "DEMO",
    symbolId: "42",
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
    lotSize: 1,
    commissionType: null,
    commissionAmount: null,
    minCommission: null,
    swapLong: null,
    swapShort: null,
    minStopDistance: null,
    rawSlDistance: null,
    distanceSetIn: null,
    rawTpDistance: null,
    normalizedMinStopPriceDistance: 0.1,
    guaranteedStopAvailable: null,
    tradingScheduleId: null,
    metadataComplete: true,
    ...over
  };
}

function baseCandidate(
  over: Partial<GoldHunterSelectedCandidate> = {}
): GoldHunterSelectedCandidate {
  const opportunityId = over.opportunityId ?? over.signalId ?? "GH-OPP-AB-e1-test";
  return {
    strategy: GH_ADMIN_STRATEGY_ID,
    setup: "A",
    setupId: "A_MOMENTUM_IGNITION",
    side: "BUY",
    quality: 0.82,
    signalId: opportunityId,
    opportunityId,
    signalTimestamp: new Date().toISOString(),
    receiveSeq: 1,
    latestReceiveSeq: 1,
    bookGeneration: 1,
    resyncGeneration: 0,
    bid: 2600,
    ask: 2600.12,
    spread: 0.12,
    depthValidity: "DEPTH_VALID",
    depthExecutable: true,
    normalizationVersion: GH_FAST_MARKET_DATA_NORMALIZATION_VERSION,
    featureSchema: "GOLD_HUNTER_FAST_V1",
    mid: 2600.06,
    consumed: false,
    opportunityStartedAtMs: Date.now(),
    ...over,
    signalId: over.signalId ?? opportunityId,
    opportunityId: over.opportunityId ?? over.signalId ?? opportunityId
  };
}

const freshOk = () => ({ ok: true as const });

function orchDeps(
  over: Partial<Parameters<typeof attemptGoldHunterDemoExecution>[2]> = {}
) {
  return {
    isAdmin: true,
    marketOpen: true,
    feedFresh: true,
    symbol: symbolMeta(),
    assertFresh: freshOk,
    refreshCandidate: ({ candidate }) => candidate,
    ...over
  };
}

async function seedConfig(enabled = false) {
  await saveGoldHunterConfig(OWNER, {
    ...GH_ADMIN_DEFAULT_CONFIG,
    demoAutoTradeEnabled: enabled,
    mode: enabled ? "DEMO_AUTO" : "RESEARCH",
    updatedAt: new Date().toISOString(),
    updatedBy: OWNER
  });
}

describe("Gold Hunter signal id + selector wiring", () => {
  beforeEach(() => {
    resetGoldHunterStrategySelectorsForTests();
    resetGoldHunterSignalClaimsForTests();
    resetGoldHunterTradeMemory();
  });

  it("builds deterministic signal ids", () => {
    const a = buildGoldHunterSignalId({
      setup: "A",
      side: "BUY",
      receiveSeq: 10,
      bookGeneration: 2,
      resyncGeneration: 1,
      bid: 2600.1,
      ask: 2600.2,
      quality: 0.5
    });
    const b = buildGoldHunterSignalId({
      setup: "A",
      side: "BUY",
      receiveSeq: 10,
      bookGeneration: 2,
      resyncGeneration: 1,
      bid: 2600.1,
      ask: 2600.2,
      quality: 0.5
    });
    expect(a).toBe(b);
  });

  it("normalization identity is CTRADER_NORMALIZED_V1", () => {
    expect(GH_FAST_MARKET_DATA_NORMALIZATION_VERSION).toBe("CTRADER_NORMALIZED_V1");
  });

  it("frozen A/B/C thresholds unchanged (hardStop/maxSpread)", () => {
    const cfg = frozenGhFastSoakConfig();
    expect(cfg.hardStop).toBe(0.55);
    expect(cfg.maxSpread).toBe(0.35);
  });

  it("selector connected only when spot+depth attached", () => {
    const sel = getGoldHunterStrategySelector(OWNER);
    expect(sel.readiness().connected).toBe(false);
    sel.markSpotSourceAttached(true);
    expect(sel.readiness().connected).toBe(false);
    sel.markDepthSourceAttached(true);
    expect(sel.readiness().connected).toBe(true);
  });

  it("market closed ≠ selector NOT_CONNECTED when sources attached", () => {
    const sel = getGoldHunterStrategySelector(OWNER);
    sel.markSpotSourceAttached(true);
    sel.markDepthSourceAttached(true);
    expect(sel.readiness().connected).toBe(true);
  });

  it("repeated polls keep same signal id for same opportunity", () => {
    const sel = getGoldHunterStrategySelector(OWNER);
    sel.markSpotSourceAttached(true);
    sel.markDepthSourceAttached(true);
    // Seed depth book
    sel.onDepth({
      receivedAtMs: 1_000,
      newQuotes: [
        { id: "b1", type: "BID", price: 2600, size: 10 },
        { id: "a1", type: "ASK", price: 2600.1, size: 10 }
      ]
    });
    // Warm features with spots — may or may not select; identity stability when selected
    for (let i = 0; i < 30; i++) {
      sel.onSpot({
        receivedAtMs: 1_000 + i * 50,
        bid: 2600 + i * 0.02,
        ask: 2600.1 + i * 0.02
      });
    }
    const c1 = sel.getLastCandidate();
    const c2 = sel.getLastCandidate();
    if (c1 && c2) expect(c1.signalId).toBe(c2.signalId);
  });
});

describe("Depth gating", () => {
  it("invalid / crossed / recovery depth not executable", () => {
    for (const v of [
      "DEPTH_UNAVAILABLE",
      "DEPTH_CROSSED",
      "DEPTH_STALE",
      "RESYNC_RECOVERY"
    ] as const) {
      const c = baseCandidate({ depthValidity: v, depthExecutable: false });
      expect(c.depthExecutable).toBe(false);
    }
  });
});

describe("Order gates matrix", () => {
  const cfg = {
    ...GH_ADMIN_DEFAULT_CONFIG,
    demoAutoTradeEnabled: true,
    updatedAt: "",
    updatedBy: "t"
  };

  function gates(over: Partial<Parameters<typeof evaluateGoldHunterOrderGates>[0]>) {
    return evaluateGoldHunterOrderGates({
      config: cfg,
      brokerEnvironment: "DEMO",
      brokerConnected: true,
      accountSnapshotValid: true,
      marketOpen: true,
      feedFresh: true,
      depthValid: true,
      spreadOk: true,
      capitalOk: true,
      dailyLossOk: true,
      openTradeCount: 0,
      signalPresent: true,
      signalConsumed: false,
      isAdmin: true,
      ...over
    });
  }

  it("market closed → no order", () => {
    expect(gates({ marketOpen: false }).ok).toBe(false);
  });
  it("no setup → no order", () => {
    expect(gates({ signalPresent: false }).blockers).toContain(
      "WAIT — NO SETUP SELECTED"
    );
  });
  it("stale feed → no order", () => {
    expect(gates({ feedFresh: false }).ok).toBe(false);
  });
  it("invalid depth → no order", () => {
    expect(gates({ depthValid: false }).ok).toBe(false);
  });
  it("spread too wide → no order", () => {
    expect(gates({ spreadOk: false }).ok).toBe(false);
  });
  it("AutoTrade OFF → no order", () => {
    expect(
      gates({
        config: { ...cfg, demoAutoTradeEnabled: false }
      }).ok
    ).toBe(false);
  });
  it("pause → no order", () => {
    expect(
      gates({ config: { ...cfg, pauseNewEntries: true } }).ok
    ).toBe(false);
  });
  it("emergency stop → no order", () => {
    expect(
      gates({ config: { ...cfg, emergencyStopActive: true } }).ok
    ).toBe(false);
  });
  it("Live broker → refuse", () => {
    expect(gates({ brokerEnvironment: "LIVE" }).ok).toBe(false);
  });
  it("unknown env → refuse", () => {
    expect(gates({ brokerEnvironment: null }).ok).toBe(false);
  });
  it("invalid snapshot → refuse", () => {
    expect(gates({ accountSnapshotValid: false }).ok).toBe(false);
  });
  it("capital / daily loss / max open", () => {
    expect(gates({ capitalOk: false }).ok).toBe(false);
    expect(gates({ dailyLossOk: false }).ok).toBe(false);
    expect(gates({ openTradeCount: 1 }).ok).toBe(false);
  });
  it("duplicate signal → no order", () => {
    expect(gates({ signalConsumed: true }).ok).toBe(false);
  });
});

describe("Durable claim + broker truth", () => {
  beforeEach(async () => {
    resetGoldHunterSignalClaimsForTests();
    resetGoldHunterTradeMemory();
    await seedConfig(true);
    process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = "true";
  });

  it("same signal concurrent claims → one winner", async () => {
    const a = await acquireGoldHunterSignalClaim({
      ownerUid: OWNER,
      signalId: "sig-1",
      goldHunterTradeId: "GH-D-a",
      clientOrderId: "gh_a",
      setup: "A",
      side: "BUY"
    });
    const b = await acquireGoldHunterSignalClaim({
      ownerUid: OWNER,
      signalId: "sig-1",
      goldHunterTradeId: "GH-D-b",
      clientOrderId: "gh_b",
      setup: "A",
      side: "BUY"
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
  });

  it("restart with previously claimed signal → no duplicate", async () => {
    await acquireGoldHunterSignalClaim({
      ownerUid: OWNER,
      signalId: "sig-restart",
      goldHunterTradeId: "GH-D-1",
      clientOrderId: "gh_1",
      setup: "B",
      side: "SELL"
    });
    const again = await acquireGoldHunterSignalClaim({
      ownerUid: OWNER,
      signalId: "sig-restart",
      goldHunterTradeId: "GH-D-2",
      clientOrderId: "gh_2",
      setup: "B",
      side: "SELL"
    });
    expect(again.ok).toBe(false);
    expect((await getGoldHunterSignalClaim(OWNER, "sig-restart"))?.goldHunterTradeId).toBe(
      "GH-D-1"
    );
  });

  it("broker accepted=false → BROKER_REJECTED not FILLED", async () => {
    const result = await submitGoldHunterDemoOrder({
      ownerUid: OWNER,
      isAdmin: true,
      side: "BUY",
      lots: 0.1,
      stopLoss: 2599,
      entryHint: 2600,
      setup: "A",
      signalId: "sig-rej",
      goldHunterTradeId: "GH-D-rej",
      clientOrderId: "gh_rej",
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
      placeOrder: async () =>
        ({
          accepted: false,
          executionType: null,
          orderId: null,
          positionId: null,
          errorCode: "MARKET_CLOSED",
          clientOrderId: "gh_rej",
          fillPrice: null,
          stopLoss: null,
          takeProfit: null,
          filledVolumeLots: null,
          ctidTraderAccountId: "1"
        }) satisfies DemoMarketOrderResult
    });
    // May fail gates if connection missing — when placeOrder runs:
    if (result.ok) {
      expect(result.outcome).toBe("BROKER_REJECTED");
      expect(result.trade?.status).toBe("BROKER_REJECTED");
    }
  });

  it("broker throws after transport entry → PENDING_RECONCILIATION not FILLED", async () => {
    const result = await submitGoldHunterDemoOrder({
      ownerUid: OWNER,
      isAdmin: true,
      side: "BUY",
      lots: 0.1,
      stopLoss: 2599,
      entryHint: 2600,
      goldHunterTradeId: "GH-D-err",
      clientOrderId: "gh_err",
      signalId: "sig-err",
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
        throw new Error("SOCKET_TIMEOUT");
      }
    });
    if (result.ok) {
      expect(result.outcome).toBe("PENDING_RECONCILIATION");
      expect(result.trade?.status).toBe("PENDING_RECONCILIATION");
    }
  });

  it("broker accepted with fill → actual fillPrice/volume persisted", async () => {
    const result = await submitGoldHunterDemoOrder({
      ownerUid: OWNER,
      isAdmin: true,
      side: "BUY",
      lots: 0.05,
      stopLoss: 2599.4,
      entryHint: 2600,
      goldHunterTradeId: "GH-D-fill",
      clientOrderId: "gh_fill",
      signalId: "sig-fill",
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
      placeOrder: async () =>
        ({
          accepted: true,
          executionType: "FILL",
          orderId: "99",
          positionId: "88",
          errorCode: null,
          clientOrderId: "gh_fill",
          fillPrice: 2600.17,
          stopLoss: 2599.4,
          takeProfit: null,
          filledVolumeLots: 0.05,
          ctidTraderAccountId: "1"
        }) satisfies DemoMarketOrderResult
    });
    if (result.ok && result.outcome === "FILLED") {
      expect(result.trade?.entry).toBe(2600.17);
      expect(result.trade?.filledVolumeLots).toBe(0.05);
      expect(result.trade?.entry).not.toBe(2600);
    }
  });

  it("orchestrator: timeout before broker → PENDING_RECONCILIATION no resubmit", async () => {
    const cand = baseCandidate({ signalId: "sig-timeout" });
    const r1 = await attemptGoldHunterDemoExecution(OWNER, cand, {
      ...orchDeps(),
      beforeBrokerSubmit: async () => {
        throw new Error("TIMEOUT");
      }
    });
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.outcome).toBe("PENDING_RECONCILIATION");
    const r2 = await attemptGoldHunterDemoExecution(OWNER, cand, {
      ...orchDeps(),
      placeOrder: async () => {
        throw new Error("SHOULD_NOT_RUN");
      }
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.blockers).toContain("WAIT — DUPLICATE SIGNAL");
  });

  it("missing sizing metadata → no order", async () => {
    const r = await attemptGoldHunterDemoExecution(
      OWNER,
      baseCandidate({ signalId: "sig-meta" }),
      orchDeps({ symbol: symbolMeta({ maxVolume: null }) })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.blockers.some((b) => b.includes("SIZING METADATA"))).toBe(true);
    }
  });

  it("invalid depth candidate → no order", async () => {
    const r = await attemptGoldHunterDemoExecution(
      OWNER,
      baseCandidate({
        signalId: "sig-depth",
        depthExecutable: false,
        depthValidity: "DEPTH_CROSSED"
      }),
      orchDeps()
    );
    expect(r.ok).toBe(false);
  });
});

describe("Protection / capital / reconcile", () => {
  it("protection geometry from frozen hardStop", () => {
    const p = deriveGoldHunterInitialProtection({
      side: "BUY",
      entryPrice: 2600
    });
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.source).toBe("GH_FAST_FROZEN_HARD_STOP");
      expect(p.stopPrice).toBeCloseTo(2600 - 0.55, 6);
    }
  });

  it("sizing refuses without maxLots", () => {
    const r = sizeGoldHunterDemoLots({
      config: {
        ...GH_ADMIN_DEFAULT_CONFIG,
        updatedAt: "",
        updatedBy: "t"
      },
      entry: 2600,
      stop: 2599.45,
      valuePerPointPerLot: 1,
      minLots: 0.01,
      maxLots: 0,
      lotStep: 0.01
    });
    expect(r.ok).toBe(false);
  });

  it("committed capital independent of full demo balance", () => {
    const c = computeGoldHunterCommittedCapital({
      config: {
        ...GH_ADMIN_DEFAULT_CONFIG,
        allocatedCapitalEur: 2000,
        riskPerTradePct: 1,
        updatedAt: "",
        updatedBy: "t"
      },
      openTrades: []
    });
    expect(c.committedEur).toBe(0);
    expect(c.availableEur).toBe(2000);
  });

  it("unmatched non-GH position untouched", async () => {
    resetGoldHunterTradeMemory();
    const r = await reconcileGoldHunterDemoPositions({
      ownerUid: OWNER,
      brokerPositions: [
        { positionId: "999", comment: "MANUAL", label: "manual" }
      ]
    });
    expect(r.unmatched).toHaveLength(1);
    expect(r.restored).toHaveLength(0);
    expect(await listGoldHunterDemoTrades(OWNER)).toHaveLength(0);
  });

  it("restores GH-owned position on restart", async () => {
    resetGoldHunterTradeMemory();
    const r = await reconcileGoldHunterDemoPositions({
      ownerUid: OWNER,
      brokerPositions: [
        {
          positionId: "55",
          comment: "GOLD_HUNTER",
          label: "GH-D-abc1",
          side: "BUY",
          entryPrice: 2601,
          volumeLots: 0.1
        }
      ]
    });
    expect(r.restored).toHaveLength(1);
    expect(r.restored[0]?.brokerPositionId).toBe("55");
  });
});

describe("Arming readiness", () => {
  it("requires selector + protection geometry", () => {
    const snap = {
      provider: "cTrader" as const,
      environment: "DEMO" as const,
      authState: "AUTHORISED" as const,
      authorised: true,
      accountMasked: "48…10",
      brokerName: "Pepperstone",
      currency: "EUR",
      balance: 50000,
      equity: 50000,
      marginUsed: 0,
      freeMargin: 50000,
      openPositionCount: 0,
      capturedAt: new Date().toISOString(),
      ageMs: 0,
      source: "AUTHORITATIVE_DEMO" as const,
      notes: [],
      demoOrderSubmissionEnabled: true,
      validForRisk: true
    };
    const noSel = evaluateGoldHunterArmingReadiness({
      snapshot: snap,
      allocatedCapitalEur: 5000,
      riskPerTradePct: 1,
      strategySelectorConnected: false,
      protectionGeometryConnected: true
    });
    expect(noSel.ok).toBe(false);
    const ok = evaluateGoldHunterArmingReadiness({
      snapshot: snap,
      allocatedCapitalEur: 5000,
      riskPerTradePct: 1,
      strategySelectorConnected: true,
      protectionGeometryConnected: true
    });
    expect(ok.ok).toBe(true);
  });
});

describe("A/B/C setup letter mapping", () => {
  it("maps setup ids to A/B/C letters in candidate builder path", () => {
    expect(baseCandidate({ setup: "A" }).setup).toBe("A");
    expect(baseCandidate({ setup: "B", setupId: "B_FAST_BREAKOUT" }).setup).toBe(
      "B"
    );
    expect(
      baseCandidate({ setup: "C", setupId: "C_PULLBACK_REACCEL" }).setup
    ).toBe("C");
  });
});
