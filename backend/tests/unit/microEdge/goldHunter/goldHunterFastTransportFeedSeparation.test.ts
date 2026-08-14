/**
 * GOLD HUNTER FAST — transport connectivity vs feed freshness separation.
 *
 * Proves quote_stale / m1_stale / collector_heartbeat_stale do NOT cause
 * research noteDisconnect / RESYNC / transport reconnect, while genuine
 * transport loss still does. Soft 20s / hard 45s / 2m→5m→15m preserved.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFakeLiveSession,
  type MicroLiveSessionState
} from "../../../../src/services/microEdge/marketData/liveSession";
import { MemoryMicroMarketDataStore } from "../../../../src/services/microEdge/marketData/marketDataStore";
import { MICRO_QUOTE_MAX_AGE_MS } from "../../../../src/services/microEdge/config";
import { MICRO_SPOT_PRICE_SCALE } from "../../../../src/services/microEdge/marketData/microCTraderProtocol";
import { GoldHunterFastResearchCaptureRuntime } from "../../../../src/services/microEdge/runtime/fastResearchCaptureRuntime";
import {
  decideResearchStaleReconnect,
  GH_FAST_RESEARCH_HARD_STALE_RECONNECT_MS,
  GH_FAST_RESEARCH_SOFT_STALE_MS,
  GH_FAST_RESEARCH_STALE_FEED_BACKOFF_MS,
  staleFeedBackoffMs
} from "../../../../src/services/microEdge/goldHunter/fast/research/researchStaleReconnectPolicy";
import { ResearchIngestBridge } from "../../../../src/services/microEdge/goldHunter/fast/research/researchIngestBridge";

const SCOPE_RAW = {
  permissionScope: "SCOPE_VIEW",
  ctidTraderAccount: [{ ctidTraderAccountId: 123 }]
};

function rel(price: number): number {
  return Math.round(price * MICRO_SPOT_PRICE_SCALE);
}

describe("transport vs freshness — liveSession additive fields", () => {
  it("5. liveConnected still false on quote_stale; researchSessionConnected stays true", async () => {
    expect(MICRO_QUOTE_MAX_AGE_MS).toBe(30_000);
    const store = new MemoryMicroMarketDataStore();
    let now = 1_000_000;
    const { session, fake } = createFakeLiveSession(store, undefined, () => now);
    fake.symbols = [
      {
        symbolId: 41,
        symbolName: "XAUUSD",
        digits: 2,
        pipPosition: 1
      }
    ];
    await session.connect();
    // Fresh quote
    session.ingestSpotEventForTests({
      bid: rel(3400),
      ask: rel(3400.1),
      timestamp: now
    });
    // Persist a fresh M1 so strict liveConnected can pass when quote is fresh
    await store.upsertBar({
      id: "m1",
      symbol: "XAUUSD",
      symbolId: "41",
      timeframe: "M1",
      openTimeMs: now - 60_000,
      closeTimeMs: now - 1_000,
      open: 3400,
      high: 3401,
      low: 3399,
      close: 3400.5,
      tickVolume: 10,
      environment: "DEMO",
      source: "CTRADER_OPEN_API",
      ingestedAt: new Date(now).toISOString()
    } as never);

    const fresh = await session.getState();
    expect(fresh.researchSessionConnected).toBe(true);
    expect(fresh.transportConnected).toBe(true);
    expect(fresh.transportAuthenticated).toBe(true);
    // May or may not be liveConnected depending on heartbeat — force tick again
    session.ingestSpotEventForTests({
      bid: rel(3400),
      ask: rel(3400.1),
      timestamp: now
    });
    const fresh2 = await session.getState();
    expect(fresh2.researchSessionConnected).toBe(true);

    // Advance past MICRO_QUOTE_MAX_AGE_MS — quote_stale
    now += MICRO_QUOTE_MAX_AGE_MS + 1;
    const stale = await session.getState();
    expect(stale.healthReasons).toContain("quote_stale");
    expect(stale.liveConnected).toBe(false); // existing semantics unchanged
    expect(stale.researchSessionConnected).toBe(true); // research cohort intact
    expect(stale.transportConnected).toBe(true);
    expect(stale.spotSubscribed).toBe(true);
    expect(stale.depthSubscribed).toBe(true);
  });
});

describe("Gold Hunter syncSessionState classification", () => {
  let dir: string;
  const prevBucket = process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET;

  beforeEach(async () => {
    process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET = "test-gh-fast-research";
    dir = await mkdtemp(join(tmpdir(), "gh-sep-"));
  });
  afterEach(async () => {
    if (prevBucket == null) delete process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET;
    else process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET = prevBucket;
    await rm(dir, { recursive: true, force: true });
  });

  type Snap = Partial<MicroLiveSessionState> & {
    researchSessionConnected: boolean;
    liveConnected: boolean;
    healthReasons: string[];
  };

  function makeFakeSession(getSnap: () => Snap) {
    return {
      onSpotForFast: () => () => undefined,
      onDepthForFast: () => () => undefined,
      async getState(): Promise<MicroLiveSessionState> {
        const s = getSnap();
        return {
          connectionState: s.liveConnected
            ? "LIVE_CONNECTED"
            : "LIVE_NOT_CONNECTED",
          liveConnected: s.liveConnected,
          transportConnected: s.transportConnected ?? true,
          transportAuthenticated: s.transportAuthenticated ?? true,
          researchSessionConnected: s.researchSessionConnected,
          credentialsConfigured: true,
          applicationAuthenticated: true,
          accountAuthenticated: true,
          configuredAccountAuthorized: true,
          authorizedAccountCount: 1,
          symbol: {
            symbol: "XAUUSD",
            symbolId: "41",
            symbolName: "XAUUSD",
            digits: 2,
            pipPosition: 1,
            environment: "DEMO",
            resolvedAt: new Date().toISOString()
          },
          spotSubscribed: s.spotSubscribed ?? true,
          spotSubscribedAt: null,
          lastSpotEventAt: null,
          depthSubscribed: s.depthSubscribed ?? true,
          depthSubscribedAt: null,
          lastDepthEventAt: null,
          lastQuote: null,
          lastQuoteTs: null,
          quoteAgeMs: s.quoteAgeMs ?? null,
          lastCompletedM1Ts: null,
          lastCompletedM5Ts: null,
          lastCompletedM15Ts: null,
          lastConnectedAt: null,
          lastDisconnectedAt: s.lastDisconnectedAt ?? null,
          reconnectAttempts: s.reconnectAttempts ?? 0,
          lastErrorCode: s.lastErrorCode ?? null,
          healthReasons: s.healthReasons,
          collectorHeartbeatAt: null,
          m1CompletedEvents: 0,
          subscribeSpotsCallCount: 1,
          subscribeDepthCallCount: 1
        };
      },
      async disconnect() {
        /* no-op */
      },
      async connect() {
        /* no-op */
      }
    };
  }

  async function bootRuntime(snap: { current: Snap }) {
    const rt = new GoldHunterFastResearchCaptureRuntime({
      collectDir: dir,
      gcsBucket: "test-gh-fast-research",
      campaignMode: true,
      heartbeatEveryMs: 60_000,
      sessionPollEveryMs: 60_000,
      runtimeSha: "feed-sep-test-sha".padEnd(40, "0")
    });
    await rt.start();
    const session = makeFakeSession(() => snap.current);
    rt.attachSession(session as never, SCOPE_RAW);
    await rt.syncSessionStateForTests("attach");
    return rt;
  }

  it("6-10. quiet feed 21s/27s/>30s/44.999s: no disconnect/resync/transport reconnect", async () => {
    const snap = {
      current: {
        researchSessionConnected: true,
        liveConnected: true,
        healthReasons: [] as string[],
        quoteAgeMs: 0
      }
    };
    const rt = await bootRuntime(snap);
    const bridge = rt.getBridge()!;
    const baseDisconnect = bridge.getDisconnectResyncCount();
    const baseResync = bridge.getResyncCount();

    for (const age of [21_000, 27_000, 30_001, 44_999]) {
      snap.current = {
        researchSessionConnected: true,
        liveConnected: false, // strict fails at quote_stale boundary
        healthReasons: age > MICRO_QUOTE_MAX_AGE_MS ? ["quote_stale"] : [],
        quoteAgeMs: age
      };
      await rt.syncSessionStateForTests("session_poll");
      expect(bridge.health().connectionState).toBe("CONNECTED");
      expect(bridge.getDisconnectResyncCount()).toBe(baseDisconnect);
      expect(bridge.getResyncCount()).toBe(baseResync);
      expect(rt.health().transportSessionState).toBe("CONNECTED");
    }

    // Soft stale decision at 27s — no transport reconnect
    const soft = decideResearchStaleReconnect({
      nowMs: 1,
      connectionState: "CONNECTED",
      spotAgeMs: 27_000,
      depthAgeMs: 27_000,
      reconnectInFlight: false,
      lastStaleFeedReconnectAttemptMs: null,
      staleFeedBackoffIndex: 0
    });
    expect(soft.action).toBe("SOFT_STALE_ONLY");

    // 44.999 — still no hard reconnect
    const almost = decideResearchStaleReconnect({
      nowMs: 1,
      connectionState: "CONNECTED",
      spotAgeMs: 44_999,
      depthAgeMs: 44_999,
      reconnectInFlight: false,
      lastStaleFeedReconnectAttemptMs: null,
      staleFeedBackoffIndex: 0
    });
    expect(almost.action).toBe("SOFT_STALE_ONLY");

    await rt.stop();
  });

  it("10. >45s BOTH stale → SCHEDULE_STALE_FEED_RECONNECT (not transport)", () => {
    const d = decideResearchStaleReconnect({
      nowMs: 1,
      connectionState: "CONNECTED",
      spotAgeMs: 45_001,
      depthAgeMs: 45_001,
      reconnectInFlight: false,
      lastStaleFeedReconnectAttemptMs: null,
      staleFeedBackoffIndex: 0
    });
    expect(d.action).toBe("SCHEDULE_STALE_FEED_RECONNECT");
    expect(d.reason).toBe("stale_feed");
    expect(GH_FAST_RESEARCH_SOFT_STALE_MS).toBe(20_000);
    expect(GH_FAST_RESEARCH_HARD_STALE_RECONNECT_MS).toBe(45_000);
  });

  it("11. M1-stale alone does not noteDisconnect", async () => {
    const snap = {
      current: {
        researchSessionConnected: true,
        liveConnected: false,
        healthReasons: ["m1_stale"]
      }
    };
    const rt = await bootRuntime(snap);
    const bridge = rt.getBridge()!;
    const base = bridge.getDisconnectResyncCount();
    await rt.syncSessionStateForTests("session_poll");
    expect(bridge.getDisconnectResyncCount()).toBe(base);
    expect(bridge.health().connectionState).toBe("CONNECTED");
    await rt.stop();
  });

  it("12. collector_heartbeat_stale alone does not noteDisconnect", async () => {
    const snap = {
      current: {
        researchSessionConnected: true,
        liveConnected: false,
        healthReasons: ["collector_heartbeat_stale", "quote_stale"]
      }
    };
    const rt = await bootRuntime(snap);
    const bridge = rt.getBridge()!;
    const base = bridge.getDisconnectResyncCount();
    await rt.syncSessionStateForTests("session_poll");
    expect(bridge.getDisconnectResyncCount()).toBe(base);
    expect(bridge.health().connectionState).toBe("CONNECTED");
    await rt.stop();
  });

  it("15. genuine transport loss notes disconnect once", async () => {
    const snap = {
      current: {
        researchSessionConnected: true,
        liveConnected: true,
        healthReasons: [] as string[]
      }
    };
    const rt = await bootRuntime(snap);
    const bridge = rt.getBridge()!;
    const base = bridge.getDisconnectResyncCount();
    snap.current = {
      researchSessionConnected: false,
      liveConnected: false,
      healthReasons: ["transport_disconnected"],
      transportConnected: false,
      spotSubscribed: false,
      depthSubscribed: false,
      lastErrorCode: "transport_disconnected"
    };
    await rt.syncSessionStateForTests("session_poll");
    expect(bridge.getDisconnectResyncCount()).toBe(base + 1);
    expect(bridge.health().connectionState).toBe("DISCONNECTED");
    // Duplicate poll must not double-count
    await rt.syncSessionStateForTests("session_poll");
    expect(bridge.getDisconnectResyncCount()).toBe(base + 1);
    await rt.stop();
  });

  it("14. detachSession + poll does not duplicate RESYNC", async () => {
    const snap = {
      current: {
        researchSessionConnected: true,
        liveConnected: true,
        healthReasons: [] as string[]
      }
    };
    const rt = await bootRuntime(snap);
    const bridge = rt.getBridge()!;
    const before = bridge.getDisconnectResyncCount();
    rt.detachSession();
    expect(bridge.getDisconnectResyncCount()).toBe(before + 1);
    // Poll with no session — no-op; if session still present would use snap
    await rt.syncSessionStateForTests("session_poll");
    expect(bridge.getDisconnectResyncCount()).toBe(before + 1);
    await rt.stop();
  });

  it("13. 20-minute quiet market simulation: no ~30s reconnect storm", () => {
    const soft = GH_FAST_RESEARCH_SOFT_STALE_MS;
    const hard = GH_FAST_RESEARCH_HARD_STALE_RECONNECT_MS;
    expect([...GH_FAST_RESEARCH_STALE_FEED_BACKOFF_MS]).toEqual([
      120_000, 300_000, 900_000
    ]);

    let now = 0;
    let lastStaleAttempt: number | null = null;
    let backoffIndex = 0;
    let staleSchedules = 0;
    let transportSchedules = 0;
    const step = 5_000;
    const horizon = 20 * 60_000;
    const spotAge = () => now; // silent from t=0
    const depthAge = () => now;

    for (; now <= horizon; now += step) {
      const d = decideResearchStaleReconnect({
        nowMs: now,
        connectionState: "CONNECTED", // transport stays up
        spotAgeMs: spotAge() >= soft ? spotAge() : spotAge(),
        depthAgeMs: depthAge() >= soft ? depthAge() : depthAge(),
        softStaleMs: soft,
        hardStaleReconnectMs: hard,
        reconnectInFlight: false,
        lastStaleFeedReconnectAttemptMs: lastStaleAttempt,
        staleFeedBackoffIndex: backoffIndex
      });
      if (d.action === "SCHEDULE_TRANSPORT_RECONNECT") {
        transportSchedules += 1;
      }
      if (d.action === "SCHEDULE_STALE_FEED_RECONNECT") {
        staleSchedules += 1;
        lastStaleAttempt = now;
        backoffIndex = Math.min(backoffIndex + 1, 2);
      }
    }

    expect(transportSchedules).toBe(0);
    // First at ~45s, then backoff 2m→5m→15m. Within 20m quiet: a few stale
    // reconnects only — never a ~30s storm (20min/30s ≈ 40).
    expect(staleSchedules).toBeGreaterThanOrEqual(2);
    expect(staleSchedules).toBeLessThanOrEqual(4);
    expect(staleSchedules).toBeLessThan(10);
    expect(staleFeedBackoffMs(0)).toBe(120_000);
    expect(staleFeedBackoffMs(1)).toBe(300_000);
    expect(staleFeedBackoffMs(2)).toBe(900_000);
  });

  it("16. DISCONNECTED bridge state still schedules transport reconnect", () => {
    const d = decideResearchStaleReconnect({
      nowMs: 1,
      connectionState: "DISCONNECTED",
      spotAgeMs: 5_000,
      depthAgeMs: 5_000,
      reconnectInFlight: false,
      lastStaleFeedReconnectAttemptMs: null,
      staleFeedBackoffIndex: 0
    });
    expect(d.action).toBe("SCHEDULE_TRANSPORT_RECONNECT");
  });

  it("feedState/transportSessionState telemetry", async () => {
    const bridge = new ResearchIngestBridge({
      localDir: dir + "-tel",
      gcsBucket: null,
      freshnessLimitMs: 20_000
    });
    bridge.setConnectionState("CONNECTED", "t");
    bridge.setSubscriptionFlags(true, true);
    const t0 = 10_000_000;
    bridge.ingestSpot({ bid: rel(3400), ask: rel(3400.1) }, t0);
    bridge.ingestDepth(
      {
        newQuotes: [
          { id: "b1", size: "100", bid: String(rel(3400)), ask: null },
          { id: "a1", size: "100", bid: null, ask: String(rel(3400.1)) }
        ],
        deletedQuotes: []
      },
      t0 + 1
    );
    await bridge.drainForTests();
    const live = bridge.health(t0 + 100);
    expect(live.transportSessionState).toBe("CONNECTED");
    expect(live.feedState).toBe("LIVE");

    const stale = bridge.health(t0 + 25_000);
    expect(stale.transportSessionState).toBe("CONNECTED");
    expect(stale.feedState).toBe("STALE");
  });
});
