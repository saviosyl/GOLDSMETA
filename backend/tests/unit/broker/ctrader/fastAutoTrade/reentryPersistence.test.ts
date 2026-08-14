import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DecisionRecord } from "../../../../../src/models/types";
import {
  buildFastAutoTradeInput,
  evaluateFastAutoTrade,
  persistFastReentryEntry,
  persistFastReentryExit,
  resetFastReentryMemoryStore,
  setupIdentityKey,
  useCompletedM1LoaderForTests,
  useFastReentryMemoryStore,
  type FastSetupIdentity
} from "../../../../../src/services/broker/ctrader/fastAutoTrade";
import { withRollingM1History } from "./extensionTestSupport";

const firstLatest = {
  open: 3385.0,
  high: 3388.2,
  low: 3384.6,
  close: 3387.4,
  volume: 1200
};
const firstPrior = {
  open: 3386.2,
  high: 3386.8,
  low: 3384.4,
  close: 3385.1,
  volume: 800
};
const nextLatest = {
  open: 3388.0,
  high: 3390.0,
  low: 3387.0,
  close: 3389.2,
  volume: 1100
};
const nextPrior = {
  open: 3387.0,
  high: 3388.0,
  low: 3386.4,
  close: 3386.8,
  volume: 700
};

function decision(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    schemaVersion: "1.0",
    decisionId: "dec_ctx",
    userId: "uid-reentry",
    symbol: "XAUUSD",
    timeframe: "15",
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
    lastKnownPrice: 3387.4,
    ohlcv: { open: 3375, high: 3405, low: 3372, close: 3400, volume: 20000 },
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
    optionalIndicators: { atr: 2.4 },
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

async function evaluateUid(args: {
  uid: string;
  nowMs: number;
  rec?: DecisionRecord;
}) {
  const input = await buildFastAutoTradeInput({
    uid: args.uid,
    decision: args.rec ?? decision(),
    nowMs: args.nowMs,
    ...quote
  });
  return { input, decision: evaluateFastAutoTrade(input) };
}

async function persistEntry(
  uid: string,
  identity: FastSetupIdentity,
  action: "BUY" | "SELL",
  atMs: number
) {
  await persistFastReentryEntry(uid, {
    lastSetup: identity,
    lastSignalKey: setupIdentityKey(identity),
    currentCandleKey: identity.triggerCandle,
    lastAction: action,
    lastActionAtMs: atMs
  });
}

describe("FAST persisted re-entry state", () => {
  const uid = "uid-reentry";

  beforeEach(() => {
    useFastReentryMemoryStore(true);
    resetFastReentryMemoryStore();
    useCompletedM1LoaderForTests(async (args) => {
      const nowMs = args.nowMs ?? Date.parse("2026-08-14T09:02:00.000Z");
      return withRollingM1History({
        nowMs,
        latest: firstLatest,
        prior: firstPrior,
        typicalTr: 2.4
      });
    });
  });

  afterEach(() => {
    useCompletedM1LoaderForTests(null);
    useFastReentryMemoryStore(false);
  });

  it("blocks the same setup after a completed FAST trade", async () => {
    const first = await evaluateUid({
      uid,
      nowMs: Date.parse("2026-08-14T09:02:00.000Z")
    });
    expect(first.decision.action).toBe("BUY");
    expect(first.decision.identity).toBeTruthy();

    await persistEntry(
      uid,
      first.decision.identity!,
      "BUY",
      Date.parse("2026-08-14T09:02:00.000Z")
    );
    await persistFastReentryExit(uid, {
      lastExitAtMs: Date.parse("2026-08-14T09:02:20.000Z")
    });

    const again = await evaluateUid({
      uid,
      nowMs: Date.parse("2026-08-14T09:02:30.000Z")
    });
    expect(again.decision.action).toBe("WAIT");
    expect(again.decision.waitReason).toBe("WAIT_DUPLICATE_SETUP");
  });

  it("blocks a same-candle duplicate via persisted currentCandleKey", async () => {
    const first = await evaluateUid({
      uid,
      nowMs: Date.parse("2026-08-14T09:02:00.000Z")
    });
    expect(first.decision.identity).toBeTruthy();
    const identity = first.decision.identity!;

    await persistFastReentryEntry(uid, {
      lastSetup: {
        ...identity,
        timestamp: "2026-08-14T08:50:00.000Z"
      },
      lastSignalKey: setupIdentityKey(identity),
      currentCandleKey: identity.triggerCandle,
      lastAction: "BUY",
      lastActionAtMs: Date.parse("2026-08-14T08:50:00.000Z")
    });

    const again = await evaluateUid({
      uid,
      nowMs: Date.parse("2026-08-14T09:02:10.000Z")
    });
    expect(again.input.reentry.currentCandleKey).toBe(identity.triggerCandle);
    expect(again.input.reentry.lastSignalKey).toBe(setupIdentityKey(identity));
    expect(again.decision.action).toBe("WAIT");
    expect(again.decision.waitReason).toBe("WAIT_SAME_CANDLE");
  });

  it("allows a genuinely new independent setup after a completed trade", async () => {
    const first = await evaluateUid({
      uid,
      nowMs: Date.parse("2026-08-14T09:02:00.000Z")
    });
    expect(first.decision.action).toBe("BUY");
    await persistEntry(
      uid,
      first.decision.identity!,
      "BUY",
      Date.parse("2026-08-14T09:02:00.000Z")
    );
    await persistFastReentryExit(uid, {
      lastExitAtMs: Date.parse("2026-08-14T09:06:00.000Z")
    });

    useCompletedM1LoaderForTests(async (args) => {
      const nowMs = args.nowMs ?? Date.parse("2026-08-14T09:08:00.000Z");
      return withRollingM1History({
        nowMs,
        latest: nextLatest,
        prior: nextPrior,
        typicalTr: 2.4
      });
    });
    const next = await evaluateUid({
      uid,
      nowMs: Date.parse("2026-08-14T09:08:00.000Z"),
      rec: decision({
        marketStructure: {
          trend: "BULLISH",
          trendStrength: 62,
          poc: 3385.2,
          vah: 3392.0,
          val: 3383.8,
          confirmationClassification: "RETEST",
          confirmationDirection: "BULLISH"
        } as DecisionRecord["marketStructure"]
      })
    });
    expect(next.decision.action).toBe("BUY");
    expect(next.decision.setupType).toBe("BREAKOUT_RETEST");
    expect(next.decision.identity?.structureAnchor).not.toBe(
      first.decision.identity?.structureAnchor
    );
  });
});
