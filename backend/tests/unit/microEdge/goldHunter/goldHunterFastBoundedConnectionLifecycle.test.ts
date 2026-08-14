/**
 * GOLD HUNTER FAST — bounded connection lifecycle hardening tests.
 * Fake transports only — no real broker orders.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  RealMicroCTraderTransport,
  type MicroTransportFactory
} from "../../../../src/services/microEdge/marketData/microCTraderTransport";
import type { MicroCTraderCredentials } from "../../../../src/services/microEdge/marketData/microCTraderAuth";
import type { MicroLiveMarketSession } from "../../../../src/services/microEdge/marketData/liveSession";
import { ReferencePaperSimulator } from "../../../../src/services/microEdge/goldHunter/fast/research/referencePaperSimulator";
import type { ResearchSpecialistObservation } from "../../../../src/services/microEdge/goldHunter/fast/research/researchTypes";
import {
  GH_FAST_RESEARCH_RECONNECT_ATTEMPT_TIMEOUT_MS,
  GH_FAST_RESEARCH_CONNECT_FAILURE_BACKOFF_MS
} from "../../../../src/services/microEdge/goldHunter/fast/research/researchReconnectOrchestrator";
import {
  GH_FAST_RESEARCH_HARD_STALE_RECONNECT_MS,
  GH_FAST_RESEARCH_SOFT_STALE_MS,
  GH_FAST_RESEARCH_STALE_FEED_BACKOFF_MS
} from "../../../../src/services/microEdge/goldHunter/fast/research/researchStaleReconnectPolicy";
import {
  GH_FAST_SUSTAINED_CROSS_RECOVERY_COOLDOWN_MS,
  GH_FAST_SUSTAINED_CROSS_RECOVERY_MS
} from "../../../../src/services/microEdge/goldHunter/fast/depthRecovery";
import { researchSafetyIdentity } from "../../../../src/services/microEdge/goldHunter/fast/research/nullExecutionGuard";

const creds: MicroCTraderCredentials = {
  clientId: "cid",
  clientSecret: "sec",
  accessToken: "tok",
  refreshToken: "ref",
  accountId: "1001",
  environment: "DEMO"
};

type FakeSess = {
  id: number;
  closed: boolean;
  cancelled: boolean;
  connectCount: number;
  disconnectCount: number;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  onSpotForFast: (l: (p: Record<string, unknown>) => void) => () => void;
  onDepthForFast: (l: (p: Record<string, unknown>) => void) => () => void;
  getState: () => Promise<Record<string, unknown>>;
};

function makeFakeSession(
  id: number,
  connectImpl: (self: FakeSess) => Promise<void>,
  disconnectImpl?: (self: FakeSess) => Promise<void>
): FakeSess {
  const self: FakeSess = {
    id,
    closed: false,
    cancelled: false,
    connectCount: 0,
    disconnectCount: 0,
    async connect() {
      self.connectCount += 1;
      await connectImpl(self);
    },
    async disconnect() {
      self.disconnectCount += 1;
      self.cancelled = true;
      self.closed = true;
      if (disconnectImpl) await disconnectImpl(self);
    },
    onSpotForFast: () => () => undefined,
    onDepthForFast: () => () => undefined,
    async getState() {
      return {
        connectionState: self.closed ? "DISCONNECTED" : "CONNECTED",
        liveConnected: !self.closed,
        credentialsConfigured: true,
        applicationAuthenticated: !self.closed,
        accountAuthenticated: !self.closed,
        configuredAccountAuthorized: true,
        authorizedAccountCount: 1,
        symbol: { symbolId: "1", symbolName: "XAUUSD" },
        spotSubscribed: !self.closed,
        spotSubscribedAt: null,
        lastSpotEventAt: null,
        depthSubscribed: !self.closed,
        depthSubscribedAt: null,
        lastDepthEventAt: null,
        lastQuote: null,
        lastQuoteTs: null,
        quoteAgeMs: null,
        lastCompletedM1Ts: null,
        lastCompletedM5Ts: null,
        lastCompletedM15Ts: null,
        lastConnectedAt: null,
        lastDisconnectedAt: null,
        reconnectAttempts: 0,
        lastErrorCode: null,
        healthReasons: [],
        collectorHeartbeatAt: null,
        m1CompletedEvents: 0,
        subscribeSpotsCallCount: 0,
        subscribeDepthCallCount: 0
      };
    }
  };
  return self;
}

describe("bounded connection lifecycle hardening", () => {
  const prevBucket = process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET;
  let dir: string;

  beforeEach(async () => {
    process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET = "test-gh-fast-research";
    dir = await mkdtemp(join(tmpdir(), "gh-life-"));
  });

  afterEach(async () => {
    if (prevBucket == null) {
      delete process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET;
    } else {
      process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET = prevBucket;
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("thresholds unchanged + connect failure backoff", () => {
    expect(GH_FAST_RESEARCH_SOFT_STALE_MS).toBe(20_000);
    expect(GH_FAST_RESEARCH_HARD_STALE_RECONNECT_MS).toBe(45_000);
    expect([...GH_FAST_RESEARCH_STALE_FEED_BACKOFF_MS]).toEqual([
      120_000, 300_000, 900_000
    ]);
    expect(GH_FAST_RESEARCH_RECONNECT_ATTEMPT_TIMEOUT_MS).toBe(30_000);
    expect([...GH_FAST_RESEARCH_CONNECT_FAILURE_BACKOFF_MS]).toEqual([
      2_500, 5_000, 15_000, 30_000, 60_000
    ]);
    expect(GH_FAST_SUSTAINED_CROSS_RECOVERY_MS).toBe(10_000);
    expect(GH_FAST_SUSTAINED_CROSS_RECOVERY_COOLDOWN_MS).toBe(30_000);
  });

  it("forensic artifact does not overstate open vs auth", () => {
    const raw = readFileSync(
      join(
        process.cwd(),
        "src/services/microEdge/goldHunter/fast/artifacts/v2-phase2b-research-deploy/GH_FAST_63f53bc_RECONNECT_STALL_FORENSIC.json"
      ),
      "utf8"
    );
    const j = JSON.parse(raw) as { rootCauseClass: string };
    expect(j.rootCauseClass).toContain("open vs auth sub-phase not separable");
    expect(j.rootCauseClass).not.toMatch(/^A transport\.open hung$/);
  });

  it("1-3. initial connection timeout then retry succeeds", async () => {
    const { GoldHunterFastResearchCaptureProcess } = await import(
      "../../../../src/services/microEdge/runtime/fastResearchCaptureProcess"
    );
    const proc = new GoldHunterFastResearchCaptureProcess({
      gcsBucket: "test-gh-fast-research",
      runtimeSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      credentials: creds,
      allowLocalInjectedCredentials: true
    });
    await proc.prepareRuntimeForTests(dir);
    proc.setBypassBrokerScopeForTests(true);
    proc.setReconnectAttemptTimeoutMsForTests(60);

    let resolveHang: (() => void) | null = null;
    let n = 0;
    const sessions: FakeSess[] = [];
    proc.setSessionFactoryForTests(() => {
      n += 1;
      const id = n;
      const s = makeFakeSession(id, async (self) => {
        if (id === 1) {
          await new Promise<void>((r) => {
            resolveHang = r;
          });
          if (self.cancelled) {
            throw Object.assign(new Error("cancelled"), { code: "cancelled" });
          }
        }
      });
      sessions.push(s);
      return s as unknown as MicroLiveMarketSession;
    });

    const first = proc.runBoundedConnectionAttemptForTests({ kind: "startup" });
    await new Promise((r) => setTimeout(r, 100));
    const tel1 = proc.getReconnectTelemetryForTests();
    expect(tel1.reconnectInFlight).toBe(false);
    expect(tel1.reconnectPhase).toBe("TIMED_OUT");
    expect(tel1.lastReconnectFailurePhase).toBe("CONNECTING_SESSION");
    expect(sessions[0]?.closed).toBe(true);

    // Later retry succeeds
    const ok = await proc.runBoundedConnectionAttemptForTests({
      kind: "startup"
    });
    expect(ok).toBe(true);
    expect(proc.getActiveSessionForTests()).toBe(
      sessions[1] as unknown as MicroLiveMarketSession
    );
    const phase = proc.getReconnectTelemetryForTests().reconnectPhase;
    expect(["WAITING_FOR_FRESH_DATA", "IDLE"]).toContain(phase);

    // Late resolve of attempt 1 must not steal session
    resolveHang?.();
    await new Promise((r) => setTimeout(r, 30));
    expect(proc.getActiveSessionForTests()).toBe(
      sessions[1] as unknown as MicroLiveMarketSession
    );

    await proc.stop();
  });

  it("5+13. old session disconnect hang times out with correct phase", async () => {
    const { GoldHunterFastResearchCaptureProcess } = await import(
      "../../../../src/services/microEdge/runtime/fastResearchCaptureProcess"
    );
    const proc = new GoldHunterFastResearchCaptureProcess({
      gcsBucket: "test-gh-fast-research",
      runtimeSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      credentials: creds,
      allowLocalInjectedCredentials: true
    });
    await proc.prepareRuntimeForTests(dir);
    proc.setBypassBrokerScopeForTests(true);
    proc.setReconnectAttemptTimeoutMsForTests(50);
    proc.setSkipSessionConnectForTests(true);

    const hung = makeFakeSession(
      0,
      async () => undefined,
      async () =>
        new Promise<void>(() => {
          /* never */
        })
    );
    proc.setActiveSessionForTests(hung as unknown as MicroLiveMarketSession);

    const t0 = Date.now();
    await proc.runBoundedConnectionAttemptForTests({
      kind: "reconnect",
      reason: "stale_feed"
    });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(2_000);
    const tel = proc.getReconnectTelemetryForTests();
    expect(tel.reconnectInFlight).toBe(false);
    expect(tel.reconnectPhase).toBe("TIMED_OUT");
    expect(tel.lastReconnectFailurePhase).toBe("DISCONNECTING_OLD_SESSION");
    expect(tel.lastReconnectFailureCode).toBe("RESEARCH_RECONNECT_TIMED_OUT");

    // stop must not hang forever on hung disconnect
    const stopP = proc.stop();
    const stopRace = await Promise.race([
      stopP.then(() => "ok" as const),
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 3_000))
    ]);
    expect(stopRace).toBe("ok");
  });

  it("6-10. late old candidate cannot attach; newer session preserved; no leak", async () => {
    const { GoldHunterFastResearchCaptureProcess } = await import(
      "../../../../src/services/microEdge/runtime/fastResearchCaptureProcess"
    );
    const proc = new GoldHunterFastResearchCaptureProcess({
      gcsBucket: "test-gh-fast-research",
      runtimeSha: "cccccccccccccccccccccccccccccccccccccccc",
      credentials: creds,
      allowLocalInjectedCredentials: true
    });
    await proc.prepareRuntimeForTests(dir);
    proc.setBypassBrokerScopeForTests(true);
    proc.setReconnectAttemptTimeoutMsForTests(40);

    const resolvers: Array<() => void> = [];
    const sessions: FakeSess[] = [];
    let n = 0;
    proc.setSessionFactoryForTests(() => {
      n += 1;
      const id = n;
      const s = makeFakeSession(id, async (self) => {
        if (id === 1) {
          await new Promise<void>((r) => resolvers.push(r));
          if (self.cancelled) {
            throw Object.assign(new Error("cancelled"), { code: "cancelled" });
          }
        }
      });
      sessions.push(s);
      return s as unknown as MicroLiveMarketSession;
    });

    // Attempt 1 times out
    await proc.runBoundedConnectionAttemptForTests({
      kind: "reconnect",
      reason: "connect_failed"
    });
    expect(sessions[0]?.closed).toBe(true);
    expect(proc.getReconnectTelemetryForTests().reconnectInFlight).toBe(false);

    // Attempt 2 succeeds immediately
    const ok = await proc.runBoundedConnectionAttemptForTests({
      kind: "reconnect",
      reason: "connect_failed"
    });
    expect(ok).toBe(true);
    expect(proc.getActiveSessionForTests()).toBe(
      sessions[1] as unknown as MicroLiveMarketSession
    );

    // Late resolve attempt 1
    resolvers[0]?.();
    await new Promise((r) => setTimeout(r, 40));
    expect(proc.getActiveSessionForTests()).toBe(
      sessions[1] as unknown as MicroLiveMarketSession
    );
    expect(proc.getCandidateSessionsCreatedForTests()).toBe(2);

    // Repeated timeouts do not accumulate open candidates
    proc.setHangConnectOnceForTests(true);
    proc.setSessionFactoryForTests(null);
    for (let i = 0; i < 3; i++) {
      await proc.runBoundedConnectionAttemptForTests({
        kind: "reconnect",
        reason: "connect_failed"
      });
      expect(proc.isReconnectInFlight()).toBe(false);
    }
    await proc.stop();
  });

  it("11. VERIFYING_SCOPE failure records correct failure phase", async () => {
    const { GoldHunterFastResearchCaptureProcess } = await import(
      "../../../../src/services/microEdge/runtime/fastResearchCaptureProcess"
    );
    const proc = new GoldHunterFastResearchCaptureProcess({
      gcsBucket: "test-gh-fast-research",
      runtimeSha: "dddddddddddddddddddddddddddddddddddddddd",
      credentials: creds,
      allowLocalInjectedCredentials: true
    });
    await proc.prepareRuntimeForTests(dir);
    proc.setScopeVerifyFailCodeForTests("SCOPE_VERIFY_FAILED");
    proc.setReconnectAttemptTimeoutMsForTests(5_000);
    await proc.runBoundedConnectionAttemptForTests({ kind: "startup" });
    const tel = proc.getReconnectTelemetryForTests();
    expect(tel.reconnectPhase).toBe("FAILED");
    expect(tel.lastReconnectFailurePhase).toBe("VERIFYING_SCOPE");
    expect(tel.lastReconnectFailureCode).toBe("SCOPE_VERIFY_FAILED");
    await proc.stop();
  });

  it("12. CONNECTING_SESSION failure records correct failure phase", async () => {
    const { GoldHunterFastResearchCaptureProcess } = await import(
      "../../../../src/services/microEdge/runtime/fastResearchCaptureProcess"
    );
    const proc = new GoldHunterFastResearchCaptureProcess({
      gcsBucket: "test-gh-fast-research",
      runtimeSha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      credentials: creds,
      allowLocalInjectedCredentials: true
    });
    await proc.prepareRuntimeForTests(dir);
    proc.setBypassBrokerScopeForTests(true);
    proc.setSessionFactoryForTests(
      () =>
        makeFakeSession(1, async () => {
          throw Object.assign(new Error("boom"), {
            code: "transport_disconnected"
          });
        }) as unknown as MicroLiveMarketSession
    );
    await proc.runBoundedConnectionAttemptForTests({ kind: "startup" });
    const tel = proc.getReconnectTelemetryForTests();
    expect(tel.reconnectPhase).toBe("FAILED");
    expect(tel.lastReconnectFailurePhase).toBe("CONNECTING_SESSION");
    await proc.stop();
  });

  it("14-18. WAITING_FOR_FRESH_DATA until both feeds; mutex not held", async () => {
    const { GoldHunterFastResearchCaptureProcess } = await import(
      "../../../../src/services/microEdge/runtime/fastResearchCaptureProcess"
    );
    const proc = new GoldHunterFastResearchCaptureProcess({
      gcsBucket: "test-gh-fast-research",
      runtimeSha: "ffffffffffffffffffffffffffffffffffffffff",
      credentials: creds,
      allowLocalInjectedCredentials: true
    });
    await proc.prepareRuntimeForTests(dir);
    proc.setBypassBrokerScopeForTests(true);
    proc.setSessionFactoryForTests(
      () =>
        makeFakeSession(1, async () => undefined) as unknown as MicroLiveMarketSession
    );
    const ok = await proc.runBoundedConnectionAttemptForTests({
      kind: "startup"
    });
    expect(ok).toBe(true);
    expect(proc.isReconnectInFlight()).toBe(false);
    expect(proc.getReconnectTelemetryForTests().reconnectPhase).toBe(
      "WAITING_FOR_FRESH_DATA"
    );

    const rt = proc.getRuntime()!;
    // Spot only
    rt.ingestSpotForTests({
      bid: 3400 * 100_000,
      ask: 3400.1 * 100_000
    });
    await rt.drainForTests();
    proc.refreshFeedRestorePhaseForTests();
    expect(proc.getReconnectTelemetryForTests().reconnectPhase).toBe(
      "WAITING_FOR_FRESH_DATA"
    );

    // Both fresh
    rt.ingestDepthForTests({
      newQuotes: [
        { id: "b1", size: "100", bid: String(3400 * 100_000), ask: null },
        { id: "a1", size: "100", bid: null, ask: String(3400.1 * 100_000) }
      ],
      deletedQuotes: []
    });
    await rt.drainForTests();
    proc.refreshFeedRestorePhaseForTests();
    expect(proc.getReconnectTelemetryForTests().reconnectPhase).toBe("IDLE");
    await proc.stop();
  });

  it("7. timed-out RealMicroCTraderTransport closes pending conn", async () => {
    let openReleased = false;
    let closeCount = 0;
    let resolveOpen: (() => void) | null = null;
    const factory: MicroTransportFactory = () => ({
      open: () =>
        new Promise((resolve) => {
          resolveOpen = () => {
            openReleased = true;
            resolve(undefined);
          };
        }),
      close: async () => {
        closeCount += 1;
      },
      sendCommand: async () => ({}),
      on: () => undefined,
      removeListener: () => undefined
    });
    const t = new RealMicroCTraderTransport(creds, factory);
    const deadlineAtMs = Date.now() + 40;
    await expect(
      t.connect({ deadlineAtMs, nowMs: () => Date.now() })
    ).rejects.toMatchObject({ code: "transport_connect_timeout" });
    expect(t.isConnected()).toBe(false);
    expect(t.hasPendingConnectionForTests()).toBe(false);
    expect(closeCount).toBeGreaterThanOrEqual(1);
    // Late open must not authenticate
    resolveOpen?.();
    await new Promise((r) => setTimeout(r, 20));
    expect(openReleased).toBe(true);
    expect(t.isConnected()).toBe(false);
    expect(t.isApplicationAuthenticated()).toBe(false);
  });

  it("26. SCOPE_VIEW / mutation zero", () => {
    const id = researchSafetyIdentity();
    expect(id.brokerRequests).toBe(0);
    expect(id.brokerOrders).toBe(0);
    expect(id.shadowOrders).toBe(0);
    expect(id.executionAdapter).toBe("NONE");
    expect(id.mutationSurface).toBe("NONE");
  });
});

