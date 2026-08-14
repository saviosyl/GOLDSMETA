import { describe, expect, it } from "vitest";
import {
  evaluateFastAutoTrade,
  evaluateFastAutoTradeDemoLock,
  FAST_AUTOTRADE_V1_DEMO_ONLY,
  type FastAutoTradeInput
} from "../../../../../src/services/broker/ctrader/fastAutoTrade";

function safeInput(over: Partial<FastAutoTradeInput> = {}): FastAutoTradeInput {
  return {
    nowMs: Date.parse("2026-08-14T09:00:00.000Z"),
    price: 3387.4,
    bid: 3387.35,
    ask: 3387.45,
    spread: 0.1,
    quoteAgeSeconds: 1,
    quoteStale: false,
    marketStatus: "OPEN",
    timeframe: "5",
    ohlcv: {
      open: 3385.0,
      high: 3388.2,
      low: 3384.6,
      close: 3387.4,
      volume: 1200
    },
    priorOhlcv: null,
    trendDirection: "BULLISH",
    trendStrength: 62,
    htfBias: "BULLISH",
    vwap: 3385.5,
    ema21: 3385.8,
    ema50: 3384.9,
    atr: 2.4,
    poc: 3385.2,
    vah: 3392.0,
    val: 3383.8,
    nearbyResistance: 3392.0,
    nearbySupport: 3383.8,
    marketRegimeHint: "TRENDING_UP",
    setupScore: 70,
    v3Decision: "WAIT",
    bullishEvidence: ["structure"],
    bearishEvidence: [],
    reasonCodes: [],
    confirmationClassification: "CONTINUATION",
    confirmationDirection: "BULLISH",
    dataQuality: "GOOD",
    sessionPlanState: null,
    safety: {
      accountIsLive: false,
      accountEnvironment: "DEMO",
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
    lifecycle: { state: "SCANNING", stateEnteredAtMs: Date.now() },
    ...over
  };
}

describe("FAST_AUTOTRADE_V1 safety", () => {
  it("spread too high → WAIT", () => {
    const d = evaluateFastAutoTrade(safeInput({ spread: 3.5 }));
    expect(d.action).toBe("WAIT");
    expect(d.waitReason).toBe("WAIT_SPREAD");
  });

  it("stale price → WAIT", () => {
    const d = evaluateFastAutoTrade(
      safeInput({ quoteStale: true, quoteAgeSeconds: 40 })
    );
    expect(d.action).toBe("WAIT");
    expect(d.waitReason).toBe("WAIT_STALE_PRICE");
  });

  it("risk limit → WAIT", () => {
    const d = evaluateFastAutoTrade(
      safeInput({
        safety: {
          ...safeInput().safety,
          dailyLossBreached: true
        }
      })
    );
    expect(d.action).toBe("WAIT");
    expect(d.waitReason).toBe("WAIT_RISK_LIMIT");
  });

  it("duplicate setup → WAIT", () => {
    const first = evaluateFastAutoTrade(safeInput());
    expect(first.action).toBe("BUY");
    expect(first.identity).not.toBeNull();
    const d = evaluateFastAutoTrade(
      safeInput({
        reentry: {
          lastSetup: first.identity,
          lastExitAtMs: Date.parse("2026-08-14T08:59:30.000Z"),
          lastSignalKey: null,
          currentCandleKey: null,
          lastAction: "BUY",
          lastActionAtMs: Date.parse("2026-08-14T08:59:30.000Z")
        }
      })
    );
    expect(d.action).toBe("WAIT");
    expect(d.waitReason).toBe("WAIT_DUPLICATE_SETUP");
  });

  it("live account + FAST_AUTOTRADE_V1 → BLOCK ORDER", () => {
    const gate = evaluateFastAutoTradeDemoLock({
      strategyId: "FAST_AUTOTRADE_V1",
      accountIsLive: true,
      environment: "LIVE"
    });
    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe(FAST_AUTOTRADE_V1_DEMO_ONLY);

    const d = evaluateFastAutoTrade(
      safeInput({
        safety: {
          ...safeInput().safety,
          accountIsLive: true,
          accountEnvironment: "LIVE"
        }
      })
    );
    expect(d.action).toBe("WAIT");
    expect(d.waitReason).toBe("FAST_AUTOTRADE_V1_DEMO_ONLY");
  });

  it("demo account + valid setup → may proceed", () => {
    const gate = evaluateFastAutoTradeDemoLock({
      strategyId: "FAST_AUTOTRADE_V1",
      accountIsLive: false,
      environment: "DEMO"
    });
    expect(gate.ok).toBe(true);
    const d = evaluateFastAutoTrade(safeInput());
    expect(d.action).toBe("BUY");
    expect(d.hardVeto).toBeNull();
  });
});
