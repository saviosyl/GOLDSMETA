import { describe, expect, it } from "vitest";
import {
  GH_EVALUATION_INTERVAL_MS,
  GH_PURGE_MS,
  GH_SHADOW_ONLY,
  GH_BROKER_EXECUTION_ENABLED,
  GH_MUTATION_SURFACE,
  GOLD_HUNTER_STRATEGY_VERSION
} from "../../../../src/services/microEdge/goldHunter/config";
import { evaluateOnce, GoldHunterEvaluationClock } from "../../../../src/services/microEdge/goldHunter/evaluationClock";
import { computeExecutionAwareMove, labelHorizon, firstQuoteAtOrAfter } from "../../../../src/services/microEdge/goldHunter/labels";
import { chronologicalSplit } from "../../../../src/services/microEdge/goldHunter/chronologicalSplit";
import {
  applyNormalization,
  fitNormalization,
  predictProbs,
  probsSumApproxOne,
  trainMultinomialLogReg,
  hashDataset
} from "../../../../src/services/microEdge/goldHunter/model";
import {
  createShadowEngine,
  evaluateShadow
} from "../../../../src/services/microEdge/goldHunter/shadowEngine";
import { buildAsOfSecondRows, buildLabeledResearchRows } from "../../../../src/services/microEdge/goldHunter/asOfDataset";
import { buildDailySummary } from "../../../../src/services/microEdge/goldHunter/dailyPnL";
import { maxDrawdownFromPnls } from "../../../../src/services/microEdge/goldHunter/metrics";
import { buildFeaturesAtSecond } from "../../../../src/services/microEdge/goldHunter/features";
import { emptyMicrostructure } from "../../../../src/services/microEdge/goldHunter/microstructure";
import type { GhForecast, GhShadowTrade } from "../../../../src/services/microEdge/goldHunter/types";
import { decideAction } from "../../../../src/services/microEdge/goldHunter/signalPolicy";

function mkForecast(partial: Partial<GhForecast> & { actionHints?: "BUY" | "SELL" | "WAIT" }): GhForecast {
  const buy = partial.actionHints === "BUY";
  const sell = partial.actionHints === "SELL";
  const hz = (h: 5 | 15 | 30 | 60) => ({
    horizonSec: h,
    pUp: buy ? (h === 5 ? 0.75 : h === 15 ? 0.72 : h === 30 ? 0.68 : 0.4) : sell ? 0.1 : 0.33,
    pDown: sell ? (h === 5 ? 0.75 : h === 15 ? 0.72 : h === 30 ? 0.68 : 0.4) : buy ? 0.1 : 0.33,
    pNoEdge: buy || sell ? 0.15 : 0.34,
    expectedNetBuy: buy ? 0.2 : -0.1,
    expectedNetSell: sell ? 0.2 : -0.1
  });
  return {
    timestampMs: 1_000_000,
    bid: 2400,
    ask: 2400.15,
    mid: 2400.075,
    spread: 0.15,
    quoteAgeMs: 100,
    session: "LONDON",
    regime: "TREND",
    dataQuality: "OK",
    modelVersion: "test",
    strategyVersion: GOLD_HUNTER_STRATEGY_VERSION,
    horizons: { 5: hz(5), 15: hz(15), 30: hz(30), 60: hz(60) },
    action: "WAIT",
    huntState: "HUNTING",
    shadowOnly: true,
    brokerExecutionEnabled: false,
    mutationSurface: "NONE",
    ...partial
  };
}

describe("GOLD_HUNTER safety invariants", () => {
  it("is shadow-only with mutation NONE and execution false", () => {
    expect(GH_SHADOW_ONLY).toBe(true);
    expect(GH_BROKER_EXECUTION_ENABLED).toBe(false);
    expect(GH_MUTATION_SURFACE).toBe("NONE");
  });
});

