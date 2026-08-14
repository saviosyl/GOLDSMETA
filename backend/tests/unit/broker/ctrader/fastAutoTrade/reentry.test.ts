import { describe, expect, it } from "vitest";
import {
  DEFAULT_FAST_AUTOTRADE_CONFIG,
  evaluateFastAutoTrade,
  evaluateFastReentry,
  type FastAutoTradeInput,
  type FastSetupIdentity
} from "../../../../../src/services/broker/ctrader/fastAutoTrade";

const identity: FastSetupIdentity = {
  direction: "BUY",
  setupType: "PULLBACK_CONTINUATION",
  structureAnchor: "PULLBACK_CONTINUATION:BULLISH:3383.8",
  triggerCandle: "5:3385:3388.2:3384.6:3387.4",
  timestamp: "2026-08-14T09:00:00.000Z"
};

function input(over: Partial<FastAutoTradeInput> = {}): FastAutoTradeInput {
  return {
    nowMs: Date.parse("2026-08-14T09:02:00.000Z"),
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
    lifecycle: { state: "RESET", stateEnteredAtMs: Date.parse("2026-08-14T09:02:00.000Z") },
    ...over
  };
}

describe("FAST_AUTOTRADE_V1 re-entry", () => {
  it("same setup immediately → blocked", () => {
    const reason = evaluateFastReentry(
      input({
        nowMs: Date.parse("2026-08-14T09:01:00.000Z"),
        reentry: {
          lastSetup: identity,
          lastExitAtMs: Date.parse("2026-08-14T09:00:50.000Z"),
          lastSignalKey: null,
          currentCandleKey: null,
          lastAction: "BUY",
          lastActionAtMs: Date.parse("2026-08-14T09:00:50.000Z")
        }
      }),
      identity,
      DEFAULT_FAST_AUTOTRADE_CONFIG
    );
    expect(reason).toBe("WAIT_DUPLICATE_SETUP");
  });

  it("new independent setup → allowed", () => {
    const next: FastSetupIdentity = {
      direction: "BUY",
      setupType: "BREAKOUT_RETEST",
      structureAnchor: "BREAKOUT_RETEST:BULLISH:3388.5",
      triggerCandle: "5:3388:3390:3387:3389.2",
      timestamp: "2026-08-14T09:08:00.000Z"
    };
    const reason = evaluateFastReentry(
      input({
        nowMs: Date.parse("2026-08-14T09:08:00.000Z"),
        reentry: {
          lastSetup: identity,
          lastExitAtMs: Date.parse("2026-08-14T09:06:00.000Z"),
          lastSignalKey: null,
          currentCandleKey: null,
          lastAction: "BUY",
          lastActionAtMs: Date.parse("2026-08-14T09:06:00.000Z")
        }
      }),
      next,
      DEFAULT_FAST_AUTOTRADE_CONFIG
    );
    expect(reason).toBeNull();

    const d = evaluateFastAutoTrade(
      input({
        nowMs: Date.parse("2026-08-14T09:08:00.000Z"),
        confirmationClassification: "RETEST",
        confirmationDirection: "BULLISH",
        reentry: {
          lastSetup: identity,
          lastExitAtMs: Date.parse("2026-08-14T09:06:00.000Z"),
          lastSignalKey: null,
          currentCandleKey: null,
          lastAction: "BUY",
          lastActionAtMs: Date.parse("2026-08-14T09:06:00.000Z")
        }
      })
    );
    expect(d.action).toBe("BUY");
    expect(d.setupType).toBe("BREAKOUT_RETEST");
  });
});
