/**
 * Offline replay of the 17 captured FAST Demo evaluations
 * (2026-08-14 ~12:42–13:45 UTC, qualified Demo …w4C2).
 *
 * Production facts reconstructed into DecisionRecord + completed M1 bars:
 *   17 WAIT, 11 WAIT_EXTENDED (8 BREAKOUT), tradeSpaceOk=true,
 *   VWAP=null, EMA21=null, Decision ATR=null, anchor=15m POC 4349.022,
 *   ATR fallback = current M1 high-low.
 *
 * Does not send orders. NEW path is the live engine. OLD is the captured
 * production classification (POC vs one-bar range), not a re-tuned guess.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { DecisionRecord } from "../../../../../src/models/types";
import {
  buildFastAutoTradeInput,
  evaluateFastAutoTrade,
  scoreFastQuality,
  useCompletedM1LoaderForTests,
  classifyFastRegime,
  determineFastBias,
  detectFastSetup,
  detectFastTrigger,
  estimateAtr,
  tradeSpaceOk,
  DEFAULT_FAST_AUTOTRADE_CONFIG
} from "../../../../../src/services/broker/ctrader/fastAutoTrade";
import { buildCompletedM1Series, productionLikeDecision } from "./extensionTestSupport";

const POC = 4349.022;
const VAL = 4342.6;
const EARLY_VAH = 4356.047;
const LATE_VAH = 4374.4;

type CapturedRow = {
  id: number;
  timestamp: string;
  setup: "BREAKOUT" | "PULLBACK_CONTINUATION" | null;
  oldAction: "WAIT";
  oldWaitReason: "WAIT_EXTENDED" | "WAIT_NO_SETUP" | "WAIT_STALE_PRICE";
  price: number;
  vah: number;
  last: { open: number; high: number; low: number; close: number };
  classification: "BREAKOUT" | "CONTINUATION" | "NONE";
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  v3: "BUY" | "WAIT";
  quoteStale?: boolean;
  quoteAgeSeconds?: number;
};

/**
 * 17 distinct completed-M1 evaluations. #1/#2 are the ~13-point VAH chases.
 * #3–#10 are healthy BREAKOUTs 0.03–3.45 above broken VAH.
 * #11 is price still below VAH (POC-only extension in production).
 * #12–#16 WAIT_NO_SETUP. #17 WAIT_STALE_PRICE.
 */