describe("1-second evaluation clock", () => {
  it("uses 1000ms interval and zero broker requests", () => {
    expect(GH_EVALUATION_INTERVAL_MS).toBe(1000);
    const tick = evaluateOnce(1_000_000, {
      getLocalBook: () => ({
        bid: 2400,
        ask: 2400.2,
        bidUpdatedMs: 999_900,
        askUpdatedMs: 999_950,
        brokerTimestampMs: 999_950
      })
    });
    expect(tick.brokerRequestsThisTick).toBe(0);
    expect(tick.evaluated).toBe(true);
    const clock = new GoldHunterEvaluationClock(
      {
        getLocalBook: () => ({
          bid: 2400,
          ask: 2400.2,
          bidUpdatedMs: 999_900,
          askUpdatedMs: 999_950,
          brokerTimestampMs: 999_950
        })
      },
      () => undefined
    );
    expect(clock.getBrokerRequestsCausedByEvaluator()).toBe(0);
  });

  it("marks stale quotes DATA_STALE", () => {
    // Sides remain within side-freshness; consolidated quote age exceeds tolerance.
    const tick = evaluateOnce(1_000_000, {
      getLocalBook: () => ({
        bid: 2400,
        ask: 2400.2,
        bidUpdatedMs: 999_500,
        askUpdatedMs: 999_500,
        brokerTimestampMs: 990_000
      })
    });
    expect(tick.evaluated).toBe(false);
    expect(tick.reason).toBe("DATA_STALE");
  });
});

describe("Bid/Ask label math", () => {
  it("BUY/SELL gross includes spread once — no double subtraction", () => {
    const m = computeExecutionAwareMove({
      bidT: 100,
      askT: 100.2,
      bidTarget: 100.5,
      askTarget: 100.7,
      friction: { entrySlippage: 0.01, exitSlippage: 0.01, executionBuffer: 0.01 }
    });
    expect(m.grossLong).toBeCloseTo(100.5 - 100.2, 10);
    expect(m.grossShort).toBeCloseTo(100 - 100.7, 10);
    expect(m.netLong).toBeCloseTo(m.grossLong - 0.03, 10);
    expect(m.netShort).toBeCloseTo(m.grossShort - 0.03, 10);
  });

  it("UNSCORABLE when no quote within tolerance after T", () => {
    const lab = labelHorizon({
      horizonSec: 5,
      entry: { timestampMs: 1000, bid: 100, ask: 100.2 },
      futureQuotes: [{ timestampMs: 1000 + 5000 + 2000, bid: 100.3, ask: 100.5 }],
      theta: 0.1
    });
    expect(lab.classLabel).toBe("UNSCORABLE_DATA_GAP");
  });

  it("firstQuoteAtOrAfter rejects quotes before T", () => {
    const q = firstQuoteAtOrAfter(
      [
        { timestampMs: 4900, bid: 1, ask: 1.1 },
        { timestampMs: 5100, bid: 1, ask: 1.1 }
      ],
      5000,
      1500
    );
    expect(q?.timestampMs).toBe(5100);
  });
});

