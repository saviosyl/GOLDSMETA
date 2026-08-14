import { afterEach, describe, expect, it } from "vitest";
import type { DecisionRecord } from "../../../../../src/models/types";
import type { TrendbarCandle } from "../../../../../src/services/broker/ctrader/openApiClient";
import {
  DEFAULT_FAST_AUTOTRADE_CONFIG,
  buildFastAutoTradeInput,
  evaluateFastAutoTrade,
  useCompletedM1LoaderForTests
} from "../../../../../src/services/broker/ctrader/fastAutoTrade";
import {
  EXT_POC as POC,
  EXT_TYPICAL_TR as TYPICAL_TR,
  EXT_VAH as VAH,
  EXT_VAL as VAL,
  buildCompletedM1Series,
  productionLikeDecision
} from "./extensionTestSupport";

const safety = {
  accountIsLive: false,
  accountEnvironment: "DEMO" as const,
  spreadLimit: 2,
  maxQuoteAgeSeconds: 15
};

function sellDecision(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return productionLikeDecision({
    decision: "SELL",
    marketRegime: "TRENDING_DOWN",
    higherTimeframeBias: "BEARISH",
    bullishEvidence: [],
    bearishEvidence: ["breakout", "impulse"],
    lastKnownPrice: 4374.37,
    entry: { price: 4374.37 },
    marketStructure: {
      trend: "BEARISH",
      trendStrength: 62,
      poc: 4388.0,
      vah: 4395.0,
      val: 4374.4,
      confirmationClassification: "BREAKOUT",
      confirmationDirection: "BEARISH",
      confirmationCandleType: null,
      nearbyResistance: 4395.0,
      nearbySupport: 4374.4
    },
    ...over
  });
}

async function evaluatePath(args: {
  nowMs: number;
  decision: DecisionRecord;
  bars: TrendbarCandle[];
  bid: number;
  ask: number;
  quoteAgeSeconds?: number;
  quoteStale?: boolean;
}) {
  useCompletedM1LoaderForTests(async () => args.bars);
  const input = await buildFastAutoTradeInput({
    uid: "uid-ext",
    decision: args.decision,
    nowMs: args.nowMs,
    bid: args.bid,
    ask: args.ask,
    spread: args.ask - args.bid,
    quoteAgeSeconds: args.quoteAgeSeconds ?? 1,
    quoteStale: args.quoteStale ?? false,
    marketStatus: "OPEN",
    ...safety
  });
  const decision = evaluateFastAutoTrade(input);
  return { input, decision };
}

