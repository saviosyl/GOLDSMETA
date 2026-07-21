import { describe, expect, it } from "vitest";
import { computeStructuralStop } from "./stopEngine";
import { detectStrategyPatterns } from "./strategies";
import { evaluateV4 } from "./engine";
import { buildSyntheticSeries, runV4Backtest } from "./backtester";
import { buildVolumeProfile } from "./profileEngine";
import type { V4Bar } from "./types";
import { v4Config } from "./config";

const bar = (overrides: Partial<V4Bar> & { time: string; close: number }): V4Bar => ({
  open: overrides.close,
  high: overrides.close + 1,
  low: overrides.close - 1,
  volume: 100,
  confirmed: true,
  timeframe: "15",
  ...overrides
});

describe("V4 stop engine", () => {
  it("rejects tiny stop distances like 0.22", () => {
    const result = computeStructuralStop({
      direction: "BUY",
      entry: 4072.31,
      atr: 12,
      spreadPoints: 0.35,
      bars: [
        bar({ time: "2025-01-01T10:00:00.000Z", close: 4072, low: 4072.09, high: 4073 }),
        bar({ time: "2025-01-01T10:15:00.000Z", close: 4072.31, low: 4072.09, high: 4073 })
      ],
      profile: buildVolumeProfile({
        source: "XAUUSD_TV",
        session: "LONDON",
        poc: 4070,
        vah: 4075,
        val: 4065,
        barCount: 40,
        volumeObservations: 40,
        asOf: "2025-01-01T10:15:00.000Z",
        atr: 12
      }),
      rejectionLow: 4072.09
    });
    // Either rejected or expanded beyond absolute minimum — never keep 0.22
    if (!result.rejected && result.distance != null) {
      expect(result.distance).toBeGreaterThanOrEqual(v4Config.stop.absoluteMinPoints);
    }
    if (result.distance != null) {
      expect(result.distance).not.toBeCloseTo(0.22, 2);
    }
  });
});

describe("V4 strategies are separate families", () => {
  it("does not invent a pattern without multi-bar structure", () => {
    const profile = buildVolumeProfile({
      source: "XAUUSD_TV",
      session: "LONDON",
      poc: 2650,
      vah: 2658,
      val: 2642,
      barCount: 40,
      volumeObservations: 40,
      asOf: "2025-01-01T12:00:00.000Z",
      atr: 5,
      pocMigration: "UP"
    });
    const bars = [
      bar({ time: "t1", close: 2650 }),
      bar({ time: "t2", close: 2651 })
    ];
    expect(detectStrategyPatterns({ bars, profile, regime: "UPTREND" })).toEqual([]);
  });
});

describe("V4 engine", () => {
  it("always returns actionable:false and strategyVersion 4", () => {
    const series = buildSyntheticSeries(3, 80);
    const last = series.bars15[series.bars15.length - 1]!;
    const result = evaluateV4({
      bars15: series.bars15.slice(-50),
      bars60: series.bars60.slice(-20),
      session: "LONDON",
      environment: "RESEARCH",
      xauProfile: {
        source: "XAUUSD_TV",
        poc: 2650,
        vah: 2658,
        val: 2642,
        asOf: last.time,
        barCount: 40,
        volumeObservations: 40,
        pocMigration: "FLAT"
      },
      nowIso: last.time
    });
    expect(result.actionable).toBe(false);
    expect(result.strategyVersion).toBe("4");
    expect(result.analysis.bias).toBeDefined();
  });
});

describe("V4 backtester", () => {
  it("runs chronologically with cost-aware metrics and zero plan mutations", () => {
    const series = buildSyntheticSeries(11, 140);
    const report = runV4Backtest(series, {
      sample: "in_sample",
      spreadPoints: 0.4,
      embargoBars: 5
    });
    expect(report.strategyVersion).toBe("4");
    expect(report.planMutationCount).toBe(0);
    expect(report.meetsAcceptanceGates).toBe(false);
    expect(report.acceptanceFailures.length).toBeGreaterThan(0);
    expect(report.notes.join(" ")).toMatch(/worst-case/i);
  });
});
