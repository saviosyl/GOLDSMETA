import { describe, expect, it, vi } from "vitest";
import { computeStructuralStop } from "./stopEngine";
import { detectStrategyPatterns } from "./strategies";
import { evaluateV4 } from "./engine";
import { buildSyntheticSeries, runV4Backtest } from "./backtester";
import { buildVolumeProfile } from "./profileEngine";
import {
  applyBarToShadowPlan,
  assertShadowPlanImmutable
} from "./shadowLifecycle";
import { computeV4ShadowAnalytics } from "./shadowAnalytics";
import { fetchComexGcProfile } from "./gcProvider";
import { v4Config } from "./config";
import type { V4Bar } from "./types";
import type { V4LockedShadowPlan } from "./shadowTypes";

const bar = (overrides: Partial<V4Bar> & { time: string; close: number }): V4Bar => ({
  open: overrides.close,
  high: overrides.close + 1,
  low: overrides.close - 1,
  volume: 100,
  confirmed: true,
  timeframe: "15",
  ...overrides
});

const basePlan = (): V4LockedShadowPlan => ({
  planId: "plan1",
  strategyVersion: "4",
  mode: "SHADOW",
  environment: "LIVE",
  strategyFamily: "VALUE_BREAKOUT_RETEST",
  direction: "BUY",
  entry: 2650,
  stopLoss: 2645,
  tp1: 2655,
  tp2: 2660,
  tp3: 2665,
  riskDistance: 5,
  quality: {
    total: 75,
    max: 100,
    components: {
      marketStructure: 15,
      higherTimeframeAgreement: 10,
      valueProfileContext: 10,
      confirmationQuality: 10,
      pocMigration: 5,
      volatilitySuitability: 8,
      sessionQuality: 5,
      volumeConfirmation: 5,
      rewardGeometry: 7
    },
    disclaimer: "This is a rules-based setup quality score, not the probability of profit."
  },
  costs: {
    estimateOnly: true,
    spreadPoints: 0.35,
    slippagePoints: 0.15,
    overnightPoints: 0,
    totalCostPoints: 0.5,
    totalCostR: 0.1,
    netRrTp1: 0.9,
    netRrTp2: 1.9,
    notes: []
  },
  createdAt: "2025-01-01T10:00:00.000Z",
  barTime: "2025-01-01T10:00:00.000Z",
  expiryBarTime: null,
  session: "LONDON",
  regime: "UPTREND",
  profileVersion: "profile-4.0.0",
  configVersion: v4Config.configVersion,
  engineVersion: v4Config.engineVersion,
  locked: true,
  status: "WAITING_FOR_ENTRY",
  candidateId: "cand1",
  parentDecisionId: "d1",
  actionable: false,
  entryTriggeredAt: null,
  resolvedAt: null,
  barsToEntry: 0,
  barsInTrade: null,
  grossR: null,
  netR: null,
  mfe: null,
  mae: null,
  appliedBarEventIds: [],
  lastBarTime: null,
  mutationAttempts: 0,
  updatedAt: "2025-01-01T10:00:00.000Z"
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
    if (!result.rejected && result.distance != null) {
      expect(result.distance).toBeGreaterThanOrEqual(v4Config.stop.absoluteMinPoints);
    }
    if (result.distance != null) {
      expect(result.distance).not.toBeCloseTo(0.22, 2);
    }
    expect(result.rejected || (result.distance ?? 0) >= v4Config.stop.absoluteMinPoints).toBe(true);
  });
});

describe("V4 strategies", () => {
  it("does not invent patterns from flat noise", () => {
    const bars = Array.from({ length: 40 }, (_, i) =>
      bar({
        time: new Date(Date.UTC(2025, 0, 1, 10, i * 15)).toISOString(),
        close: 2650,
        high: 2650.2,
        low: 2649.8
      })
    );
    const hits = detectStrategyPatterns({
      bars,
      profile: buildVolumeProfile({
        source: "XAUUSD_TV",
        session: "LONDON",
        poc: 2650,
        vah: 2655,
        val: 2645,
        barCount: 40,
        volumeObservations: 40,
        asOf: bars.at(-1)!.time,
        atr: 8
      }),
      regime: "BALANCED_RANGE"
    });
    expect(hits.length).toBe(0);
  });
});

describe("V4 engine non-actionable", () => {
  it("never returns actionable true", () => {
    const series = buildSyntheticSeries(3, 80);
    const last = series.bars15.at(-1)!;
    const result = evaluateV4({
      bars15: series.bars15,
      bars60: series.bars60,
      session: "LONDON",
      environment: "LIVE",
      nowIso: last.time,
      hasActiveLockedPlan: false,
      xauProfile: {
        source: "XAUUSD_TV",
        poc: last.close,
        vah: last.close + 8,
        val: last.close - 8,
        asOf: last.time,
        barCount: series.bars15.length,
        volumeObservations: series.bars15.length
      }
    });
    expect(result.actionable).toBe(false);
    expect(v4Config.flags.actionableSetupEnabled).toBe(false);
    expect(v4Config.flags.liveSetupCreation).toBe(false);
    expect(v4Config.flags.notificationsEnabled).toBe(false);
  });
});

describe("V4 backtester smoke", () => {
  it("runs synthetic smoke without claiming production edge", () => {
    const series = buildSyntheticSeries(5, 120);
    const report = runV4Backtest(series, {
      sample: "in_sample",
      foldId: "smoke",
      spreadPoints: 0.35,
      embargoBars: 4,
      maxExperimentsNote: "smoke"
    });
    expect(report.strategyVersion).toBe("4");
    expect(report.planMutationCount).toBe(0);
  });
});

