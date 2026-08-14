import { afterEach, describe, expect, it } from "vitest";
import type { DecisionRecord } from "../../../../../src/models/types";
import type { TrendbarCandle } from "../../../../../src/services/broker/ctrader/openApiClient";
import {
  buildFastAutoTradeInput,
  evaluateFastAutoTrade,
  useCompletedM1LoaderForTests
} from "../../../../../src/services/broker/ctrader/fastAutoTrade";
import {
  EXT_POC as POC,
  EXT_TYPICAL_TR as TYPICAL_TR,
  buildCompletedM1Series,
  productionLikeDecision
} from "./extensionTestSupport";

const safety = {
  accountIsLive: false,
  accountEnvironment: "DEMO" as const,
  spreadLimit: 2,
  maxQuoteAgeSeconds: 15
};

function buyBreakoutDecision(args: {
  price: number;
  vah: number;
  resistance: number;
  val?: number;
}): DecisionRecord {
  return productionLikeDecision({
    lastKnownPrice: args.price,
    entry: { price: args.price },
    marketStructure: {
      trend: "BULLISH",
      trendStrength: 62,
      poc: POC,
      vah: args.vah,
      val: args.val ?? 4342.6,
      confirmationClassification: "BREAKOUT",
      confirmationDirection: "BULLISH",
      confirmationCandleType: null,
      nearbyResistance: args.resistance,
      nearbySupport: args.val ?? 4342.6
    }
  });
}

function sellBreakoutDecision(args: {
  price: number;
  val: number;
  support: number;
  vah?: number;
}): DecisionRecord {
  return productionLikeDecision({
    decision: "SELL",
    marketRegime: "TRENDING_DOWN",
    higherTimeframeBias: "BEARISH",
    bullishEvidence: [],
    bearishEvidence: ["breakout", "impulse"],
    lastKnownPrice: args.price,
    entry: { price: args.price },
    marketStructure: {
      trend: "BEARISH",
      trendStrength: 62,
      poc: 4388.0,
      vah: args.vah ?? 4395.0,
      val: args.val,
      confirmationClassification: "BREAKOUT",
      confirmationDirection: "BEARISH",
      confirmationCandleType: null,
      nearbyResistance: args.vah ?? 4395.0,
      nearbySupport: args.support
    }
  });
}

async function evaluatePath(args: {
  nowMs: number;
  decision: DecisionRecord;
  bars: TrendbarCandle[];
  bid: number;
  ask: number;
}) {
  useCompletedM1LoaderForTests(async () => args.bars);
  const input = await buildFastAutoTradeInput({
    uid: "uid-nearest-anchor",
    decision: args.decision,
    nowMs: args.nowMs,
    bid: args.bid,
    ask: args.ask,
    spread: args.ask - args.bid,
    quoteAgeSeconds: 1,
    quoteStale: false,
    marketStatus: "OPEN",
    ...safety
  });
  return { input, decision: evaluateFastAutoTrade(input) };
}

