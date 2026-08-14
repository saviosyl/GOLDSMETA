import { afterEach, describe, expect, it } from "vitest";
import type { DecisionRecord } from "../../../../../src/models/types";
import {
  buildFastAutoTradeInput,
  evaluateFastAutoTrade,
  useCompletedM1LoaderForTests
} from "../../../../../src/services/broker/ctrader/fastAutoTrade";

const NOW_MS = Date.parse("2026-08-14T09:02:30.000Z");
const nowSec = Math.floor(NOW_MS / 1000);

const priorBar = {
  time: nowSec - 150,
  open: 3386.2,
  high: 3386.8,
  low: 3384.4,
  close: 3385.1,
  volume: 800
};

const freshLatest = {
  time: nowSec - 90,
  open: 3385.0,
  high: 3388.2,
  low: 3384.6,
  close: 3387.4,
  volume: 1200
};

const staleLatest = {
  time: nowSec - 600,
  open: 3385.0,
  high: 3388.2,
  low: 3384.6,
  close: 3387.4,
  volume: 1200
};

function decision(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    schemaVersion: "1.0",
    decisionId: "dec_ctx",
    userId: "uid-m1",
    symbol: "XAUUSD",
    timeframe: "5",
    barTime: "2026-08-14T09:00:00.000Z",
    generatedAt: "2026-08-14T09:00:00.000Z",
    marketDataTime: "2026-08-14T09:00:00.000Z",
    validUntil: "2026-08-14T09:15:00.000Z",
    decision: "WAIT",
    confidence: 70,
    confidenceLabel: "HIGH",
    marketRegime: "TRENDING_UP",
    dataQuality: "GOOD",
    isProvisional: false,
    setupScore: 70,
    entry: { price: 3387.4 },
    stopLoss: { price: 3384.8 },
    takeProfits: [],
    riskReward: { tp1: 1, tp2: null, tp3: null },
    breakeven: null,
    earlyExit: null,
    bullishEvidence: ["structure"],
    bearishEvidence: [],
    reasonCodes: ["TREND_BULLISH"],
    reasonSummary: [],
    warnings: [],
    missingInputs: [],
    invalidation: "",
    disclaimer: "",
    lifecycleState: "ACTIVE",
    snapshotId: null,
    ruleConfigVersion: "1",
    pineScriptVersion: null,
    backendVersion: "1",
    aiModelId: null,
    aiPromptVersion: null,
    aiSafetyDowngraded: false,
    notificationSent: false,
    currentSession: "LONDON",
    higherTimeframeBias: "BULLISH",
    lastKnownPrice: 3408,
    ohlcv: { open: 3370, high: 3410, low: 3365, close: 3408, volume: 9000 },
    marketStructure: {
      trend: "BULLISH",
      trendStrength: 62,
      poc: 3385.2,
      vah: 3392.0,
      val: 3383.8,
      confirmationClassification: "CONTINUATION",
      confirmationDirection: "BULLISH"
    },
    dataSourceLabel: "TEST",
    environment: "TEST",
    isTestDecision: true,
    ...over
  } as DecisionRecord;
}

const quote = {
  bid: 3387.35,
  ask: 3387.45,
  spread: 0.1,
  quoteAgeSeconds: 1,
  accountIsLive: false,
  accountEnvironment: "DEMO" as const,
  spreadLimit: 2,
  maxQuoteAgeSeconds: 15
};

async function evaluate(rec: DecisionRecord) {
  const input = await buildFastAutoTradeInput({
    uid: "uid-m1",
    decision: rec,
    nowMs: NOW_MS,
    ...quote
  });
  return { input, decision: evaluateFastAutoTrade(input) };
}

describe("FAST requires a fresh completed M1 for entry", () => {
  afterEach(() => {
    useCompletedM1LoaderForTests(null);
  });

  it("fresh completed M1 → FAST may BUY/SELL", async () => {
    useCompletedM1LoaderForTests(async () => [priorBar, freshLatest]);
    const { input, decision: d } = await evaluate(decision());
    expect(input.m1Availability).toBe("OK");
    expect(input.timeframe).toBe("1");
    expect(input.ohlcv?.close).toBe(freshLatest.close);
    expect(d.action).toBe("BUY");
    expect(d.waitReason).toBeNull();
  });

  it("no M1 → WAIT_M1_UNAVAILABLE", async () => {
    useCompletedM1LoaderForTests(async () => []);
    const { input, decision: d } = await evaluate(decision());
    expect(input.ohlcv).toBeNull();
    expect(input.m1Availability).toBe("UNAVAILABLE");
    expect(d.action).toBe("WAIT");
    expect(d.waitReason).toBe("WAIT_M1_UNAVAILABLE");
  });

  it("loader failure → WAIT_M1_UNAVAILABLE", async () => {
    useCompletedM1LoaderForTests(async () => {
      throw new Error("trendbar fetch failed");
    });
    const { decision: d } = await evaluate(decision());
    expect(d.action).toBe("WAIT");
    expect(d.waitReason).toBe("WAIT_M1_UNAVAILABLE");
  });

  it("stale M1 → WAIT_M1_STALE", async () => {
    useCompletedM1LoaderForTests(async () => [staleLatest]);
    const { input, decision: d } = await evaluate(decision());
    expect(input.m1Availability).toBe("STALE");
    expect(input.ohlcv?.close).toBe(staleLatest.close);
    expect(d.action).toBe("WAIT");
    expect(d.waitReason).toBe("WAIT_M1_STALE");
  });

  it("5m/15m BUY decision + no M1 must not create a FAST entry", async () => {
    useCompletedM1LoaderForTests(async () => []);
    const { input, decision: d } = await evaluate(
      decision({
        decision: "BUY",
        setupScore: 94,
        confidence: 94,
        timeframe: "15"
      })
    );
    expect(input.v3Decision).toBe("BUY");
    expect(input.ohlcv).toBeNull();
    expect(d.action).toBe("WAIT");
    expect(d.waitReason).toBe("WAIT_M1_UNAVAILABLE");
    expect(d.signalId).toBeNull();
    expect(d.geometry).toBeNull();
  });
});
