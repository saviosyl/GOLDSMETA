import { afterEach, describe, expect, it } from "vitest";
import type { DecisionRecord } from "../../../../../src/models/types";
import type { TrendbarCandle } from "../../../../../src/services/broker/ctrader/openApiClient";
import {
  DEFAULT_FAST_AUTOTRADE_CONFIG,
  buildFastAutoTradeInput,
  completedBarTrueRange,
  contiguousExtensionTrueRanges,
  estimateExtensionAtr,
  evaluateFastAutoTrade,
  isConsecutiveCompletedM1,
  useCompletedM1LoaderForTests
} from "../../../../../src/services/broker/ctrader/fastAutoTrade";
import type { FastOhlc } from "../../../../../src/services/broker/ctrader/fastAutoTrade/types";
import {
  EXT_TYPICAL_TR as TYPICAL_TR,
  EXT_VAH as VAH,
  buildCompletedM1Series,
  buildSessionGapM1Series,
  productionLikeDecision
} from "./extensionTestSupport";

const safety = {
  accountIsLive: false,
  accountEnvironment: "DEMO" as const,
  spreadLimit: 2,
  maxQuoteAgeSeconds: 15
};

/** Friday last completed M1 open (bar completes 21:00 UTC). */
const FRIDAY_LAST_TIME = Math.floor(Date.parse("2026-08-14T20:59:00.000Z") / 1000);
/** Sunday evaluation: last completed M1 open 22:04, now 22:06. */
const SUNDAY_NOW_MS = Date.parse("2026-08-16T22:06:00.000Z");
const SUNDAY_LAST_TIME = Math.floor(SUNDAY_NOW_MS / 1000) - 90;
/** Weekday broker-maintenance style gap (Tue 21:00 → Wed 00:08). */
const TUESDAY_LAST_TIME = Math.floor(Date.parse("2026-08-11T21:00:00.000Z") / 1000);
const WEDNESDAY_NOW_MS = Date.parse("2026-08-12T00:10:00.000Z");
const WEDNESDAY_LAST_TIME = Math.floor(WEDNESDAY_NOW_MS / 1000) - 90;

const WEEKEND_PRICE_GAP = 80;