describe("FAST BREAKOUT nearest broken-structure extension anchor", () => {
  afterEach(() => {
    useCompletedM1LoaderForTests(null);
  });

  it("1. BUY old resistance far below + VAH close → BROKEN_VAH", async () => {
    const nowMs = Date.parse("2026-08-14T13:00:00.000Z");
    const price = 4380;
    const resistance = 4365;
    const vah = 4379;
    const { input, decision } = await evaluatePath({
      nowMs,
      decision: buyBreakoutDecision({ price, vah, resistance }),
      bars: buildCompletedM1Series({
        nowMs,
        last: { open: price - 2.4, high: price + 0.4, low: price - 2.8, close: price }
      }),
      bid: price - 0.05,
      ask: price + 0.05
    });

    expect(input.nearbyResistance).toBe(resistance);
    expect(input.vah).toBe(vah);
    expect(decision.setupType).toBe("BREAKOUT");
    expect(decision.extension.extensionAnchorType).toBe("BROKEN_VAH");
    expect(decision.extension.extensionAnchorPrice).toBe(4379);
    expect(decision.extension.extensionDistance).toBeCloseTo(1, 8);
  });

  it("2. BUY resistance closer than VAH → BROKEN_RESISTANCE", async () => {
    const nowMs = Date.parse("2026-08-14T13:01:00.000Z");
    const price = 4380;
    const resistance = 4379.5;
    const vah = 4377;
    const { input, decision } = await evaluatePath({
      nowMs,
      decision: buyBreakoutDecision({ price, vah, resistance }),
      bars: buildCompletedM1Series({
        nowMs,
        last: { open: price - 2.4, high: price + 0.4, low: price - 2.8, close: price }
      }),
      bid: price - 0.05,
      ask: price + 0.05
    });

    expect(input.nearbyResistance).toBe(resistance);
    expect(input.vah).toBe(vah);
    expect(decision.extension.extensionAnchorType).toBe("BROKEN_RESISTANCE");
    expect(decision.extension.extensionAnchorPrice).toBe(4379.5);
    expect(decision.extension.extensionDistance).toBeCloseTo(0.5, 8);
  });

  it("3. SELL mirror — nearest broken support/VAL above price", async () => {
    const nowMs = Date.parse("2026-08-14T13:02:00.000Z");

    const farSupport = await evaluatePath({
      nowMs,
      decision: sellBreakoutDecision({ price: 4360, val: 4361, support: 4380 }),
      bars: buildCompletedM1Series({
        nowMs,
        last: { open: 4362.2, high: 4362.6, low: 4359.8, close: 4360 }
      }),
      bid: 4359.95,
      ask: 4360.05
    });
    expect(farSupport.input.nearbySupport).toBe(4380);
    expect(farSupport.input.val).toBe(4361);
    expect(farSupport.decision.extension.extensionAnchorType).toBe("BROKEN_VAL");
    expect(farSupport.decision.extension.extensionAnchorPrice).toBe(4361);

    const closerSupport = await evaluatePath({
      nowMs: nowMs + 60_000,
      decision: sellBreakoutDecision({ price: 4360, val: 4365, support: 4360.5 }),
      bars: buildCompletedM1Series({
        nowMs: nowMs + 60_000,
        last: { open: 4362.2, high: 4362.6, low: 4359.8, close: 4360 }
      }),
      bid: 4359.95,
      ask: 4360.05
    });
    expect(closerSupport.input.nearbySupport).toBe(4360.5);
    expect(closerSupport.input.val).toBe(4365);
    expect(closerSupport.decision.extension.extensionAnchorType).toBe("BROKEN_SUPPORT");
    expect(closerSupport.decision.extension.extensionAnchorPrice).toBe(4360.5);
  });

  it("4. old distant level must not falsely trigger WAIT_EXTENDED", async () => {
    const nowMs = Date.parse("2026-08-14T13:03:00.000Z");
    const price = 4380;
    const resistance = 4365;
    const vah = 4379;
    const { decision } = await evaluatePath({
      nowMs,
      decision: buyBreakoutDecision({ price, vah, resistance }),
      bars: buildCompletedM1Series({
        nowMs,
        typicalTr: TYPICAL_TR,
        last: { open: price - 2.4, high: price + 0.4, low: price - 2.8, close: price }
      }),
      bid: price - 0.05,
      ask: price + 0.05
    });

    const ifUsedDistantResistance = (price - resistance) / TYPICAL_TR;
    expect(ifUsedDistantResistance).toBeGreaterThan(2.2);
    expect(decision.extension.extensionAnchorType).toBe("BROKEN_VAH");
    expect(decision.extension.extensionAnchorPrice).toBe(vah);
    expect(decision.extension.extensionDistanceAtr).toBeLessThan(2.2);
    expect(decision.extended).toBe(false);
    expect(decision.waitReason).not.toBe("WAIT_EXTENDED");
    expect(decision.action).toBe("BUY");
  });

  it("5. genuinely >2.2 rolling ATR beyond nearest structure still WAIT_EXTENDED", async () => {
    const nowMs = Date.parse("2026-08-14T13:04:00.000Z");
    const price = 4380;
    const resistance = 4360;
    const vah = 4365;
    const { decision } = await evaluatePath({
      nowMs,
      decision: buyBreakoutDecision({ price, vah, resistance }),
      bars: buildCompletedM1Series({
        nowMs,
        typicalTr: TYPICAL_TR,
        last: { open: price - 4.0, high: price + 0.8, low: price - 4.4, close: price }
      }),
      bid: price - 0.05,
      ask: price + 0.05
    });

    expect(decision.extension.extensionAnchorType).toBe("BROKEN_VAH");
    expect(decision.extension.extensionAnchorPrice).toBe(vah);
    expect(decision.extension.extensionDistance).toBeCloseTo(15, 8);
    expect(decision.extension.extensionAtrSource).toBe("M1_ATR14");
    expect(decision.extension.extensionDistanceAtr).toBeGreaterThan(2.2);
    expect(decision.extension.extensionLimitAtr).toBe(2.2);
    expect(decision.action).toBe("WAIT");
    expect(decision.waitReason).toBe("WAIT_EXTENDED");
    expect(decision.extended).toBe(true);
  });
});