describe("as-of features — no look-ahead", () => {
  it("does not use future prices for second t", () => {
    const ticks = [];
    for (let i = 0; i < 70; i++) {
      const t = 1_000_000 + i * 1000;
      ticks.push({ timestampMs: t, side: "BID" as const, price: 2400 + i * 0.01 });
      ticks.push({ timestampMs: t + 1, side: "ASK" as const, price: 2400.15 + i * 0.01 });
    }
    const { rows: seconds } = buildAsOfSecondRows(ticks);
    const hist = seconds
      .filter((s) => s.scorable)
      .slice(0, 65)
      .map((s) => ({
        timestampMs: s.timestampMs,
        bid: s.bid,
        ask: s.ask,
        bidUpdatedMs: s.bidUpdatedMs,
        askUpdatedMs: s.askUpdatedMs,
        micro: emptyMicrostructure()
      }));
    const f = buildFeaturesAtSecond({ history: hist, m1Bars: [], m5Bars: [], m15Bars: [] });
    expect(f).not.toBeNull();
    // mid must equal last history point, not a future tick
    const last = hist[hist.length - 1]!;
    expect(f!.mid).toBeCloseTo((last.bid + last.ask) / 2, 8);
  });

  it("marks DATA_GAP when side freshness exceeded", () => {
    const ticks = [
      { timestampMs: 1000, side: "BID" as const, price: 2400 },
      { timestampMs: 1001, side: "ASK" as const, price: 2400.2 }
    ];
    const { rows: seconds } = buildAsOfSecondRows(ticks, {
      fromMs: 1000,
      toMs: 5000,
      sideFreshnessMs: 2000
    });
    const gap = seconds.find((s) => s.timestampMs === 5000);
    expect(gap?.scorable).toBe(false);
    expect(gap?.reason).toBe("DATA_GAP");
  });
});

describe("chronological split + purge", () => {
  it("is chronological with >=60s purge and no shuffle", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      timestampMs: 1_000_000 + i * 1000
    }));
    const split = chronologicalSplit(rows);
    expect(split.train.every((r, i, a) => i === 0 || r.timestampMs >= a[i - 1]!.timestampMs)).toBe(
      true
    );
    if (split.train.length && split.validation.length) {
      expect(
        split.validation[0]!.timestampMs - split.train[split.train.length - 1]!.timestampMs
      ).toBeGreaterThanOrEqual(GH_PURGE_MS);
    }
  });

  it("fits normalization on train only semantics", () => {
    const train = [
      [1, 2],
      [3, 4],
      [5, 6]
    ];
    const norm = fitNormalization(train);
    const val = applyNormalization([100, 100], norm);
    // Using train mean/std — not refit on val
    expect(norm.mean[0]).toBeCloseTo(3, 5);
    expect(val[0]).toBeGreaterThan(10);
  });
});

describe("model probabilities", () => {
  it("softmax probs sum ~1 and artifact hash is deterministic", () => {
    const X = [
      [0.1, 0.2],
      [0.9, 0.8],
      [0.5, 0.4],
      [0.2, 0.1],
      [0.8, 0.7]
    ];
    const y = [
      "UP_TRADEABLE",
      "DOWN_TRADEABLE",
      "NO_EDGE",
      "UP_TRADEABLE",
      "DOWN_TRADEABLE"
    ] as const;
    const model = trainMultinomialLogReg([...X], [...y], { epochs: 40 });
    const p = predictProbs(model, [0.3, 0.3]);
    expect(probsSumApproxOne(p)).toBe(true);
    expect(hashDataset([{ timestampMs: 1 }, { timestampMs: 2 }])).toBe(
      hashDataset([{ timestampMs: 1 }, { timestampMs: 2 }])
    );
  });
});