async function evaluatePath(args: {
  nowMs: number;
  decision: DecisionRecord;
  bars: TrendbarCandle[];
  bid: number;
  ask: number;
}) {
  useCompletedM1LoaderForTests(async () => args.bars);
  const input = await buildFastAutoTradeInput({
    uid: "uid-session-gap",
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

function naiveAllPairTrs(history: FastOhlc[]): number[] {
  const trs: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const prevClose = history[i - 1]!.close;
    if (typeof prevClose !== "number") continue;
    const tr = completedBarTrueRange(history[i]!, prevClose);
    if (tr != null && tr > 0) trs.push(tr);
  }
  return trs;
}

function gapAwareBars(args: {
  sundayCount: number;
  price: number;
  fridayCount?: number;
  fridayTypicalTr?: number;
  sundayTypicalTr?: number;
}): TrendbarCandle[] {
  const sundayTypicalTr = args.sundayTypicalTr ?? TYPICAL_TR;
  const firstSundayOpen =
    args.price - sundayTypicalTr * (args.sundayCount - 1) * 0.15;
  const fridayClose = firstSundayOpen - WEEKEND_PRICE_GAP;
  return buildSessionGapM1Series({
    fridayLastTime: FRIDAY_LAST_TIME,
    sundayLastTime: SUNDAY_LAST_TIME,
    fridayCount: args.fridayCount ?? 10,
    sundayCount: args.sundayCount,
    fridayLast: {
      open: fridayClose - 2,
      high: fridayClose + 1.5,
      low: fridayClose - 3,
      close: fridayClose
    },
    sundayLast: {
      open: args.price - 3.2,
      high: args.price + 0.6,
      low: args.price - 3.6,
      close: args.price
    },
    fridayTypicalTr: args.fridayTypicalTr ?? TYPICAL_TR,
    sundayTypicalTr
  });
}

describe("FAST extension ATR session-gap safety", () => {
  afterEach(() => {
    useCompletedM1LoaderForTests(null);
  });

  it("consecutive M1 spacing is ~60s with a small feed-timing tolerance", () => {
    const previous: FastOhlc = {
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 1,
      time: 1_000_000
    };
    const at = (delta: number): FastOhlc => ({ ...previous, time: 1_000_000 + delta });
    expect(isConsecutiveCompletedM1(at(60), previous)).toBe(true);
    expect(isConsecutiveCompletedM1(at(70), previous)).toBe(true);
    expect(isConsecutiveCompletedM1(at(45), previous)).toBe(true);
    expect(isConsecutiveCompletedM1(at(44), previous)).toBe(false);
    expect(isConsecutiveCompletedM1(at(76), previous)).toBe(false);
    expect(isConsecutiveCompletedM1(at(3600), previous)).toBe(false);
    expect(
      isConsecutiveCompletedM1({ ...at(60), time: null }, previous)
    ).toBe(false);
    expect(
      isConsecutiveCompletedM1(at(60), { ...previous, time: undefined })
    ).toBe(false);
  });

  it("1. 20 normal consecutive M1 bars → M1_ATR14 unchanged", async () => {
    const nowMs = Date.parse("2026-08-14T12:43:00.000Z");
    const price = VAH + 0.03;
    const bars = buildCompletedM1Series({
      nowMs,
      last: { open: price - 2.4, high: price + 0.4, low: price - 2.8, close: price }
    });
    expect(bars).toHaveLength(20);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i]!.time - bars[i - 1]!.time).toBe(60);
    }

    const { input, decision } = await evaluatePath({
      nowMs,
      decision: productionLikeDecision({ lastKnownPrice: price, entry: { price } }),
      bars,
      bid: price - 0.05,
      ask: price + 0.05
    });

    expect(input.m1History?.every((b) => typeof b.time === "number")).toBe(true);
    const naive = naiveAllPairTrs(input.m1History ?? []);
    expect(naive.length).toBeGreaterThanOrEqual(14);
    const expectedAtr =
      naive.slice(-14).reduce((s, v) => s + v, 0) / 14;
    const atr = estimateExtensionAtr(input);
    expect(atr.source).toBe("M1_ATR14");
    expect(atr.atr).toBeCloseTo(expectedAtr, 10);
    expect(contiguousExtensionTrueRanges(input.m1History ?? [])).toEqual(naive);
    expect(decision.extension.extensionAtrSource).toBe("M1_ATR14");
    expect(decision.extension.extensionAtr).toBeCloseTo(expectedAtr, 10);
    expect(decision.extension.extensionLimitAtr).toBe(
      DEFAULT_FAST_AUTOTRADE_CONFIG.maximumExtensionAtr
    );
    expect(decision.waitReason).not.toBe("WAIT_EXTENSION_VOLATILITY_UNAVAILABLE");
  });

  it("2. Friday close → weekend timestamp gap → Sunday reopen TR is not an M1 TR", async () => {
    const price = VAH + 0.8;
    const bars = gapAwareBars({ sundayCount: 1, price, fridayCount: 12 });
    const friday = bars[bars.length - 2]!;
    const sunday = bars[bars.length - 1]!;
    expect(sunday.time - friday.time).toBeGreaterThan(48 * 3600);
    const gapTr = completedBarTrueRange(sunday, friday.close);
    expect(gapTr).toBeGreaterThan(WEEKEND_PRICE_GAP - 5);

    const { input, decision } = await evaluatePath({
      nowMs: SUNDAY_NOW_MS,
      decision: productionLikeDecision({ lastKnownPrice: price, entry: { price } }),
      bars,
      bid: price - 0.05,
      ask: price + 0.05
    });

    const contiguous = contiguousExtensionTrueRanges(input.m1History ?? []);
    expect(contiguous.every((tr) => tr < WEEKEND_PRICE_GAP / 2)).toBe(true);
    expect(contiguous).not.toContain(gapTr);
    const naive = naiveAllPairTrs(input.m1History ?? []);
    expect(naive.some((tr) => tr > WEEKEND_PRICE_GAP - 5)).toBe(true);
    expect(estimateExtensionAtr(input)).toEqual({ atr: null, source: "NONE" });
    expect(decision.action).toBe("WAIT");
    expect(decision.waitReason).toBe("WAIT_EXTENSION_VOLATILITY_UNAVAILABLE");
    expect(decision.extension.extensionAtrSource).toBe("NONE");
  });

  it("2b. weekday broker-maintenance gap also resets the rolling TR sequence", async () => {
    const price = VAH + 0.8;
    const firstWedOpen = price;
    const tuesdayClose = firstWedOpen - 40;
    const bars = buildSessionGapM1Series({
      fridayLastTime: TUESDAY_LAST_TIME,
      sundayLastTime: WEDNESDAY_LAST_TIME,
      fridayCount: 8,
      sundayCount: 3,
      fridayLast: {
        open: tuesdayClose - 2,
        high: tuesdayClose + 1,
        low: tuesdayClose - 2.5,
        close: tuesdayClose
      },
      sundayLast: {
        open: price - 1.2,
        high: price + 0.4,
        low: price - 1.6,
        close: price
      }
    });
    const preBreak = bars[bars.length - 4]!;
    const reopen = bars[bars.length - 3]!;
    expect(reopen.time - preBreak.time).toBeGreaterThan(2 * 3600);
    expect(reopen.time - preBreak.time).toBeLessThan(6 * 3600);

    const { input, decision } = await evaluatePath({
      nowMs: WEDNESDAY_NOW_MS,
      decision: productionLikeDecision({ lastKnownPrice: price, entry: { price } }),
      bars,
      bid: price - 0.05,
      ask: price + 0.05
    });

    const contiguous = contiguousExtensionTrueRanges(input.m1History ?? []);
    expect(contiguous.length).toBeLessThan(5);
    expect(contiguous.every((tr) => tr < 20)).toBe(true);
    expect(estimateExtensionAtr(input).source).toBe("NONE");
    expect(decision.waitReason).toBe("WAIT_EXTENSION_VOLATILITY_UNAVAILABLE");
  });

  it("3. 1–4 contiguous bars after session reopen → WAIT_EXTENSION_VOLATILITY_UNAVAILABLE", async () => {
    const price = VAH + 0.8;
    for (const sundayCount of [1, 2, 3, 4, 5]) {
      const { input, decision } = await evaluatePath({
        nowMs: SUNDAY_NOW_MS,
        decision: productionLikeDecision({ lastKnownPrice: price, entry: { price } }),
        bars: gapAwareBars({ sundayCount, price }),
        bid: price - 0.05,
        ask: price + 0.05
      });
      const trs = contiguousExtensionTrueRanges(input.m1History ?? []);
      expect(trs.length).toBe(Math.max(0, sundayCount - 1));
      expect(trs.length).toBeLessThan(5);
      expect(estimateExtensionAtr(input).source).toBe("NONE");
      expect(decision.action).toBe("WAIT");
      expect(decision.waitReason).toBe("WAIT_EXTENSION_VOLATILITY_UNAVAILABLE");
    }
  });

  it("4. five contiguous post-reopen TRs → M1_ROLLING_TR", async () => {
    const price = VAH + 0.8;
    // 5 TRs require 6 completed post-gap M1s (first reopen bar has no
    // consecutive previous close). Existing min-sample rule is unchanged.
    const { input, decision } = await evaluatePath({
      nowMs: SUNDAY_NOW_MS,
      decision: productionLikeDecision({ lastKnownPrice: price, entry: { price } }),
      bars: gapAwareBars({ sundayCount: 6, price }),
      bid: price - 0.05,
      ask: price + 0.05
    });

    const trs = contiguousExtensionTrueRanges(input.m1History ?? []);
    expect(trs).toHaveLength(5);
    expect(trs.every((tr) => tr < WEEKEND_PRICE_GAP / 2)).toBe(true);
    const atr = estimateExtensionAtr(input);
    expect(atr.source).toBe("M1_ROLLING_TR");
    expect(atr.atr).toBeCloseTo(trs.reduce((s, v) => s + v, 0) / 5, 10);
    expect(decision.extension.extensionAtrSource).toBe("M1_ROLLING_TR");
    expect(decision.waitReason).not.toBe("WAIT_EXTENSION_VOLATILITY_UNAVAILABLE");
  });

  it("5. fourteen contiguous post-reopen TRs → M1_ATR14", async () => {
    const price = VAH + 0.8;
    const { input, decision } = await evaluatePath({
      nowMs: SUNDAY_NOW_MS,
      decision: productionLikeDecision({ lastKnownPrice: price, entry: { price } }),
      bars: gapAwareBars({ sundayCount: 15, price }),
      bid: price - 0.05,
      ask: price + 0.05
    });

    const trs = contiguousExtensionTrueRanges(input.m1History ?? []);
    expect(trs).toHaveLength(14);
    const atr = estimateExtensionAtr(input);
    expect(atr.source).toBe("M1_ATR14");
    expect(atr.atr).toBeCloseTo(trs.reduce((s, v) => s + v, 0) / 14, 10);
    expect(decision.extension.extensionAtrSource).toBe("M1_ATR14");
    expect(decision.extension.extensionLimitAtr).toBe(2.2);
    expect(decision.waitReason).not.toBe("WAIT_EXTENSION_VOLATILITY_UNAVAILABLE");
  });

  it("6. weekend price gap must not make an extended breakout look safe", async () => {
    const price = VAH + 13;
    // 14 post-reopen bars = 13 contiguous TRs. If the +80 weekend gap were
    // counted as one M1 TR, ATR14 would inflate and 13pts / inflatedATR < 2.2.
    const bars = gapAwareBars({
      sundayCount: 14,
      price,
      fridayCount: 8,
      fridayTypicalTr: TYPICAL_TR,
      sundayTypicalTr: TYPICAL_TR
    });
    const friday = bars[bars.length - 15]!;
    const sundayOpen = bars[bars.length - 14]!;
    const gapTr = completedBarTrueRange(sundayOpen, friday.close);
    expect(gapTr).toBeGreaterThan(70);

    const { input, decision } = await evaluatePath({
      nowMs: SUNDAY_NOW_MS,
      decision: productionLikeDecision({ lastKnownPrice: price, entry: { price } }),
      bars,
      bid: price - 0.05,
      ask: price + 0.05
    });

    const contiguous = contiguousExtensionTrueRanges(input.m1History ?? []);
    expect(contiguous).toHaveLength(13);
    expect(contiguous.every((tr) => tr < 20)).toBe(true);
    const cleanAtr = contiguous.reduce((s, v) => s + v, 0) / contiguous.length;
    const contaminatedAtr = (gapTr! + contiguous.reduce((s, v) => s + v, 0)) / 14;
    expect(13 / contaminatedAtr).toBeLessThan(2.2);
    expect(13 / cleanAtr).toBeGreaterThan(2.2);

    expect(decision.extension.extensionAtrSource).toBe("M1_ROLLING_TR");
    expect(decision.extension.extensionAtr).toBeCloseTo(cleanAtr, 8);
    expect(decision.extension.extensionDistanceAtr).toBeGreaterThan(2.2);
    expect(decision.action).toBe("WAIT");
    expect(decision.waitReason).toBe("WAIT_EXTENDED");
    expect(decision.extended).toBe(true);
    expect(decision.extension.extensionLimitAtr).toBe(2.2);
  });
});
