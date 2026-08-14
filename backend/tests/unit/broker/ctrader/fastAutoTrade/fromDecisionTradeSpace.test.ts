import { afterEach, describe, expect, it } from "vitest";
import type { DecisionRecord } from "../../../../../src/models/types";
import {
  buildFastAutoTradeInput,
  evaluateFastAutoTrade,
  forwardTradeBarrier,
  useCompletedM1LoaderForTests
} from "../../../../../src/services/broker/ctrader/fastAutoTrade";
import { withRollingM1History } from "./extensionTestSupport";

const NOW_MS = Date.parse("2026-08-14T11:40:00.000Z");
const nowSec = Math.floor(NOW_MS / 1000);

const buyPriorBar = {
  time: nowSec - 150,
  open: 3387.6,
  high: 3388.8,
  low: 3387.2,
  close: 3388.3,
  volume: 900
};

const buyLatestBar = {
  time: nowSec - 90,
  open: 3388.4,
  high: 3391.6,
  low: 3388.0,
  close: 3391.2,
  volume: 1400
};

const sellPriorBar = {
  time: nowSec - 150,
  open: 3382.2,
  high: 3383.0,
  low: 3381.4,
  close: 3381.7,
  volume: 800
};

const sellLatestBar = {
  time: nowSec - 90,
  open: 3381.6,
  high: 3382.0,
  low: 3378.4,
  close: 3378.8,
  volume: 1300
};

const safety = {
  accountIsLive: false,
  accountEnvironment: "DEMO" as const,
  spreadLimit: 2,
  maxQuoteAgeSeconds: 15
};

function decision(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    schemaVersion: "1.0",
    decisionId: "dec_fast_map",
    userId: "uid",
    symbol: "XAUUSD",
    timeframe: "5",
    barTime: "2026-08-14T11:35:00.000Z",
    generatedAt: "2026-08-14T11:35:00.000Z",
    marketDataTime: "2026-08-14T11:35:00.000Z",
    validUntil: "2026-08-14T11:50:00.000Z",
    decision: "BUY",
    confidence: 84,
    confidenceLabel: "HIGH",
    marketRegime: "TRENDING_UP",
    dataQuality: "GOOD",
    isProvisional: false,
    setupScore: 84,
    entry: { price: 3391.2 },
    stopLoss: { price: 3388.0 },
    takeProfits: [],
    riskReward: { tp1: 1, tp2: null, tp3: null },
    breakeven: null,
    earlyExit: null,
    bullishEvidence: ["breakout", "impulse"],
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
    lastKnownPrice: 3391.2,
    ohlcv: {
      open: 3388.4,
      high: 3391.6,
      low: 3388.0,
      close: 3391.2,
      volume: 1400
    },
    marketStructure: {
      trend: "BULLISH",
      trendStrength: 62,
      poc: 3390.4,
      vah: 3390.0,
      val: 3384.0,
      confirmationClassification: "BREAKOUT",
      confirmationDirection: "BULLISH",
      confirmationCandleType: null
    },
    dataSourceLabel: "TEST",
    environment: "TEST",
    isTestDecision: true,
    ...over
  } as DecisionRecord;
}

function withIndicators(
  rec: DecisionRecord,
  indicators: Record<string, number>
): DecisionRecord {
  return {
    ...rec,
    optionalIndicators: indicators
  } as DecisionRecord;
}

const buyIndicators = {
  vwap: 3390.3,
  ema21: 3390.1,
  ema50: 3389.4,
  atr: 2.4
};

const sellIndicators = {
  vwap: 3379.7,
  ema21: 3379.9,
  ema50: 3380.6,
  atr: 2.4
};