describe("shadow engine", () => {
  it("BUY enters at Ask and exits at Bid; single position only", () => {
    let state = createShadowEngine();
    const fBuy = mkForecast({ actionHints: "BUY" });
    const quote = { timestampMs: 1_000_000, bid: 2400, ask: 2400.2, spread: 0.2 };
    state = evaluateShadow(state, { nowMs: quote.timestampMs, quote, forecast: fBuy });
    state = evaluateShadow(state, {
      nowMs: quote.timestampMs + 1000,
      quote: { ...quote, timestampMs: quote.timestampMs + 1000 },
      forecast: fBuy
    });
    expect(state.openTrade).not.toBeNull();
    expect(state.openTrade!.entryPrice).toBe(2400.2);
    expect(state.openTrade!.side).toBe("BUY");
    const openId = state.openTrade!.tradeId;
    // attempt second entry while open — must not pyramid
    state = evaluateShadow(state, {
      nowMs: quote.timestampMs + 2000,
      quote: { timestampMs: quote.timestampMs + 2000, bid: 2400.1, ask: 2400.3, spread: 0.2 },
      forecast: fBuy
    });
    expect(state.openTrade!.tradeId).toBe(openId);

    // max hold exit
    state = evaluateShadow(state, {
      nowMs: quote.timestampMs + 61_000,
      quote: { timestampMs: quote.timestampMs + 61_000, bid: 2400.5, ask: 2400.7, spread: 0.2 },
      forecast: fBuy,
      maxHoldSec: 60
    });
    expect(state.openTrade).toBeNull();
    expect(state.completedTrades[0]!.exitPrice).toBe(2400.5);
    expect(state.completedTrades[0]!.exitReason).toBe("MAX_HOLD");
  });

  it("SELL enters at Bid and exits at Ask", () => {
    let state = createShadowEngine();
    const fSell = mkForecast({ actionHints: "SELL" });
    const q0 = { timestampMs: 2_000_000, bid: 2400, ask: 2400.2, spread: 0.2 };
    state = evaluateShadow(state, { nowMs: q0.timestampMs, quote: q0, forecast: fSell });
    state = evaluateShadow(state, {
      nowMs: q0.timestampMs + 1000,
      quote: { ...q0, timestampMs: q0.timestampMs + 1000 },
      forecast: fSell
    });
    expect(state.openTrade!.entryPrice).toBe(2400);
    state = evaluateShadow(state, {
      nowMs: q0.timestampMs + 61_000,
      quote: { timestampMs: q0.timestampMs + 61_000, bid: 2399.5, ask: 2399.7, spread: 0.2 },
      forecast: fSell,
      maxHoldSec: 60
    });
    expect(state.completedTrades[0]!.exitPrice).toBe(2399.7);
  });

  it("edge flip exits after 2 consecutive opposite signals", () => {
    let state = createShadowEngine();
    const fBuy = mkForecast({ actionHints: "BUY" });
    const fSell = mkForecast({ actionHints: "SELL" });
    const q0 = { timestampMs: 3_000_000, bid: 2400, ask: 2400.2, spread: 0.2 };
    state = evaluateShadow(state, { nowMs: q0.timestampMs, quote: q0, forecast: fBuy });
    state = evaluateShadow(state, {
      nowMs: q0.timestampMs + 1000,
      quote: { ...q0, timestampMs: q0.timestampMs + 1000 },
      forecast: fBuy
    });
    expect(state.openTrade).not.toBeNull();
    state = evaluateShadow(state, {
      nowMs: q0.timestampMs + 2000,
      quote: { timestampMs: q0.timestampMs + 2000, bid: 2400, ask: 2400.2, spread: 0.2 },
      forecast: fSell
    });
    state = evaluateShadow(state, {
      nowMs: q0.timestampMs + 3000,
      quote: { timestampMs: q0.timestampMs + 3000, bid: 2400, ask: 2400.2, spread: 0.2 },
      forecast: fSell
    });
    expect(state.openTrade).toBeNull();
    expect(state.completedTrades.at(-1)?.exitReason).toBe("EDGE_FLIPPED");
  });
});