const CAPTURED: CapturedRow[] = [
  {
    id: 1,
    timestamp: "2026-08-14T12:42:00.000Z",
    setup: "BREAKOUT",
    oldAction: "WAIT",
    oldWaitReason: "WAIT_EXTENDED",
    price: EARLY_VAH + 13.19,
    vah: EARLY_VAH,
    last: { open: 4365.2, high: 4370.1, low: 4364.4, close: EARLY_VAH + 13.19 },
    classification: "BREAKOUT",
    direction: "BULLISH",
    v3: "BUY"
  },
  {
    id: 2,
    timestamp: "2026-08-14T12:43:00.000Z",
    setup: "BREAKOUT",
    oldAction: "WAIT",
    oldWaitReason: "WAIT_EXTENDED",
    price: EARLY_VAH + 12.96,
    vah: EARLY_VAH,
    last: { open: 4366.0, high: 4369.8, low: 4365.1, close: EARLY_VAH + 12.96 },
    classification: "BREAKOUT",
    direction: "BULLISH",
    v3: "BUY"
  },
  {
    id: 3,
    timestamp: "2026-08-14T12:51:00.000Z",
    setup: "BREAKOUT",
    oldAction: "WAIT",
    oldWaitReason: "WAIT_EXTENDED",
    price: LATE_VAH + 0.03,
    vah: LATE_VAH,
    last: { open: 4372.1, high: 4374.7, low: 4371.6, close: LATE_VAH + 0.03 },
    classification: "BREAKOUT",
    direction: "BULLISH",
    v3: "BUY"
  },
  {
    id: 4,
    timestamp: "2026-08-14T12:54:00.000Z",
    setup: "BREAKOUT",
    oldAction: "WAIT",
    oldWaitReason: "WAIT_EXTENDED",
    price: LATE_VAH + 0.41,
    vah: LATE_VAH,
    last: { open: 4373.2, high: 4375.1, low: 4372.8, close: LATE_VAH + 0.41 },
    classification: "BREAKOUT",
    direction: "BULLISH",
    v3: "BUY"
  },
  {
    id: 5,
    timestamp: "2026-08-14T12:57:00.000Z",
    setup: "BREAKOUT",
    oldAction: "WAIT",
    oldWaitReason: "WAIT_EXTENDED",
    price: LATE_VAH + 0.88,
    vah: LATE_VAH,
    last: { open: 4373.6, high: 4375.6, low: 4373.1, close: LATE_VAH + 0.88 },
    classification: "BREAKOUT",
    direction: "BULLISH",
    v3: "BUY"
  },
  {
    id: 6,
    timestamp: "2026-08-14T13:03:00.000Z",
    setup: "BREAKOUT",
    oldAction: "WAIT",
    oldWaitReason: "WAIT_EXTENDED",
    price: LATE_VAH + 1.35,
    vah: LATE_VAH,
    last: { open: 4374.0, high: 4376.2, low: 4373.4, close: LATE_VAH + 1.35 },
    classification: "BREAKOUT",
    direction: "BULLISH",
    v3: "BUY"
  },
  {
    id: 7,
    timestamp: "2026-08-14T13:09:00.000Z",
    setup: "BREAKOUT",
    oldAction: "WAIT",
    oldWaitReason: "WAIT_EXTENDED",
    price: LATE_VAH + 1.92,
    vah: LATE_VAH,
    last: { open: 4374.2, high: 4376.8, low: 4373.8, close: LATE_VAH + 1.92 },
    classification: "BREAKOUT",
    direction: "BULLISH",
    v3: "BUY"
  },
  {
    id: 8,
    timestamp: "2026-08-14T13:15:00.000Z",
    setup: "BREAKOUT",
    oldAction: "WAIT",
    oldWaitReason: "WAIT_EXTENDED",
    price: LATE_VAH + 2.48,
    vah: LATE_VAH,
    last: { open: 4375.0, high: 4377.3, low: 4374.6, close: LATE_VAH + 2.48 },
    classification: "BREAKOUT",
    direction: "BULLISH",
    v3: "BUY"
  },
  {
    id: 9,
    timestamp: "2026-08-14T13:21:00.000Z",
    setup: "BREAKOUT",
    oldAction: "WAIT",
    oldWaitReason: "WAIT_EXTENDED",
    price: LATE_VAH + 2.97,
    vah: LATE_VAH,
    last: { open: 4375.4, high: 4377.8, low: 4374.9, close: LATE_VAH + 2.97 },
    classification: "BREAKOUT",
    direction: "BULLISH",
    v3: "BUY"
  },
  {
    id: 10,
    timestamp: "2026-08-14T13:27:00.000Z",
    setup: "BREAKOUT",
    oldAction: "WAIT",
    oldWaitReason: "WAIT_EXTENDED",
    price: LATE_VAH + 3.45,
    vah: LATE_VAH,
    last: { open: 4375.8, high: 4378.2, low: 4375.1, close: LATE_VAH + 3.45 },
    classification: "BREAKOUT",
    direction: "BULLISH",
    v3: "BUY"
  },
  {
    id: 11,
    timestamp: "2026-08-14T13:33:00.000Z",
    setup: "BREAKOUT",
    oldAction: "WAIT",
    oldWaitReason: "WAIT_EXTENDED",
    price: LATE_VAH - 0.81,
    vah: LATE_VAH,
    last: { open: 4372.4, high: 4374.1, low: 4371.8, close: LATE_VAH - 0.81 },
    classification: "BREAKOUT",
    direction: "BULLISH",
    v3: "BUY"
  },
  {
    id: 12,
    timestamp: "2026-08-14T13:36:00.000Z",
    setup: null,
    oldAction: "WAIT",
    oldWaitReason: "WAIT_NO_SETUP",
    price: 4368.2,
    vah: LATE_VAH,
    last: { open: 4368.6, high: 4369.0, low: 4367.8, close: 4368.2 },
    classification: "NONE",
    direction: "BULLISH",
    v3: "WAIT"
  },
  {
    id: 13,
    timestamp: "2026-08-14T13:37:00.000Z",
    setup: null,
    oldAction: "WAIT",
    oldWaitReason: "WAIT_NO_SETUP",
    price: 4367.9,
    vah: LATE_VAH,
    last: { open: 4368.2, high: 4368.5, low: 4367.4, close: 4367.9 },
    classification: "NONE",
    direction: "BULLISH",
    v3: "WAIT"
  },
  {
    id: 14,
    timestamp: "2026-08-14T13:39:00.000Z",
    setup: null,
    oldAction: "WAIT",
    oldWaitReason: "WAIT_NO_SETUP",
    price: 4368.8,
    vah: LATE_VAH,
    last: { open: 4368.1, high: 4369.0, low: 4367.7, close: 4368.8 },
    classification: "NONE",
    direction: "BULLISH",
    v3: "WAIT"
  },
  {
    id: 15,
    timestamp: "2026-08-14T13:41:00.000Z",
    setup: null,
    oldAction: "WAIT",
    oldWaitReason: "WAIT_NO_SETUP",
    price: 4367.4,
    vah: LATE_VAH,
    last: { open: 4367.8, high: 4368.1, low: 4366.9, close: 4367.4 },
    classification: "NONE",
    direction: "BULLISH",
    v3: "WAIT"
  },
  {
    id: 16,
    timestamp: "2026-08-14T13:43:00.000Z",
    setup: null,
    oldAction: "WAIT",
    oldWaitReason: "WAIT_NO_SETUP",
    price: 4368.4,
    vah: LATE_VAH,
    last: { open: 4368.9, high: 4369.1, low: 4367.9, close: 4368.4 },
    classification: "NONE",
    direction: "BULLISH",
    v3: "WAIT"
  },
  {
    id: 17,
    timestamp: "2026-08-14T13:45:00.000Z",
    setup: "BREAKOUT",
    oldAction: "WAIT",
    oldWaitReason: "WAIT_STALE_PRICE",
    price: LATE_VAH + 1.1,
    vah: LATE_VAH,
    last: { open: 4374.2, high: 4376.0, low: 4373.8, close: LATE_VAH + 1.1 },
    classification: "BREAKOUT",
    direction: "BULLISH",
    v3: "BUY",
    quoteStale: true,
    quoteAgeSeconds: 40
  }
];