function sellDecision(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return decision({
    decision: "SELL",
    lastKnownPrice: 3378.8,
    entry: { price: 3378.8 },
    stopLoss: { price: 3382.0 },
    marketRegime: "TRENDING_DOWN",
    higherTimeframeBias: "BEARISH",
    bullishEvidence: [],
    bearishEvidence: ["breakout", "impulse"],
    marketStructure: {
      trend: "BEARISH",
      trendStrength: 62,
      poc: 3379.6,
      vah: 3386.0,
      val: 3380.0,
      confirmationClassification: "BREAKOUT",
      confirmationDirection: "BEARISH",
      confirmationCandleType: null
    },
    ...over
  });
}

describe("FAST DecisionRecord → map/build → engine trade-space", () => {
  afterEach(() => {
    useCompletedM1LoaderForTests(null);
  });

  it("BUY above broken VAH + separate resistance ahead uses that resistance as the forward barrier", async () => {
    useCompletedM1LoaderForTests(async () =>
      withRollingM1History({
        nowMs: NOW_MS,
        latest: buyLatestBar,
        prior: buyPriorBar,
        typicalTr: 2.4
      })
    );
    const rec = withIndicators(decision(), {
      ...buyIndicators,
      nearbyResistance: 3393.6
    });
    const input = await buildFastAutoTradeInput({
      uid: "uid-map",
      decision: rec,
      nowMs: NOW_MS,
      bid: 3391.15,
      ask: 3391.25,
      spread: 0.1,
      quoteAgeSeconds: 1,
      ...safety
    });

    expect(input.vah).toBe(3390.0);
    expect(input.val).toBe(3384.0);
    expect(input.nearbyResistance).toBe(3393.6);
    expect(input.nearbyResistance).not.toBe(input.vah);
    expect(input.nearbySupport).toBeNull();
    expect(forwardTradeBarrier(input, "BUY")).toBe(3393.6);

    const withBarrier = evaluateFastAutoTrade(input);
    expect(withBarrier.action).toBe("BUY");
    expect(withBarrier.setupType).toBe("BREAKOUT");
    expect(withBarrier.tradeSpaceOk).toBe(true);
    expect(withBarrier.geometry).not.toBeNull();
    expect(withBarrier.geometry!.takeProfit).toBeGreaterThan(withBarrier.geometry!.entry);
    expect(withBarrier.geometry!.takeProfit).toBeLessThan(3393.6);

    const tightInput = await buildFastAutoTradeInput({
      uid: "uid-map",
      decision: withIndicators(decision(), {
        ...buyIndicators,
        nearbyResistance: 3391.7
      }),
      nowMs: NOW_MS,
      bid: 3391.15,
      ask: 3391.25,
      spread: 0.1,
      quoteAgeSeconds: 1,
      ...safety
    });
    expect(tightInput.nearbyResistance).toBe(3391.7);
    expect(forwardTradeBarrier(tightInput, "BUY")).toBe(3391.7);
    const tight = evaluateFastAutoTrade(tightInput);
    expect(tight.action).toBe("WAIT");
    expect(tight.waitReason).toBe("WAIT_NO_TRADE_SPACE");
    expect(tight.tradeSpaceOk).toBe(false);
  });

  it("BUY above VAH with no separate resistance does not invent a forward barrier; ATR target is allowed", async () => {
    useCompletedM1LoaderForTests(async () =>
      withRollingM1History({
        nowMs: NOW_MS,
        latest: buyLatestBar,
        prior: buyPriorBar,
        typicalTr: 2.4
      })
    );
    const input = await buildFastAutoTradeInput({
      uid: "uid-map",
      decision: withIndicators(decision(), buyIndicators),
      nowMs: NOW_MS,
      bid: 3391.15,
      ask: 3391.25,
      spread: 0.1,
      quoteAgeSeconds: 1,
      ...safety
    });

    expect(input.vah).toBe(3390.0);
    expect(input.nearbyResistance).toBeNull();
    expect(forwardTradeBarrier(input, "BUY")).toBeNull();

    const d = evaluateFastAutoTrade(input);
    expect(d.action).toBe("BUY");
    expect(d.waitReason).not.toBe("WAIT_NO_TRADE_SPACE");
    expect(d.tradeSpaceOk).toBe(true);
    expect(d.geometry).not.toBeNull();
    expect(d.geometry!.takeProfit).toBeGreaterThan(d.geometry!.entry);
    expect(d.geometry!.takeProfit).not.toBe(input.vah);
  });

  it("SELL below broken VAL + separate support ahead uses that support as the forward barrier", async () => {
    useCompletedM1LoaderForTests(async () =>
      withRollingM1History({
        nowMs: NOW_MS,
        latest: sellLatestBar,
        prior: sellPriorBar,
        typicalTr: 2.4
      })
    );
    const rec = withIndicators(sellDecision(), {
      ...sellIndicators,
      nearbySupport: 3376.4
    });
    const input = await buildFastAutoTradeInput({
      uid: "uid-map",
      decision: rec,
      nowMs: NOW_MS,
      bid: 3378.75,
      ask: 3378.85,
      spread: 0.1,
      quoteAgeSeconds: 1,
      ...safety
    });

    expect(input.val).toBe(3380.0);
    expect(input.vah).toBe(3386.0);
    expect(input.nearbySupport).toBe(3376.4);
    expect(input.nearbySupport).not.toBe(input.val);
    expect(input.nearbyResistance).toBeNull();
    expect(forwardTradeBarrier(input, "SELL")).toBe(3376.4);

    const withBarrier = evaluateFastAutoTrade(input);
    expect(withBarrier.action).toBe("SELL");
    expect(withBarrier.setupType).toBe("BREAKOUT");
    expect(withBarrier.tradeSpaceOk).toBe(true);
    expect(withBarrier.geometry).not.toBeNull();
    expect(withBarrier.geometry!.takeProfit).toBeLessThan(withBarrier.geometry!.entry);
    expect(withBarrier.geometry!.takeProfit).toBeGreaterThan(3376.4);

    const tightInput = await buildFastAutoTradeInput({
      uid: "uid-map",
      decision: withIndicators(sellDecision(), {
        ...sellIndicators,
        nearbySupport: 3378.3
      }),
      nowMs: NOW_MS,
      bid: 3378.75,
      ask: 3378.85,
      spread: 0.1,
      quoteAgeSeconds: 1,
      ...safety
    });
    expect(tightInput.nearbySupport).toBe(3378.3);
    expect(forwardTradeBarrier(tightInput, "SELL")).toBe(3378.3);
    const tight = evaluateFastAutoTrade(tightInput);
    expect(tight.action).toBe("WAIT");
    expect(tight.waitReason).toBe("WAIT_NO_TRADE_SPACE");
    expect(tight.tradeSpaceOk).toBe(false);
  });

  it("SELL below VAL with no separate support does not invent a forward barrier; ATR target is allowed", async () => {
    useCompletedM1LoaderForTests(async () =>
      withRollingM1History({
        nowMs: NOW_MS,
        latest: sellLatestBar,
        prior: sellPriorBar,
        typicalTr: 2.4
      })
    );
    const input = await buildFastAutoTradeInput({
      uid: "uid-map",
      decision: withIndicators(sellDecision(), sellIndicators),
      nowMs: NOW_MS,
      bid: 3378.75,
      ask: 3378.85,
      spread: 0.1,
      quoteAgeSeconds: 1,
      ...safety
    });

    expect(input.val).toBe(3380.0);
    expect(input.nearbySupport).toBeNull();
    expect(forwardTradeBarrier(input, "SELL")).toBeNull();

    const d = evaluateFastAutoTrade(input);
    expect(d.action).toBe("SELL");
    expect(d.waitReason).not.toBe("WAIT_NO_TRADE_SPACE");
    expect(d.tradeSpaceOk).toBe(true);
    expect(d.geometry).not.toBeNull();
    expect(d.geometry!.takeProfit).toBeLessThan(d.geometry!.entry);
    expect(d.geometry!.takeProfit).not.toBe(input.val);
  });
});
