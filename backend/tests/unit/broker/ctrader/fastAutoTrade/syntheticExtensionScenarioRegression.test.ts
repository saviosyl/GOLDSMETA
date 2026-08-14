/**
 * SYNTHETIC scenario validation for the setup-aware extension model.
 *
 * This is NOT a historical replay of the 17 production evaluations.
 * Preceding completed M1 bars for those rows could not be recovered
 * (broker token decrypt failed in this environment). Do not treat any
 * BUY result here as a claim about the real 17 production rows.
 *
 * Persisted production facts (autotradeEvaluationLog, Demo …w4C2,
 * 2026-08-14, reconstructed from Firestore only):
 *
 *  12:42:11 WAIT_EXTENDED  PULLBACK_CONTINUATION
 *  12:47:45 WAIT_EXTENDED  PULLBACK_CONTINUATION
 *  13:01:17 WAIT_NO_SETUP  (no setup)
 *  13:03:12 WAIT_NO_SETUP  (no setup)
 *  13:08:03 WAIT_STALE_PRICE  BREAKOUT (quoteAge 35s)
 *  13:18:02 WAIT_EXTENDED  BREAKOUT
 *  13:23:02 WAIT_EXTENDED  BREAKOUT
 *  13:23:05 WAIT_NO_SETUP  (no setup)
 *  13:28:14 WAIT_NO_SETUP  (no setup)
 *  13:29:08 WAIT_NO_SETUP  (no setup)
 *  13:30:17 WAIT_EXTENDED  BREAKOUT
 *  13:36:11 WAIT_EXTENDED  BREAKOUT
 *  13:42:10 WAIT_EXTENDED  BREAKOUT
 *  13:43:09 WAIT_EXTENDED  BREAKOUT
 *  13:43:16 WAIT_EXTENDED  BREAKOUT
 *  13:44:23 WAIT_EXTENDED  BREAKOUT
 *  13:45:17 WAIT_EXTENDED  PULLBACK_CONTINUATION
 *
 * VWAP/EMA/Decision ATR were null on the DecisionRecords. Latest M1 OHLC
 * is in candleKey only. Preceding M1 history was not persisted.
 */
import { afterEach, describe, expect, it } from "vitest";
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
  buildCompletedM1Series,
  productionLikeDecision
} from "./extensionTestSupport";

const safety = {
  accountIsLive: false,
  accountEnvironment: "DEMO" as const,
  spreadLimit: 2,
  maxQuoteAgeSeconds: 15
};

describe("FAST extension model — synthetic scenario validation", () => {
  afterEach(() => {
    useCompletedM1LoaderForTests(null);
  });

  it("does not claim to replay the 17 production evaluation rows", () => {
    expect(true).toBe(true);
  });

  it("synthetic BUY BREAKOUT just above broken VAH is not WAIT_EXTENDED", async () => {
    const nowMs = Date.parse("2026-08-14T16:00:00.000Z");
    const price = VAH + 0.03;
    useCompletedM1LoaderForTests(async () =>
      buildCompletedM1Series({
        nowMs,
        last: { open: price - 2.4, high: price + 0.4, low: price - 2.8, close: price }
      })
    );
    const input = await buildFastAutoTradeInput({
      uid: "uid-synth",
      decision: productionLikeDecision({ lastKnownPrice: price, entry: { price } }),
      nowMs,
      bid: price - 0.05,
      ask: price + 0.05,
      spread: 0.1,
      quoteAgeSeconds: 1,
      marketStatus: "OPEN",
      ...safety
    });
    const d = evaluateFastAutoTrade(input);
    expect(input.poc).toBe(POC);
    expect(d.waitReason).not.toBe("WAIT_EXTENDED");
    expect(d.extension.extensionAnchorType).toBe("BROKEN_VAH");
    expect(d.extension.extensionAtrSource).toBe("M1_ATR14");
    expect(d.extension.extensionLimitAtr).toBe(
      DEFAULT_FAST_AUTOTRADE_CONFIG.maximumExtensionAtr
    );
    expect(d.action).toBe("BUY");
  });

  it("synthetic BUY BREAKOUT ~1 local ATR above broken VAH is not WAIT_EXTENDED", async () => {
    const nowMs = Date.parse("2026-08-14T16:01:00.000Z");
    const price = VAH + TYPICAL_TR;
    useCompletedM1LoaderForTests(async () =>
      buildCompletedM1Series({
        nowMs,
        last: { open: price - 3.2, high: price + 0.6, low: price - 3.6, close: price }
      })
    );
    const input = await buildFastAutoTradeInput({
      uid: "uid-synth",
      decision: productionLikeDecision({ lastKnownPrice: price, entry: { price } }),
      nowMs,
      bid: price - 0.05,
      ask: price + 0.05,
      spread: 0.1,
      quoteAgeSeconds: 1,
      marketStatus: "OPEN",
      ...safety
    });
    const d = evaluateFastAutoTrade(input);
    expect(d.waitReason).not.toBe("WAIT_EXTENDED");
    expect(d.action).toBe("BUY");
    expect(d.extension.extensionDistanceAtr).toBeGreaterThan(0.6);
    expect(d.extension.extensionDistanceAtr).toBeLessThan(1.6);
  });

  it("synthetic chase ~13 points past broken VAH remains WAIT_EXTENDED", async () => {
    const nowMs = Date.parse("2026-08-14T16:02:00.000Z");
    const price = VAH + 13.19;
    useCompletedM1LoaderForTests(async () =>
      buildCompletedM1Series({
        nowMs,
        last: { open: price - 4.0, high: price + 0.8, low: price - 4.4, close: price }
      })
    );
    const input = await buildFastAutoTradeInput({
      uid: "uid-synth",
      decision: productionLikeDecision({ lastKnownPrice: price, entry: { price } }),
      nowMs,
      bid: price - 0.05,
      ask: price + 0.05,
      spread: 0.1,
      quoteAgeSeconds: 1,
      marketStatus: "OPEN",
      ...safety
    });
    const d = evaluateFastAutoTrade(input);
    expect(d.action).toBe("WAIT");
    expect(d.waitReason).toBe("WAIT_EXTENDED");
    expect(d.extension.extensionAnchorType).toBe("BROKEN_VAH");
    expect(d.extension.extensionDistanceAtr).toBeGreaterThan(2.2);
  });
});