function decisionFor(row: CapturedRow): DecisionRecord {
  const bullish = row.direction === "BULLISH";
  return productionLikeDecision({
    decisionId: `dec_replay_${row.id}`,
    generatedAt: row.timestamp,
    lastKnownPrice: row.price,
    entry: { price: row.price },
    decision: row.v3,
    higherTimeframeBias: bullish ? "BULLISH" : row.direction === "BEARISH" ? "BEARISH" : "NEUTRAL",
    marketRegime: bullish ? "TRENDING_UP" : "RANGING",
    bullishEvidence: bullish ? ["breakout", "impulse"] : [],
    bearishEvidence: [],
    marketStructure: {
      trend: bullish ? "BULLISH" : "NEUTRAL",
      trendStrength: row.v3 === "WAIT" && row.classification === "NONE" ? 38 : bullish ? 62 : 28,
      poc: POC,
      vah: row.vah,
      val: VAL,
      confirmationClassification: row.classification,
      confirmationDirection: row.direction,
      confirmationCandleType: null,
      nearbyResistance: row.vah,
      nearbySupport: VAL
    }
  });
}

function legacyExtension(price: number, last: CapturedRow["last"]): {
  anchorType: "POC";
  anchorPrice: number;
  atrSource: "M1_CURRENT_RANGE";
  atr: number;
  distance: number;
  distanceAtr: number;
  extended: boolean;
} {
  const atr = last.high - last.low;
  const distance = price - POC;
  return {
    anchorType: "POC",
    anchorPrice: POC,
    atrSource: "M1_CURRENT_RANGE",
    atr,
    distance,
    distanceAtr: atr > 0 ? distance / atr : Number.POSITIVE_INFINITY,
    extended: atr > 0 && distance > atr * 2.2
  };
}

function legacyScore(input: Awaited<ReturnType<typeof buildFastAutoTradeInput>>): number {
  const config = DEFAULT_FAST_AUTOTRADE_CONFIG;
  const regime = classifyFastRegime(input, config);
  const bias = determineFastBias(input);
  const setup = detectFastSetup(input, bias, regime, config);
  const trig = detectFastTrigger(input, bias);
  const atr = estimateAtr(input, config);
  const intended = bias === "BULLISH" ? "BUY" : bias === "BEARISH" ? "SELL" : "WAIT";
  const spaceOk =
    intended === "WAIT" ? false : tradeSpaceOk(input, intended, atr, config);
  const old = legacyExtension(input.price, {
    open: input.ohlcv?.open ?? input.price,
    high: input.ohlcv?.high ?? input.price,
    low: input.ohlcv?.low ?? input.price,
    close: input.ohlcv?.close ?? input.price
  });
  return scoreFastQuality({
    input,
    regime,
    bias,
    setupType: setup.setupType,
    trigger: trig.trigger,
    tradeSpaceOk: spaceOk,
    extended: old.extended,
    config
  }).score;
}