describe("trades/hour wall-clock math", () => {
  it("23. rate decreases when wall clock advances with frozen lastTickTs", () => {
    let wall = 1_000_000;
    const paper = new ReferencePaperSimulator({ nowMs: () => wall });
    const selected: ResearchSpecialistObservation = {
      setup: "B_FAST_BREAKOUT",
      eligible: true,
      candidateSide: "BUY",
      rawQuality: 1,
      failedConditions: [],
      selectedCandidate: true,
      depthValidity: "DEPTH_VALID",
      derivedDataContaminated: false
    };

    paper.onMarketTick({
      bid: 3400,
      ask: 3400.1,
      tsMs: wall,
      receiveSeq: 1,
      specialists: [selected],
      features: null,
      dataOk: true
    });
    // Close via dataOk false
    paper.onMarketTick({
      bid: 3400.2,
      ask: 3400.3,
      tsMs: wall + 1_000,
      receiveSeq: 2,
      specialists: null,
      features: null,
      dataOk: false
    });
    expect(paper.summary().totalClosedTrades).toBe(1);
    const frozenLastTick = wall + 1_000;
    const rate1 = paper.summary().paperTradesPerRuntimeHour!;
    expect(rate1).toBeGreaterThan(0);

    // Advance WALL CLOCK only — no new ticks (lastTickTs frozen)
    wall += 3_600_000; // +1 hour
    const rate2 = paper.summary().paperTradesPerRuntimeHour!;
    expect(rate2).toBeLessThan(rate1);
    // ~1 trade / ~1 hour from start → near 1.0 (not lastTick-based ~3600)
    expect(rate2).toBeLessThan(10);
    expect(frozenLastTick).toBe(1_001_000);
    expect(paper.summary().tradesPerHourLabel).toBe(
      "PAPER TRADES / WALL-CLOCK RUNTIME HOUR"
    );
  });
});