describe("FAST_AUTOTRADE_V1 setup-aware extension model", () => {
  afterEach(() => {
    useCompletedM1LoaderForTests(null);
  });

  it("A. BUY BREAKOUT 0.03 above broken VAH, POC far below → not WAIT_EXTENDED", async () => {
    const nowMs = Date.parse("2026-08-14T12:43:00.000Z");
    const price = VAH + 0.03;
    const { input, decision } = await evaluatePath({
      nowMs,
      decision: productionLikeDecision({ lastKnownPrice: price, entry: { price } }),
      bars: buildCompletedM1Series({
        nowMs,
        last: { open: price - 2.4, high: price + 0.4, low: price - 2.8, close: price }
      }),
      bid: price - 0.05,
      ask: price + 0.05
    });

    expect(input.vwap).toBeNull();
    expect(input.ema21).toBeNull();
    expect(input.atr).toBeNull();
    expect(input.poc).toBe(POC);
    expect(input.m1History?.length).toBeGreaterThanOrEqual(15);
    expect(decision.waitReason).not.toBe("WAIT_EXTENDED");
    expect(decision.extended).toBe(false);
    expect(decision.extension.extensionAnchorType).toBe("BROKEN_VAH");
    expect(decision.extension.extensionAnchorPrice).toBe(VAH);
    expect(decision.extension.extensionAtrSource).toBe("M1_ATR14");
    expect(decision.extension.extensionLimitAtr).toBe(
      DEFAULT_FAST_AUTOTRADE_CONFIG.maximumExtensionAtr
    );
    expect(decision.extension.extensionDistanceAtr).toBeLessThan(2.2);
    expect(decision.action).toBe("BUY");
    expect(decision.setupType).toBe("BREAKOUT");
  });

  it("B. BUY BREAKOUT ~1 local ATR above broken VAH, POC far below → not WAIT_EXTENDED", async () => {
    const nowMs = Date.parse("2026-08-14T12:44:00.000Z");
    const price = VAH + TYPICAL_TR;
    const { decision } = await evaluatePath({
      nowMs,
      decision: productionLikeDecision({ lastKnownPrice: price, entry: { price } }),
      bars: buildCompletedM1Series({
        nowMs,
        last: { open: price - 3.2, high: price + 0.6, low: price - 3.6, close: price }
      }),
      bid: price - 0.05,
      ask: price + 0.05
    });

    expect(decision.waitReason).not.toBe("WAIT_EXTENDED");
    expect(decision.extended).toBe(false);
    expect(decision.extension.extensionAnchorType).toBe("BROKEN_VAH");
    expect(decision.extension.extensionDistanceAtr).toBeGreaterThan(0.6);
    expect(decision.extension.extensionDistanceAtr).toBeLessThan(1.6);
    expect(decision.action).toBe("BUY");
  });

  it("C. BUY already ~13 points / multiple local ATR beyond broken VAH → WAIT_EXTENDED", async () => {
    const nowMs = Date.parse("2026-08-14T12:42:00.000Z");
    const price = VAH + 13.19;
    const { decision } = await evaluatePath({
      nowMs,
      decision: productionLikeDecision({ lastKnownPrice: price, entry: { price } }),
      bars: buildCompletedM1Series({
        nowMs,
        last: { open: price - 4.0, high: price + 0.8, low: price - 4.4, close: price }
      }),
      bid: price - 0.05,
      ask: price + 0.05
    });

    expect(decision.action).toBe("WAIT");
    expect(decision.waitReason).toBe("WAIT_EXTENDED");
    expect(decision.extended).toBe(true);
    expect(decision.extension.extensionAnchorType).toBe("BROKEN_VAH");
    expect(decision.extension.extensionDistance).toBeCloseTo(13.19, 2);
    expect(decision.extension.extensionDistanceAtr).toBeGreaterThan(2.2);
    expect(decision.tradeSpaceOk).toBe(true);
  });

  it("D. SELL mirrors of A/B/C", async () => {
    const nowMs = Date.parse("2026-08-14T12:45:00.000Z");
    const sellVal = 4374.4;

    const early = await evaluatePath({
      nowMs,
      decision: sellDecision({ lastKnownPrice: sellVal - 0.03, entry: { price: sellVal - 0.03 } }),
      bars: buildCompletedM1Series({
        nowMs,
        last: {
          open: sellVal + 2.2,
          high: sellVal + 2.6,
          low: sellVal - 0.2,
          close: sellVal - 0.03
        }
      }),
      bid: sellVal - 0.08,
      ask: sellVal + 0.02
    });
    expect(early.decision.waitReason).not.toBe("WAIT_EXTENDED");
    expect(early.decision.extended).toBe(false);
    expect(early.decision.extension.extensionAnchorType).toBe("BROKEN_VAL");
    expect(early.decision.action).toBe("SELL");

    const oneAtr = sellVal - TYPICAL_TR;
    const mid = await evaluatePath({
      nowMs: nowMs + 60_000,
      decision: sellDecision({ lastKnownPrice: oneAtr, entry: { price: oneAtr } }),
      bars: buildCompletedM1Series({
        nowMs: nowMs + 60_000,
        last: { open: oneAtr + 3.0, high: oneAtr + 3.4, low: oneAtr - 0.5, close: oneAtr }
      }),
      bid: oneAtr - 0.05,
      ask: oneAtr + 0.05
    });
    expect(mid.decision.waitReason).not.toBe("WAIT_EXTENDED");
    expect(mid.decision.action).toBe("SELL");
    expect(mid.decision.extension.extensionDistanceAtr).toBeGreaterThan(0.6);
    expect(mid.decision.extension.extensionDistanceAtr).toBeLessThan(1.6);

    const chasePx = sellVal - 13.19;
    const chase = await evaluatePath({
      nowMs: nowMs + 120_000,
      decision: sellDecision({ lastKnownPrice: chasePx, entry: { price: chasePx } }),
      bars: buildCompletedM1Series({
        nowMs: nowMs + 120_000,
        last: { open: chasePx + 4.0, high: chasePx + 4.4, low: chasePx - 0.6, close: chasePx }
      }),
      bid: chasePx - 0.05,
      ask: chasePx + 0.05
    });
    expect(chase.decision.action).toBe("WAIT");
    expect(chase.decision.waitReason).toBe("WAIT_EXTENDED");
    expect(chase.decision.extension.extensionAnchorType).toBe("BROKEN_VAL");
    expect(chase.decision.extension.extensionDistanceAtr).toBeGreaterThan(2.2);
  });

  it("E. No VWAP / EMA / Decision ATR → rolling completed-M1 ATR, not latest M1 range", async () => {
    const nowMs = Date.parse("2026-08-14T12:46:00.000Z");
    const price = VAH + 1.2;
    const last = { open: price - 0.4, high: price + 0.05, low: price - 0.45, close: price };
    const { input, decision } = await evaluatePath({
      nowMs,
      decision: productionLikeDecision({ lastKnownPrice: price, entry: { price } }),
      bars: buildCompletedM1Series({ nowMs, last, typicalTr: 6.2 }),
      bid: price - 0.05,
      ask: price + 0.05
    });

    const latestRange = last.high - last.low;
    expect(input.atr).toBeNull();
    expect(input.vwap).toBeNull();
    expect(input.ema21).toBeNull();
    expect(decision.extension.extensionAtrSource).toBe("M1_ATR14");
    expect(decision.extension.extensionAtr).not.toBeNull();
    expect(Math.abs(decision.extension.extensionAtr! - latestRange)).toBeGreaterThan(3);
    expect(decision.extension.extensionAtr).toBeGreaterThan(4);
    expect(decision.extension.extensionAtr).toBeLessThan(9);
  });

  it("F. One unusually tiny M1 candle must not make a normal breakout look 10–30 ATR extended", async () => {
    const nowMs = Date.parse("2026-08-14T12:47:00.000Z");
    const price = VAH + 3.0;
    const { decision } = await evaluatePath({
      nowMs,
      decision: productionLikeDecision({ lastKnownPrice: price, entry: { price } }),
      bars: buildCompletedM1Series({
        nowMs,
        typicalTr: 6,
        last: { open: price - 0.08, high: price + 0.04, low: price - 0.16, close: price }
      }),
      bid: price - 0.05,
      ask: price + 0.05
    });

    const latestRange = 0.2;
    const ifUsedLatestRange = 3.0 / latestRange;
    expect(ifUsedLatestRange).toBeGreaterThan(10);
    expect(decision.extension.extensionAtrSource).toBe("M1_ATR14");
    expect(decision.extension.extensionDistanceAtr).toBeLessThan(1.2);
    expect(decision.waitReason).not.toBe("WAIT_EXTENDED");
    expect(decision.extended).toBe(false);
  });

  it("G. One unusually large M1 candle must not make a genuine chase look safe", async () => {
    const nowMs = Date.parse("2026-08-14T12:48:00.000Z");
    const price = VAH + 20;
    const { decision } = await evaluatePath({
      nowMs,
      decision: productionLikeDecision({ lastKnownPrice: price, entry: { price } }),
      bars: buildCompletedM1Series({
        nowMs,
        typicalTr: 6,
        last: { open: price - 36, high: price + 2, low: price - 38, close: price }
      }),
      bid: price - 0.05,
      ask: price + 0.05
    });

    const latestRange = 40;
    const ifUsedLatestRange = 20 / latestRange;
    expect(ifUsedLatestRange).toBeLessThan(2.2);
    expect(decision.extension.extensionAtrSource).toBe("M1_ATR14");
    expect(decision.extension.extensionAtr).toBeLessThan(12);
    expect(decision.action).toBe("WAIT");
    expect(decision.waitReason).toBe("WAIT_EXTENDED");
    expect(decision.extended).toBe(true);
    expect(decision.extension.extensionDistanceAtr).toBeGreaterThan(2.2);
  });

  it("H. No usable local volatility → WAIT_EXTENSION_VOLATILITY_UNAVAILABLE, not one-bar ATR", async () => {
    const nowMs = Date.parse("2026-08-14T12:49:00.000Z");
    const price = VAH + 0.8;
    const nowSec = Math.floor(nowMs / 1000);
    const { input, decision } = await evaluatePath({
      nowMs,
      decision: productionLikeDecision({ lastKnownPrice: price, entry: { price } }),
      bars: [
        {
          time: nowSec - 150,
          open: price - 1.2,
          high: price - 0.4,
          low: price - 1.6,
          close: price - 0.6,
          volume: 700
        },
        {
          time: nowSec - 90,
          open: price - 0.5,
          high: price + 0.3,
          low: price - 0.8,
          close: price,
          volume: 900
        }
      ],
      bid: price - 0.05,
      ask: price + 0.05
    });

    expect(input.atr).toBeNull();
    expect(input.m1History?.length).toBe(2);
    expect(decision.action).toBe("WAIT");
    expect(decision.waitReason).toBe("WAIT_EXTENSION_VOLATILITY_UNAVAILABLE");
    expect(decision.extension.extensionAtrSource).toBe("NONE");
    expect(decision.extension.extensionAtr).toBeNull();
    expect(decision.waitReason).not.toBe("WAIT_EXTENDED");
  });

  it("I. PULLBACK_CONTINUATION remains protected from genuine chase entries", async () => {
    const nowMs = Date.parse("2026-08-14T12:50:00.000Z");
    const price = VAH + 13.4;
    const { decision } = await evaluatePath({
      nowMs,
      decision: productionLikeDecision({
        lastKnownPrice: price,
        entry: { price },
        marketStructure: {
          trend: "BULLISH",
          trendStrength: 62,
          poc: POC,
          vah: VAH,
          val: VAL,
          confirmationClassification: "CONTINUATION",
          confirmationDirection: "BULLISH",
          confirmationCandleType: null,
          nearbyResistance: VAH,
          nearbySupport: VAL
        }
      }),
      bars: buildCompletedM1Series({
        nowMs,
        last: { open: price - 3.5, high: price + 0.5, low: price - 3.8, close: price }
      }),
      bid: price - 0.05,
      ask: price + 0.05
    });

    expect(decision.setupType).toBe("PULLBACK_CONTINUATION");
    expect(decision.action).toBe("WAIT");
    expect(decision.waitReason).toBe("WAIT_EXTENDED");
    expect(decision.extension.extensionAnchorType).toBe("BROKEN_VAH");
    expect(decision.extension.extensionDistanceAtr).toBeGreaterThan(2.2);
  });

  it("J. Existing WAIT_EXTENDED protection for obviously stretched moves remains", async () => {
    const nowMs = Date.parse("2026-08-14T12:51:00.000Z");
    const price = VAH + 18;
    const { decision } = await evaluatePath({
      nowMs,
      decision: productionLikeDecision({ lastKnownPrice: price, entry: { price } }),
      bars: buildCompletedM1Series({
        nowMs,
        last: { open: price - 5, high: price + 1, low: price - 5.5, close: price }
      }),
      bid: price - 0.05,
      ask: price + 0.05
    });

    expect(decision.action).toBe("WAIT");
    expect(decision.waitReason).toBe("WAIT_EXTENDED");
    expect(decision.extended).toBe(true);
    expect(decision.extension.extensionLimitAtr).toBe(2.2);
    expect(decision.extension.extensionDistanceAtr).toBeGreaterThan(2.2);
  });

  it("production requireCompletedM1 + 2 M1 bars + Decision ATR → WAIT_EXTENSION_VOLATILITY_UNAVAILABLE", async () => {
    const nowMs = Date.parse("2026-08-14T12:49:00.000Z");
    const price = VAH + 0.8;
    const nowSec = Math.floor(nowMs / 1000);
    const { input, decision } = await evaluatePath({
      nowMs,
      decision: productionLikeDecision({
        lastKnownPrice: price,
        entry: { price },
        optionalIndicators: { atr: 5.2 }
      } as DecisionRecord),
      bars: [
        {
          time: nowSec - 150,
          open: price - 1.2,
          high: price - 0.4,
          low: price - 1.6,
          close: price - 0.6,
          volume: 700
        },
        {
          time: nowSec - 90,
          open: price - 0.5,
          high: price + 0.3,
          low: price - 0.8,
          close: price,
          volume: 900
        }
      ],
      bid: price - 0.05,
      ask: price + 0.05
    });

    expect(input.requireCompletedM1).toBe(true);
    expect(input.atr).toBe(5.2);
    expect(input.m1History?.length).toBe(2);
    expect(decision.action).toBe("WAIT");
    expect(decision.waitReason).toBe("WAIT_EXTENSION_VOLATILITY_UNAVAILABLE");
    expect(decision.extension.extensionAtrSource).toBe("NONE");
    expect(decision.extension.extensionAtr).toBeNull();
  });

  it("non-production requireCompletedM1=false + Decision ATR + no M1 history → DECISION_ATR", async () => {
    const { evaluateFastAutoTrade, estimateExtensionAtr } = await import(
      "../../../../../src/services/broker/ctrader/fastAutoTrade"
    );
    const input = {
      nowMs: Date.parse("2026-08-14T12:50:00.000Z"),
      price: VAH + 0.8,
      bid: VAH + 0.75,
      ask: VAH + 0.85,
      spread: 0.1,
      quoteAgeSeconds: 1,
      quoteStale: false,
      marketStatus: "OPEN",
      timeframe: "1",
      ohlcv: {
        open: VAH - 1,
        high: VAH + 1,
        low: VAH - 1.4,
        close: VAH + 0.8,
        volume: 900
      },
      priorOhlcv: null,
      trendDirection: "BULLISH" as const,
      trendStrength: 62,
      htfBias: "BULLISH" as const,
      vwap: null,
      ema21: null,
      ema50: null,
      atr: 5.2,
      poc: POC,
      vah: VAH,
      val: VAL,
      nearbyResistance: VAH,
      nearbySupport: VAL,
      marketRegimeHint: "TRENDING_UP",
      setupScore: 84,
      v3Decision: "BUY" as const,
      bullishEvidence: ["breakout"],
      bearishEvidence: [],
      reasonCodes: [],
      confirmationClassification: "BREAKOUT",
      confirmationDirection: "BULLISH" as const,
      dataQuality: "GOOD",
      sessionPlanState: null,
      safety: {
        accountIsLive: false,
        accountEnvironment: "DEMO" as const,
        spreadLimit: 2,
        maxQuoteAgeSeconds: 15,
        dailyLossBreached: false,
        maxOpenReached: false,
        newsBlocked: false,
        disconnected: false,
        duplicateActiveOrder: false,
        riskLimitBreached: false
      },
      reentry: {
        lastSetup: null,
        lastExitAtMs: null,
        lastSignalKey: null,
        currentCandleKey: null,
        lastAction: null,
        lastActionAtMs: null
      },
      lifecycle: { state: "SCANNING" as const, stateEnteredAtMs: Date.parse("2026-08-14T12:50:00.000Z") },
      requireCompletedM1: false,
      m1History: null
    };
    const atr = estimateExtensionAtr(input);
    expect(atr.source).toBe("DECISION_ATR");
    expect(atr.atr).toBe(5.2);
    const decision = evaluateFastAutoTrade(input);
    expect(decision.extension.extensionAtrSource).toBe("DECISION_ATR");
    expect(decision.waitReason).not.toBe("WAIT_EXTENSION_VOLATILITY_UNAVAILABLE");
  });
});