describe("daily P/L + version separation", () => {
  it("computes daily stats and separates strategy versions", () => {
    const base: GhShadowTrade = {
      tradeId: "t1",
      date: "2026-08-13",
      strategyVersion: GOLD_HUNTER_STRATEGY_VERSION,
      modelVersion: "m",
      entryTimestampMs: Date.parse("2026-08-13T10:00:00Z"),
      exitTimestampMs: Date.parse("2026-08-13T10:00:21Z"),
      durationSeconds: 21,
      side: "BUY",
      entryBid: 1,
      entryAsk: 1.1,
      entryPrice: 1.1,
      exitBid: 1.2,
      exitAsk: 1.3,
      exitPrice: 1.2,
      entrySpread: 0.1,
      grossMove: 0.1,
      additionalFriction: 0.06,
      netMove: 0.04,
      mfe: 0.1,
      mae: 0,
      entryProbs: {
        5: { horizonSec: 5, pUp: 0.7, pDown: 0.1, pNoEdge: 0.2, expectedNetBuy: 0.1, expectedNetSell: 0 },
        15: { horizonSec: 15, pUp: 0.7, pDown: 0.1, pNoEdge: 0.2, expectedNetBuy: 0.1, expectedNetSell: 0 },
        30: { horizonSec: 30, pUp: 0.7, pDown: 0.1, pNoEdge: 0.2, expectedNetBuy: 0.1, expectedNetSell: 0 },
        60: { horizonSec: 60, pUp: 0.7, pDown: 0.1, pNoEdge: 0.2, expectedNetBuy: 0.1, expectedNetSell: 0 }
      },
      exitProbs: null,
      entryReason: "x",
      exitReason: "MAX_HOLD",
      session: "LONDON",
      regime: "TREND",
      result: "WIN"
    };
    const v11 = { ...base, tradeId: "t2", strategyVersion: "GOLD_HUNTER_V1_1", netMove: -1, result: "LOSS" as const };
    const s = buildDailySummary([base, v11], {
      date: "2026-08-13",
      strategyVersion: GOLD_HUNTER_STRATEGY_VERSION
    });
    expect(s.tradeCount).toBe(1);
    expect(s.netPnl).toBeCloseTo(0.04, 8);
    expect(maxDrawdownFromPnls([0.1, -0.3, 0.05])).toBeGreaterThan(0);
  });
});

describe("signal policy", () => {
  it("does not BUY merely because pUp > 0.5", () => {
    const f = mkForecast({ actionHints: "WAIT" });
    f.horizons[5] = {
      horizonSec: 5,
      pUp: 0.51,
      pDown: 0.2,
      pNoEdge: 0.29,
      expectedNetBuy: 0.01,
      expectedNetSell: 0
    };
    expect(decideAction(f)).toBe("WAIT");
  });
});

describe("labeled research rows", () => {
  it("builds labels for 5/15/30/60", () => {
    const ticks = [];
    for (let i = 0; i < 120; i++) {
      const t = 5_000_000 + i * 1000;
      ticks.push({ timestampMs: t, side: "BID" as const, price: 2400 + Math.sin(i / 10) * 0.2 });
      ticks.push({
        timestampMs: t + 1,
        side: "ASK" as const,
        price: 2400.15 + Math.sin(i / 10) * 0.2
      });
    }
    const { rows: seconds } = buildAsOfSecondRows(ticks);
    const { rows } = buildLabeledResearchRows({ seconds, theta: 0.05 });
    expect(rows.length).toBeGreaterThan(10);
    const sample = rows[10]!;
    expect(sample.labels[5]).toBeDefined();
    expect(sample.labels[15]).toBeDefined();
    expect(sample.labels[30]).toBeDefined();
    expect(sample.labels[60]).toBeDefined();
  });

  it("labels ~20k seconds in linear time (not O(n²))", () => {
    const ticks = [];
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const t = 10_000_000 + i * 1000;
      ticks.push({
        timestampMs: t,
        side: "BID" as const,
        price: 4300 + Math.sin(i / 25) * 0.5
      });
      ticks.push({
        timestampMs: t + 1,
        side: "ASK" as const,
        price: 4300.12 + Math.sin(i / 25) * 0.5
      });
    }
    const { rows: seconds } = buildAsOfSecondRows(ticks);
    const t0 = Date.now();
    const { rows } = buildLabeledResearchRows({ seconds, theta: 0.05 });
    const elapsed = Date.now() - t0;
    expect(rows.length).toBeGreaterThan(n * 0.8);
    // O(n²) would be minutes; linear path should be well under 15s here.
    expect(elapsed).toBeLessThan(15_000);
  });
});