describe("FAST extension model — 17-row production replay (offline, no orders)", () => {
  afterEach(() => {
    useCompletedM1LoaderForTests(null);
  });

  it("compares captured OLD decisions to the corrected NEW engine", async () => {
    const rows: Array<{
      id: number;
      timestamp: string;
      setup: string | null;
      oldAnchor: string;
      newAnchor: string;
      oldAtrSource: string;
      newAtrSource: string;
      oldDistAtr: number;
      newDistAtr: number | null;
      oldScore: number;
      newScore: number;
      oldAction: string;
      newAction: string;
      oldWait: string;
      newWait: string | null;
    }> = [];

    for (const captured of CAPTURED) {
      const nowMs = Date.parse(captured.timestamp);
      useCompletedM1LoaderForTests(async () =>
        buildCompletedM1Series({ nowMs, last: captured.last, typicalTr: 5.2 })
      );
      const input = await buildFastAutoTradeInput({
        uid: "uid-replay",
        decision: decisionFor(captured),
        nowMs,
        bid: captured.price - 0.06,
        ask: captured.price + 0.06,
        spread: 0.12,
        quoteAgeSeconds: captured.quoteAgeSeconds ?? 1,
        quoteStale: Boolean(captured.quoteStale),
        marketStatus: "OPEN",
        accountIsLive: false,
        accountEnvironment: "DEMO",
        spreadLimit: 2,
        maxQuoteAgeSeconds: 15
      });
      const fresh = evaluateFastAutoTrade(input);
      const oldExt = legacyExtension(captured.price, captured.last);
      rows.push({
        id: captured.id,
        timestamp: captured.timestamp,
        setup: fresh.setupType,
        oldAnchor: oldExt.anchorType,
        newAnchor: fresh.extension.extensionAnchorType,
        oldAtrSource: oldExt.atrSource,
        newAtrSource: fresh.extension.extensionAtrSource,
        oldDistAtr: oldExt.distanceAtr,
        newDistAtr: fresh.extension.extensionDistanceAtr,
        oldScore: legacyScore(input),
        newScore: fresh.qualityScore,
        oldAction: captured.oldAction,
        newAction: fresh.action,
        oldWait: captured.oldWaitReason,
        newWait: fresh.waitReason
      });
    }

    const oldWait = rows.filter((r) => r.oldAction === "WAIT").length;
    const oldBuy = rows.filter((r) => r.oldAction === "BUY").length;
    const oldSell = rows.filter((r) => r.oldAction === "SELL").length;
    const oldExtended = rows.filter((r) => r.oldWait === "WAIT_EXTENDED").length;
    const newWait = rows.filter((r) => r.newAction === "WAIT").length;
    const newBuy = rows.filter((r) => r.newAction === "BUY").length;
    const newSell = rows.filter((r) => r.newAction === "SELL").length;
    const newExtended = rows.filter((r) => r.newWait === "WAIT_EXTENDED").length;
    const changed = rows.filter(
      (r) => r.oldAction !== r.newAction || r.oldWait !== (r.newWait ?? "")
    );

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          OLD: { BUY: oldBuy, SELL: oldSell, WAIT: oldWait, WAIT_EXTENDED: oldExtended },
          NEW: { BUY: newBuy, SELL: newSell, WAIT: newWait, WAIT_EXTENDED: newExtended },
          changed
        },
        null,
        2
      )
    );

    expect(oldWait).toBe(17);
    expect(oldBuy).toBe(0);
    expect(oldSell).toBe(0);
    expect(oldExtended).toBe(11);

    expect(rows[0]!.newWait).toBe("WAIT_EXTENDED");
    expect(rows[1]!.newWait).toBe("WAIT_EXTENDED");
    expect(rows[0]!.newAnchor).toBe("BROKEN_VAH");
    expect(rows[1]!.newAnchor).toBe("BROKEN_VAH");

    const healthy = rows.filter((r) => r.id >= 3 && r.id <= 10);
    for (const row of healthy) {
      expect(row.newWait).not.toBe("WAIT_EXTENDED");
      expect(row.oldAnchor).toBe("POC");
      expect(row.newAnchor).toBe("BROKEN_VAH");
      expect(row.oldAtrSource).toBe("M1_CURRENT_RANGE");
      expect(row.newAtrSource).toBe("M1_ATR14");
      if (row.newAction === "BUY") {
        expect(row.newWait).toBeNull();
      }
    }
    expect(healthy.some((r) => r.newAction === "BUY")).toBe(true);

    const buyClaims = rows.filter((r) => r.newAction === "BUY");
    for (const row of buyClaims) {
      expect(row.newWait).toBeNull();
      expect(row.newWait).not.toBe("WAIT_EXTENDED");
    }

    expect(newExtended).toBeLessThan(oldExtended);
    expect(newExtended).toBeGreaterThanOrEqual(2);
    expect(changed.length).toBeGreaterThan(0);
    for (const row of changed) {
      expect(typeof row.timestamp).toBe("string");
      expect(row).toHaveProperty("setup");
      expect(typeof row.oldAnchor).toBe("string");
      expect(typeof row.newAnchor).toBe("string");
      expect(typeof row.oldAtrSource).toBe("string");
      expect(typeof row.newAtrSource).toBe("string");
      expect(typeof row.oldDistAtr).toBe("number");
      expect(typeof row.oldScore).toBe("number");
      expect(typeof row.newScore).toBe("number");
      expect(typeof row.oldAction).toBe("string");
      expect(typeof row.newAction).toBe("string");
    }
  });
});
