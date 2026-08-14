/**
 * GOLD_HUNTER FAST live-shadow soak preparation tests.
 * Frozen config, rejection diagnostics, soak metrics, replay parity, safety.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  GOLD_HUNTER_FAST_ENGINE_VERSION,
  GH_FAST_BROKER_EXECUTION_ENABLED,
  GH_FAST_MAX_OPEN_POSITIONS,
  GH_FAST_MUTATION_SURFACE,
  GH_FAST_SHADOW_ONLY,
  GoldHunterFastEngine,
  GoldHunterFastLiveBridge,
  ShadowExecutionAdapter,
  ForbiddenLiveExecutionAdapter,
  getFrozenGhFastIdentity,
  resetFrozenGhFastIdentityForTests,
  hashGhFastConfig,
  frozenGhFastSoakConfig,
  isGoldHunterFastShadowEnabled,
  diagnoseSetupNearMisses,
  GhFastRejectionCounter,
  computeSetupStats,
  computeActivityStats,
  categorizeTrades,
  analyseClosedTrade,
  verifyReplayParityFromEvents,
  defaultGhFastConfig
} from "../../../../src/services/microEdge/goldHunter/fast";
import type { GhFastClosedTrade } from "../../../../src/services/microEdge/goldHunter/fast/types";
import type { GhFastFeatureSnapshot } from "../../../../src/services/microEdge/goldHunter/fast/features";

describe("frozen soak identity", () => {
  beforeEach(() => {
    resetFrozenGhFastIdentityForTests();
  });

  it("records ENGINE_VERSION and stable FAST_CONFIG_SHA256", () => {
    const a = getFrozenGhFastIdentity();
    resetFrozenGhFastIdentityForTests();
    const b = getFrozenGhFastIdentity();
    expect(a.engineVersion).toBe(GOLD_HUNTER_FAST_ENGINE_VERSION);
    expect(a.soakLabel).toBe("LIVE_SHADOW_SOAK_V1");
    expect(a.tuningAllowed).toBe(false);
    expect(a.brokerExecutionEnabled).toBe(false);
    expect(a.mutationSurface).toBe("NONE");
    expect(a.maxOpenPositions).toBe(1);
    expect(a.configSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(a.configSha256).toBe(b.configSha256);
    expect(hashGhFastConfig(frozenGhFastSoakConfig())).toBe(a.configSha256);
    expect(hashGhFastConfig(defaultGhFastConfig({}))).toBe(a.configSha256);
  });

  it("useFrozenSoakConfig ignores threshold overrides", async () => {
    const adapter = new ShadowExecutionAdapter();
    const eng = new GoldHunterFastEngine({
      adapter,
      useFrozenSoakConfig: true,
      config: { maxSpread: 0.001, minSetupQuality: 0.01 }
    });
    const frozen = getFrozenGhFastIdentity();
    expect(eng.getConfig().maxSpread).toBe(frozen.config.maxSpread);
    expect(eng.getConfig().minSetupQuality).toBe(frozen.config.minSetupQuality);
    expect(eng.frozen().tuningAllowed).toBe(false);
  });
});

describe("rejection / missed-opportunity diagnostics", () => {
  it("counts granular rejection reasons", () => {
    const c = new GhFastRejectionCounter();
    c.record("spread_too_high");
    c.record("velocity_insufficient");
    c.record("velocity_insufficient");
    expect(c.snapshot().velocity_insufficient).toBe(2);
    expect(c.total()).toBe(3);
  });

  it("diagnoses near-misses when no setup fires", () => {
    const cfg = defaultGhFastConfig({});
    const f = {
      mid: 2400,
      bid: 2399.94,
      ask: 2400.06,
      spread: 0.12,
      midVel250: 0,
      midVel500: 0,
      midVel1s: 0,
      midVel3s: 0,
      acceleration: 0,
      high5s: 2400.2,
      low5s: 2399.8,
      distHigh5s: 0.2,
      distLow5s: 0.2,
      efficiency3s: 0.1,
      updateRate1s: 1,
      signedImbalance1s: 0,
      depth: {
        available: true,
        depthImbalance: 0.01,
        removeRateBid: 0,
        removeRateAsk: 0,
        bidDepthN: 1,
        askDepthN: 1,
        bestBid: 2399.94,
        bestAsk: 2400.06,
        bidLevels: 1,
        askLevels: 1
      }
    } as unknown as GhFastFeatureSnapshot;
    const reasons = diagnoseSetupNearMisses(f, cfg);
    expect(reasons.length).toBeGreaterThan(0);
    expect(
      reasons.some(
        (r) =>
          r === "velocity_insufficient" ||
          r === "no_setup_pressure" ||
          r === "update_rate_insufficient"
      )
    ).toBe(true);
  });

  it("engine records spot/depth stale separately", async () => {
    const eng = new GoldHunterFastEngine({
      adapter: new ShadowExecutionAdapter(),
      useFrozenSoakConfig: true
    });
    const t = Date.now();
    // Build feature history within keep window, then age depth.
    await eng.onMarketEvent({
      kind: "SPOT",
      receiveSeq: 1,
      eventId: "s1",
      receivedAtMs: t - 3000,
      brokerTimestampMs: null,
      bid: 2400,
      ask: 2400.12
    });
    await eng.onMarketEvent({
      kind: "DEPTH",
      receiveSeq: 2,
      eventId: "d1",
      receivedAtMs: t - 3000,
      brokerTimestampMs: null,
      newQuotes: [
        { id: 1, type: "BID", price: 2400, size: 1 },
        { id: 2, type: "ASK", price: 2400.12, size: 1 }
      ]
    });
    await eng.onMarketEvent({
      kind: "SPOT",
      receiveSeq: 3,
      eventId: "s2",
      receivedAtMs: t - 2500,
      brokerTimestampMs: null,
      bid: 2400.01,
      ask: 2400.13
    });
    // Fresh spots, but depth age > depthFreshnessMs (2000).
    await eng.onMarketEvent({
      kind: "SPOT",
      receiveSeq: 4,
      eventId: "s3",
      receivedAtMs: t,
      brokerTimestampMs: null,
      bid: 2400.02,
      ask: 2400.14
    });
    const snap = eng.rejections.snapshot();
    expect(
      (snap.depth_stale ?? 0) +
        (snap.spot_stale ?? 0) +
        (snap.depth_unavailable ?? 0) +
        (snap.data_stale ?? 0)
    ).toBeGreaterThan(0);
  });
});

describe("soak metrics helpers", () => {
  const sampleTrade = (
    overrides: Partial<GhFastClosedTrade>
  ): GhFastClosedTrade => ({
    tradeId: "t1",
    side: "BUY",
    setup: "A_MOMENTUM_IGNITION",
    entryTs: Date.UTC(2026, 7, 13, 13, 0, 0),
    entryBid: 2400,
    entryAsk: 2400.12,
    entryPrice: 2400.12,
    bestExit: 2400.4,
    mfe: 0.28,
    mae: -0.05,
    profitLockActive: true,
    lockFloor: 2400.2,
    trailDistance: 0.08,
    harvestRunner: true,
    exitTs: Date.UTC(2026, 7, 13, 13, 0, 8),
    exitBid: 2400.35,
    exitAsk: 2400.47,
    exitPrice: 2400.35,
    grossMove: 0.23,
    additionalFriction: 0.05,
    netMove: 0.18,
    durationMs: 8000,
    exitReason: "TRAIL_HIT",
    result: "WIN",
    ...overrides
  });

  it("computes setup stats and activity", () => {
    const trades = [
      sampleTrade({}),
      sampleTrade({
        tradeId: "t2",
        result: "LOSS",
        netMove: -0.1,
        exitReason: "RAPID_ABORT",
        harvestRunner: false,
        setup: "B_FAST_BREAKOUT",
        entryTs: Date.UTC(2026, 7, 13, 13, 5, 0)
      })
    ];
    const stats = computeSetupStats("ALL", trades, 10, 2);
    expect(stats.completedTrades).toBe(2);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBe(0.5);
    expect(stats.buyCount).toBe(2);
    const act = computeActivityStats({
      marketEvents: 10_000,
      decisions: 9_000,
      signals: 10,
      entryTimestampsMs: [1_000, 4_000, 10_000],
      completedTrades: 2,
      runtimeMs: 3_600_000
    });
    expect(act.entriesPerHour).toBe(3);
    expect(act.fastestReentrySec).toBe(3);
    expect(act.p50EntryIntervalSec).toBeGreaterThan(0);
  });

  it("categorises wins and losses", () => {
    const cats = categorizeTrades([
      sampleTrade({}),
      sampleTrade({
        result: "LOSS",
        netMove: -0.2,
        exitReason: "HARD_PROTECTION",
        setup: "A_MOMENTUM_IGNITION",
        harvestRunner: false
      })
    ]);
    expect(Object.keys(cats.wins).length).toBeGreaterThan(0);
    expect(cats.losses.hard_stop ?? cats.losses.false_momentum_ignition).toBe(
      1
    );
    const a = analyseClosedTrade(sampleTrade({}));
    expect(a.captureRatio).not.toBeNull();
    expect((a.captureRatio as number) > 0).toBe(true);
  });
});

describe("live/replay parity", () => {
  it("two frozen engines agree on the same event stream", async () => {
    const t0 = Date.now();
    const events = [];
    for (let i = 0; i < 40; i++) {
      const t = t0 + i * 50;
      events.push({
        kind: "SPOT" as const,
        receiveSeq: i * 2 + 1,
        eventId: `s${i}`,
        receivedAtMs: t,
        brokerTimestampMs: null,
        bid: 2400 + i * 0.01,
        ask: 2400.12 + i * 0.01
      });
      events.push({
        kind: "DEPTH" as const,
        receiveSeq: i * 2 + 2,
        eventId: `d${i}`,
        receivedAtMs: t,
        brokerTimestampMs: null,
        newQuotes: [
          { id: 1, type: "BID" as const, price: 2400 + i * 0.01, size: 2 },
          { id: 2, type: "ASK" as const, price: 2400.12 + i * 0.01, size: 2 }
        ]
      });
    }
    const result = await verifyReplayParityFromEvents(events);
    expect(result.code).toBe("LIVE_REPLAY_OK");
    expect(result.ok).toBe(true);
    expect(result.comparedEvents).toBe(events.length);
  });
});

describe("soak safety gates", () => {
  it("keeps shadow-only mutation surface and flag default", () => {
    expect(GH_FAST_SHADOW_ONLY).toBe(true);
    expect(GH_FAST_BROKER_EXECUTION_ENABLED).toBe(false);
    expect(GH_FAST_MUTATION_SURFACE).toBe("NONE");
    expect(GH_FAST_MAX_OPEN_POSITIONS).toBe(1);
    expect(isGoldHunterFastShadowEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      isGoldHunterFastShadowEnabled({
        GOLD_HUNTER_FAST_SHADOW_ENABLED: "false"
      } as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  it("refuses forbidden live execution adapter", () => {
    expect(() => new ForbiddenLiveExecutionAdapter()).toThrow();
  });

  it("frozen bridge reports brokerOrders 0 and soak identity", () => {
    const bridge = new GoldHunterFastLiveBridge({
      enabled: true,
      enableCollector: false,
      useFrozenSoakConfig: true
    });
    const ui = bridge.uiStatus();
    expect(ui.brokerOrders).toBe(0);
    expect(ui.brokerRequests).toBe(0);
    expect(ui.shadowOnly).toBe(true);
    expect(ui.mutationSurface).toBe("NONE");
    expect(ui.tuningAllowed).toBe(false);
    expect(ui.engineVersion).toBe(GOLD_HUNTER_FAST_ENGINE_VERSION);
    expect(ui.configSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(ui.realMarketData).toBe(true);
    expect(ui.pepperstoneDemo).toBe(true);
    const h = bridge.health();
    expect(h.brokerOrders).toBe(0);
    expect(h.soakLabel).toBe("LIVE_SHADOW_SOAK_V1");
    expect(h.tuningAllowed).toBe(false);
  });
});
