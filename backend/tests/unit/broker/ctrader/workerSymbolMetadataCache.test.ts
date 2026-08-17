/**
 * Gold Hunter worker-session XAUUSD symbol metadata cache — tests A–J.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import type { BrokerSymbol } from "../../../../src/services/broker/domain";

function completeSymbol(environment: "DEMO" | "LIVE" = "DEMO"): BrokerSymbol {
  return {
    brokerId: "pepperstone_ctrader",
    environment,
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

const discoverCalls = { n: 0 };

vi.mock("../../../../src/services/broker/ctrader/connectionStore", () => ({
  getConnection: vi.fn()
}));

vi.mock("../../../../src/services/broker/ctrader/flags", () => ({
  isCTraderLiveEnabled: () => false,
  isCTraderDemoOrderSubmissionEnabled: () => true,
  isBrokerExecutionEnabled: () => false
}));

vi.mock("../../../../src/services/broker/ctrader/demoPositionMutations", () => ({
  loadDemoXauUsdSymbol: vi.fn(async () => {
    discoverCalls.n += 1;
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
  })
}));

vi.mock("../../../../src/services/marketFeed/sharedMarketData", () => ({
  getSharedXauusdQuote: vi.fn(async () => ({
    marketStatus: "OPEN",
    updatedAt: new Date().toISOString(),
    bid: 2600,
    ask: 2600.12
  }))
}));

import { getConnection } from "../../../../src/services/broker/ctrader/connectionStore";
import { loadDemoXauUsdSymbol } from "../../../../src/services/broker/ctrader/demoPositionMutations";
import { brokerSymbolFromProtoOASymbolById } from "../../../../src/services/broker/ctrader/brokerSymbolFromProtoOASymbolById";
import {
  getWorkerSymbolMetadata,
  invalidateWorkerSymbolMetadataCache,
  loadGoldHunterDemoXauUsdSymbol,
  putWorkerSymbolMetadata,
  resetWorkerSymbolMetadataCacheForTests,
  workerSymbolMetadataCacheStats
} from "../../../../src/services/broker/ctrader/workerSymbolMetadataCache";
import {
  enqueueGoldHunterDemoAutoExecution,
  drainGoldHunterDemoAutoExecutionForTests,
  resetGoldHunterDemoAutoExecutionForTests,
  setGoldHunterDemoAutoExecutionHooksForTests
} from "../../../../src/services/goldHunterAdmin/demoAutoExecutionRuntime";
import {
  getGoldHunterStrategySelector,
  resetGoldHunterStrategySelectorsForTests
} from "../../../../src/services/goldHunterAdmin/strategySelector";
import {
  resetGoldHunterSignalClaimsForTests,
  acquireGoldHunterSignalClaim
} from "../../../../src/services/goldHunterAdmin/signalClaimStore";
import { resetGoldHunterTradeMemory } from "../../../../src/services/goldHunterAdmin/tradeStore";
import { saveGoldHunterConfig } from "../../../../src/services/goldHunterAdmin/configStore";
import { resetOwnerQueuesForTests } from "../../../../src/services/goldHunterAdmin/boundedQueue";
import { resetGoldHunterMarketFeedForTests } from "../../../../src/services/goldHunterAdmin/marketFeedHook";
import { getGoldHunterExecutionDiagnostics } from "../../../../src/services/goldHunterAdmin/executionRuntimeStore";
import { GH_ADMIN_DEFAULT_CONFIG } from "../../../../src/services/goldHunterAdmin/types";
import { metadataFromBrokerSymbol } from "../../../../src/services/goldHunterAdmin/instrumentMetadata";
import {
  isCTraderLiveEnabled,
  isBrokerExecutionEnabled
} from "../../../../src/services/broker/ctrader/flags";

const OWNER = "gh-symbol-cache-owner";
let oppClock = 1_700_000_000_000;

function incompleteSymbol(): BrokerSymbol {
  return {
    ...completeSymbol(),
    minVolume: null,
    maxVolume: null,
    volumeStep: null,
    metadataComplete: false,
    missingFields: ["minVolume", "maxVolume", "volumeStep"]
  };
}

function protoDetail(): Record<string, unknown> {
  return {
    symbolName: "XAUUSD",
    digits: 2,
    pipPosition: 1,
    minVolume: 1,
    maxVolume: 5000,
    stepVolume: 1,
    lotSize: 10000,
    slDistance: 10,
    distanceSetIn: 1,
    scheduleTimeZone: "UTC",
    schedule: []
  };
}

async function seedConfig() {
  await saveGoldHunterConfig(OWNER, {
    ...GH_ADMIN_DEFAULT_CONFIG,
    demoAutoTradeEnabled: true,
    mode: "DEMO_AUTO",
    updatedAt: new Date().toISOString(),
    updatedBy: OWNER
  });
}

function openOpportunity(side: "BUY" | "SELL" = "SELL") {
  const sel = getGoldHunterStrategySelector(OWNER);
  if (sel.getActiveOpportunityId()) {
    oppClock += 10;
    sel.processInjectedSelectionForTests({
      selected: null,
      receivedAtMs: oppClock,
      bookGeneration: Math.floor(oppClock / 100)
    });
  }
  oppClock += 400;
  const tick = sel.processInjectedSelectionForTests({
    selected: {
      setup: side === "BUY" ? "B_FAST_BREAKOUT" : "A_MOMENTUM_IGNITION",
      side,
      quality: 0.7
    },
    receivedAtMs: oppClock,
    bookGeneration: Math.floor(oppClock / 100)
  });
  expect(tick.newOpportunity).toBe(true);
  return tick.opportunity!;
}

function mockDemoConnection() {
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
}

beforeEach(async () => {
  oppClock = 1_700_000_000_000;
  discoverCalls.n = 0;
  resetWorkerSymbolMetadataCacheForTests();
  resetGoldHunterStrategySelectorsForTests();
  resetGoldHunterSignalClaimsForTests();
  resetGoldHunterTradeMemory();
  resetGoldHunterMarketFeedForTests();
  resetGoldHunterDemoAutoExecutionForTests();
  resetOwnerQueuesForTests();
  await seedConfig();
  mockDemoConnection();
  vi.mocked(loadDemoXauUsdSymbol).mockImplementation(async () => {
    discoverCalls.n += 1;
    return completeSymbol();
  });
});

describe("Worker symbol metadata cache A–J", () => {
  it("A — ProtoOASymbolById detail → valid BrokerSymbol cached", () => {
    const symbol = brokerSymbolFromProtoOASymbolById({
      detail: protoDetail(),
      symbolId: "41",
      symbolName: "XAUUSD",
      baseAsset: "XAU",
      quoteAsset: "USD",
      environment: "DEMO"
    });
    expect(symbol).toBeTruthy();
    expect(metadataFromBrokerSymbol(symbol!).complete).toBe(true);
    const ok = putWorkerSymbolMetadata({
      ownerUid: OWNER,
      ctidTraderAccountId: "48014710",
      environment: "DEMO",
      symbol: symbol!,
      source: "CTRADER_WORKER_SYMBOL_BY_ID"
    });
    expect(ok).toBe(true);
    const entry = getWorkerSymbolMetadata({
      ownerUid: OWNER,
      ctidTraderAccountId: "48014710",
      environment: "DEMO",
      symbolId: "41"
    });
    expect(entry?.source).toBe("CTRADER_WORKER_SYMBOL_BY_ID");
    expect(entry?.symbol.minVolume).toBe(0.01);
  });

  it("B — matching cache → no discoverXauUsd → execution continues", async () => {
    putWorkerSymbolMetadata({
      ownerUid: OWNER,
      ctidTraderAccountId: "48014710",
      environment: "DEMO",
      symbol: completeSymbol(),
      source: "CTRADER_WORKER_SYMBOL_BY_ID"
    });
    let sawSymbol = false;
    setGoldHunterDemoAutoExecutionHooksForTests({
      loadSymbolWithDiagnostics: async (uid) => {
        const r = await loadGoldHunterDemoXauUsdSymbol(uid);
        sawSymbol = r.symbol != null;
        return r;
      },
      attempt: async (_uid, cand) => {
        getGoldHunterStrategySelector(OWNER).markOpportunityConsumed(
          cand.opportunityId
        );
        return {
          ok: true,
          submitted: true,
          outcome: "FILLED",
          signalId: cand.signalId,
          tradeId: "GH-D-cache"
        };
      },
      isAdmin: async () => true
    });
    const opportunity = openOpportunity();
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(sawSymbol).toBe(true);
    expect(discoverCalls.n).toBe(0);
    expect(workerSymbolMetadataCacheStats().hits).toBeGreaterThanOrEqual(1);
    expect(getGoldHunterExecutionDiagnostics(OWNER).symbolMetadata?.source).toBe(
      "CTRADER_WORKER_SYMBOL_BY_ID"
    );
  });

  it("C — 100 opportunities with valid cache → zero discovery calls", async () => {
    putWorkerSymbolMetadata({
      ownerUid: OWNER,
      ctidTraderAccountId: "48014710",
      environment: "DEMO",
      symbol: completeSymbol(),
      source: "CTRADER_WORKER_SYMBOL_BY_ID"
    });
    for (let i = 0; i < 100; i++) {
      const r = await loadGoldHunterDemoXauUsdSymbol(OWNER);
      expect(r.symbol).toBeTruthy();
      expect(r.diagnostics.source).toBe("CTRADER_WORKER_SYMBOL_BY_ID");
    }
    expect(discoverCalls.n).toBe(0);
    expect(workerSymbolMetadataCacheStats().hits).toBe(100);
    expect(workerSymbolMetadataCacheStats().misses).toBe(0);
  });

  it("D — reconnect/account/symbol change invalidates old cache", () => {
    putWorkerSymbolMetadata({
      ownerUid: OWNER,
      ctidTraderAccountId: "48014710",
      environment: "DEMO",
      symbol: completeSymbol(),
      source: "CTRADER_WORKER_SYMBOL_BY_ID"
    });
    invalidateWorkerSymbolMetadataCache({
      ownerUid: OWNER,
      reason: "worker_reconnect"
    });
    expect(
      getWorkerSymbolMetadata({
        ownerUid: OWNER,
        ctidTraderAccountId: "48014710",
        environment: "DEMO",
        symbolId: "41"
      })
    ).toBeNull();
    expect(workerSymbolMetadataCacheStats().invalidated).toBeGreaterThanOrEqual(1);
    putWorkerSymbolMetadata({
      ownerUid: OWNER,
      ctidTraderAccountId: "48014710",
      environment: "DEMO",
      symbol: completeSymbol(),
      source: "CTRADER_WORKER_SYMBOL_BY_ID"
    });
    expect(
      getWorkerSymbolMetadata({
        ownerUid: OWNER,
        ctidTraderAccountId: "99999999",
        environment: "DEMO",
        symbolId: "41"
      })
    ).toBeNull();
  });

  it("E — incomplete cache metadata fail closed (no invented lots)", () => {
    const ok = putWorkerSymbolMetadata({
      ownerUid: OWNER,
      ctidTraderAccountId: "48014710",
      environment: "DEMO",
      symbol: incompleteSymbol(),
      source: "CTRADER_WORKER_SYMBOL_BY_ID"
    });
    expect(ok).toBe(false);
    expect(
      getWorkerSymbolMetadata({
        ownerUid: OWNER,
        ctidTraderAccountId: "48014710",
        environment: "DEMO",
        symbolId: "41"
      })
    ).toBeNull();
    expect(metadataFromBrokerSymbol(incompleteSymbol()).complete).toBe(false);
    expect(workerSymbolMetadataCacheStats().parseFailed).toBeGreaterThanOrEqual(1);
  });

  it("F — cache miss → one coalesced fallback discovery shared by callers", async () => {
    let resolveDiscover!: (v: BrokerSymbol) => void;
    const gate = new Promise<BrokerSymbol>((r) => {
      resolveDiscover = r;
    });
    vi.mocked(loadDemoXauUsdSymbol).mockImplementation(async () => {
      discoverCalls.n += 1;
      return gate;
    });

    const p1 = loadGoldHunterDemoXauUsdSymbol(OWNER);
    const p2 = loadGoldHunterDemoXauUsdSymbol(OWNER);
    const p3 = loadGoldHunterDemoXauUsdSymbol(OWNER);
    // Connection lookup is async; wait until the coalesced fallback starts.
    for (let i = 0; i < 50 && discoverCalls.n === 0; i++) {
      await Promise.resolve();
    }
    expect(discoverCalls.n).toBe(1);
    resolveDiscover(completeSymbol());
    const [a, b, c] = await Promise.all([p1, p2, p3]);
    expect(a.symbol?.symbolId).toBe("41");
    expect(b.diagnostics.source).toBe("FALLBACK_DISCOVERY");
    expect(c.diagnostics.available).toBe(true);
    expect(discoverCalls.n).toBe(1);
  });

  it("G — fallback hang → timeout → queue releases → no claim", async () => {
    setGoldHunterDemoAutoExecutionHooksForTests({
      loadSymbolWithDiagnostics: async () => {
        await new Promise(() => undefined);
        return {
          symbol: null,
          diagnostics: {
            available: false,
            source: null,
            loadedAt: null,
            symbolId: null,
            ctidTraderAccountId: null,
            accountMatched: false,
            environment: null
          }
        };
      },
      attempt: async () => {
        throw new Error("should_not_submit");
      },
      isAdmin: async () => true
    });
    const opportunity = openOpportunity();
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(getGoldHunterExecutionDiagnostics(OWNER).blocker).toBe(
      "WAIT — RUNTIME TIMEOUT"
    );
    expect(getGoldHunterExecutionDiagnostics(OWNER).currentStage).toBe(
      "SYMBOL_LOAD_START"
    );
  }, 15_000);

  it("H — LIVE connection refused for Gold Hunter symbol load", async () => {
    vi.mocked(getConnection).mockResolvedValue({
      selectedAccountId: "48014710",
      selectedAccountIsLive: true,
      environment: "LIVE",
      symbolId: "41",
      symbolName: "XAUUSD"
    } as never);
    const live = await loadGoldHunterDemoXauUsdSymbol(OWNER);
    expect(live.symbol).toBeNull();
    expect(live.diagnostics.environment).toBe("LIVE");
    expect(discoverCalls.n).toBe(0);
  });

  it("I — durable claim behaviour unchanged (no duplicate submissions)", async () => {
    putWorkerSymbolMetadata({
      ownerUid: OWNER,
      ctidTraderAccountId: "48014710",
      environment: "DEMO",
      symbol: completeSymbol(),
      source: "CTRADER_WORKER_SYMBOL_BY_ID"
    });
    let submits = 0;
    setGoldHunterDemoAutoExecutionHooksForTests({
      loadSymbolWithDiagnostics: (uid) => loadGoldHunterDemoXauUsdSymbol(uid),
      attempt: async (uid, cand) => {
        submits += 1;
        await acquireGoldHunterSignalClaim({
          ownerUid: uid,
          signalId: cand.opportunityId,
          goldHunterTradeId: "GH-D-once",
          clientOrderId: "gh_once",
          setup: cand.setup,
          side: cand.side
        });
        getGoldHunterStrategySelector(OWNER).markOpportunityConsumed(
          cand.opportunityId
        );
        return {
          ok: true,
          submitted: true,
          outcome: "FILLED",
          signalId: cand.signalId,
          tradeId: "GH-D-once"
        };
      },
      isAdmin: async () => true
    });
    const opportunity = openOpportunity();
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    enqueueGoldHunterDemoAutoExecution({
      ownerUid: OWNER,
      newOpportunity: true,
      opportunity
    });
    await drainGoldHunterDemoAutoExecutionForTests(OWNER);
    expect(submits).toBe(1);
  });

  it("J — Live execution remains impossible", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
    expect(isBrokerExecutionEnabled()).toBe(false);
    expect(
      isCTraderLiveEnabled({ CTRADER_LIVE_ENABLED: "true" } as NodeJS.ProcessEnv)
    ).toBe(false);
  });
});
