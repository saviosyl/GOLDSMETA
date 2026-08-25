import { describe, expect, it } from "vitest";
import { createPrediction } from "../../../src/services/microEdge/prediction/predictor";
import { resolveTargetQuote, scoreHorizon } from "../../../src/services/microEdge/outcomes/scorer";
import { runMicroPredictionCycle } from "../../../src/services/microEdge/runtime/predictionWorker";
import { MemoryMicroEdgeStore } from "../../../src/services/microEdge/storage/firestoreMicroEdgeStore";
import { buildQuote } from "../../../src/services/microEdge/marketData/quoteRepository";
import type { MicroBar } from "../../../src/services/microEdge/types";

function bars(n: number, endCloseMs: number): MicroBar[] {
  const out: MicroBar[] = [];
  let px = 2400;
  for (let i = 0; i < n; i++) {
    const closeTimeMs = endCloseMs - (n - 1 - i) * 60_000;
    const open = px;
    const close = px + 0.1;
    out.push({
      timeframe: "M1",
      openTimeMs: closeTimeMs - 60_000,
      closeTimeMs,
      open,
      high: close + 0.2,
      low: open - 0.2,
      close,
      tickVolume: 50
    });
    px = close;
  }
  return out;
}

describe("Micro Edge leakage + idempotency", () => {
  it("features cutoff is candle close (no future inputs)", () => {
    const t = Date.parse("2026-08-12T10:00:00.000Z");
    const m1 = bars(40, t);
    // Inject a future bar that must be ignored.
    m1.push({
      timeframe: "M1",
      openTimeMs: t,
      closeTimeMs: t + 60_000,
      open: 9999,
      high: 9999,
      low: 9999,
      close: 9999,
      tickVolume: 1
    });
    const quote = buildQuote({
      bid: 2400,
      ask: 2400.2,
      brokerTimestamp: new Date(t).toISOString(),
      nowMs: t,
      freshness: "LIVE"
    });
    const { features } = createPrediction({
      candleCloseEpochMs: t,
      m1,
      m5: [],
      m15: [],
      quote,
      spreadHistory: [0.2],
      nowMs: t
    });
    expect(new Date(features.cutoffTs).getTime()).toBe(t);
    expect(features.values.mid).not.toBe(9999);
  });

  it("target scorer rejects quotes before target and beyond tolerance", () => {
    const targetMs = Date.parse("2026-08-12T10:05:00.000Z");
    const early = buildQuote({
      bid: 1,
      ask: 1.1,
      brokerTimestamp: new Date(targetMs - 1000).toISOString(),
      nowMs: targetMs
    });
    const late = buildQuote({
      bid: 1,
      ask: 1.1,
      brokerTimestamp: new Date(targetMs + 10_000).toISOString(),
      nowMs: targetMs + 10_000
    });
    expect(resolveTargetQuote({ targetMs, quotes: [early] }).quote).toBeNull();
    expect(resolveTargetQuote({ targetMs, quotes: [late] }).reason).toBe(
      "UNSCORABLE_DATA_GAP"
    );
  });

  it("missing target becomes UNSCORABLE and does not mutate prediction", async () => {
    const store = new MemoryMicroEdgeStore();
    const t = Date.parse("2026-08-12T11:00:00.000Z");
    const m1 = bars(40, t);
    const quote = buildQuote({
      bid: 2500,
      ask: 2500.2,
      brokerTimestamp: new Date(t).toISOString(),
      nowMs: t,
      freshness: "LIVE"
    });
    const { predictionId } = await runMicroPredictionCycle({
      store,
      candleCloseEpochMs: t,
      m1,
      m5: [],
      m15: [],
      quote,
      spreadHistory: [0.2]
    });
    const before = await store.getPrediction(predictionId);
    const outcome = scoreHorizon({
      prediction: before!,
      horizon: "1m",
      pathQuotes: [],
      nowMs: t + 120_000
    });
    expect(outcome.scorable).toBe(false);
    expect(outcome.unscorableReason).toBe("UNSCORABLE_DATA_GAP");
    const after = await store.getPrediction(predictionId);
    expect(after).toEqual(before);
  });

  it("retry does not duplicate predictions", async () => {
    const store = new MemoryMicroEdgeStore();
    const t = Date.parse("2026-08-12T11:30:00.000Z");
    const m1 = bars(40, t);
    const quote = buildQuote({
      bid: 2500,
      ask: 2500.15,
      brokerTimestamp: new Date(t).toISOString(),
      nowMs: t,
      freshness: "LIVE"
    });
    const a = await runMicroPredictionCycle({
      store,
      candleCloseEpochMs: t,
      m1,
      m5: [],
      m15: [],
      quote,
      spreadHistory: [0.15]
    });
    const b = await runMicroPredictionCycle({
      store,
      candleCloseEpochMs: t,
      m1,
      m5: [],
      m15: [],
      quote,
      spreadHistory: [0.15]
    });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(store.predictions.size).toBe(1);
  });

  it("same frozen input + model version yields identical prediction", () => {
    const t = Date.parse("2026-08-12T09:00:00.000Z");
    const m1 = bars(50, t);
    const quote = buildQuote({
      bid: 2300,
      ask: 2300.1,
      brokerTimestamp: new Date(t).toISOString(),
      nowMs: t,
      freshness: "LIVE"
    });
    const a = createPrediction({
      candleCloseEpochMs: t,
      m1,
      m5: [],
      m15: [],
      quote,
      spreadHistory: [0.1],
      nowMs: t
    });
    const b = createPrediction({
      candleCloseEpochMs: t,
      m1,
      m5: [],
      m15: [],
      quote,
      spreadHistory: [0.1],
      nowMs: t
    });
    expect(a.prediction.predictionId).toBe(b.prediction.predictionId);
    expect(a.prediction.horizons["5m"].pUp).toBe(b.prediction.horizons["5m"].pUp);
    expect(a.prediction.horizons["5m"].expectedSignedMove).toBe(
      b.prediction.horizons["5m"].expectedSignedMove
    );
  });
});