describe("V4 shadow lifecycle", () => {
  it("keeps locked plan fields immutable", () => {
    const plan = basePlan();
    const blocked = assertShadowPlanImmutable(plan, { entry: plan.entry + 1 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.attemptedFields).toContain("entry");
      expect(blocked.plan.entry).toBe(plan.entry);
      expect(blocked.plan.mutationAttempts).toBe(1);
    }
  });

  it("is idempotent on duplicate event ids", () => {
    const plan = basePlan();
    const b = bar({
      time: "2025-01-01T10:15:00.000Z",
      close: 2650,
      high: 2651,
      low: 2649
    });
    const a = applyBarToShadowPlan(plan, b, "evt-1");
    const again = applyBarToShadowPlan(a, b, "evt-1");
    expect(again.appliedBarEventIds.filter((id) => id === "evt-1")).toHaveLength(1);
    expect(again.barsToEntry).toBe(a.barsToEntry);
  });

  it("ignores out-of-order bars without corrupting state", () => {
    const plan = applyBarToShadowPlan(
      basePlan(),
      bar({ time: "2025-01-01T11:00:00.000Z", close: 2650, high: 2651, low: 2649 }),
      "evt-2"
    );
    const corrupted = applyBarToShadowPlan(
      plan,
      bar({ time: "2025-01-01T10:30:00.000Z", close: 2640, high: 2641, low: 2630 }),
      "evt-old"
    );
    expect(corrupted.lastBarTime).toBe(plan.lastBarTime);
    expect(corrupted.stopLoss).toBe(plan.stopLoss);
    expect(corrupted.status).toBe(plan.status);
  });

  it("rejects stale bars far beyond plan skew window", () => {
    const plan = basePlan();
    const far = applyBarToShadowPlan(
      plan,
      bar({
        time: "2026-06-01T10:00:00.000Z",
        close: 2650,
        high: 2660,
        low: 2640
      }),
      "evt-stale"
    );
    expect(far.status).toBe("WAITING_FOR_ENTRY");
    expect(far.appliedBarEventIds).not.toContain("evt-stale");
  });

  it("expires candidates waiting too long for entry", () => {
    let plan = basePlan();
    for (let i = 1; i <= v4Config.lifecycle.entryExpiryBars; i++) {
      plan = applyBarToShadowPlan(
        plan,
        bar({
          time: new Date(Date.UTC(2025, 0, 1, 10, i * 15)).toISOString(),
          close: 2651,
          high: 2652,
          low: 2650.5
        }),
        `wait-${i}`
      );
    }
    expect(plan.status).toBe("EXPIRED");
    expect(plan.entryTriggeredAt).toBeNull();
  });

  it("uses worst-case SL-first on same-candle SL and TP", () => {
    let plan = applyBarToShadowPlan(
      basePlan(),
      bar({ time: "2025-01-01T10:15:00.000Z", close: 2650, high: 2650.2, low: 2649.8 }),
      "touch-entry"
    );
    expect(plan.status).toBe("ENTERED");
    const ambiguous = applyBarToShadowPlan(
      plan,
      bar({
        time: "2025-01-01T10:30:00.000Z",
        close: 2652,
        high: 2666,
        low: 2644
      }),
      "sl-tp-same"
    );
    expect(ambiguous.status).toBe("AMBIGUOUS_WORST_CASE_SL");
    expect(ambiguous.grossR).toBe(-1);
    expect(ambiguous.entry).toBe(2650);
    expect(ambiguous.stopLoss).toBe(2645);
  });
});

describe("V4 GC provider", () => {
  it("represents missing GC honestly", () => {
    const gc = fetchComexGcProfile();
    expect(gc.profileQuality).toBe("UNAVAILABLE");
    expect(gc.asVolumeProfile).toBeNull();
    expect(gc.note.toUpperCase()).toContain("UNAVAILABLE");
  });
});

describe("V4 shadow analytics", () => {
  it("stays separate and warns on tiny samples", () => {
    const analytics = computeV4ShadowAnalytics({
      environment: "LIVE",
      analyses: [
        {
          analysisId: "a1",
          strategyVersion: "4",
          mode: "SHADOW",
          environment: "LIVE",
          eventId: "e1",
          parentDecisionId: "d1",
          barTime: "2025-01-01T10:00:00.000Z",
          timeframe: "15",
          ohlc: { open: 1, high: 2, low: 0.5, close: 1.5 },
          session: "LONDON",
          regime: "UPTREND",
          bias: "BUY_BIAS",
          atr: 10,
          atrPercentile: 0.5,
          xauPoc: 1,
          vah: 2,
          val: 0.5,
          profileSource: "XAUUSD_TV",
          profileAsOf: "2025-01-01T10:00:00.000Z",
          gcConfirmation: "UNAVAILABLE",
          htfContext: "UPTREND",
          gateFailures: [],
          rejectionReasons: ["WAIT"],
          configVersion: v4Config.configVersion,
          profileVersion: v4Config.profileVersion,
          engineVersion: v4Config.engineVersion,
          generatedAt: "2025-01-01T10:00:00.000Z",
          actionable: false
        }
      ],
      candidates: [],
      plans: []
    });
    expect(analytics.strategyVersion).toBe("4");
    expect(analytics.mode).toBe("SHADOW");
    expect(analytics.sampleSizeBand).toBe("extremely_small");
    expect(analytics.gcUnavailableCount).toBe(1);
    expect(analytics.unsafePlanCount).toBe(0);
  });
});

describe("V4 feature flags fail closed", () => {
  it("hard-disables actionable paths regardless of env", () => {
    expect(v4Config.flags.actionableSetupEnabled).toBe(false);
    expect(v4Config.flags.liveSetupCreation).toBe(false);
    expect(v4Config.flags.notificationsEnabled).toBe(false);
  });
});

// Keep vi imported for potential spy extensions in integration suite
void vi;
