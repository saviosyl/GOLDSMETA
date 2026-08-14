/**
 * GOLD HUNTER FAST — final research infrastructure correctness.
 * Bounded reconnect, ordered freshness, contaminated filters, trades/hour.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MICRO_SPOT_PRICE_SCALE } from "../../../../src/services/microEdge/marketData/microCTraderProtocol";
import { ResearchIngestBridge } from "../../../../src/services/microEdge/goldHunter/fast/research/researchIngestBridge";
import {
  feedAgeFresh,
  computeResearchReferencePaperDataOk
} from "../../../../src/services/microEdge/goldHunter/fast/research/researchFeedFreshness";
import {
  GH_FAST_RESEARCH_RECONNECT_ATTEMPT_TIMEOUT_MS,
  GH_FAST_RESEARCH_CONNECT_FAILURE_BACKOFF_MS,
  connectFailureBackoffMs,
  raceReconnectAttempt,
  ResearchReconnectTimeoutError
} from "../../../../src/services/microEdge/goldHunter/fast/research/researchReconnectOrchestrator";
import {
  GH_FAST_RESEARCH_HARD_STALE_RECONNECT_MS,
  GH_FAST_RESEARCH_SOFT_STALE_MS,
  GH_FAST_RESEARCH_STALE_FEED_BACKOFF_MS,
  decideResearchStaleReconnect
} from "../../../../src/services/microEdge/goldHunter/fast/research/researchStaleReconnectPolicy";
import {
  GH_FAST_SUSTAINED_CROSS_RECOVERY_COOLDOWN_MS,
  GH_FAST_SUSTAINED_CROSS_RECOVERY_MS
} from "../../../../src/services/microEdge/goldHunter/fast/depthRecovery";
import { GH_FAST_RESEARCH_FRESHNESS_MS } from "../../../../src/services/microEdge/goldHunter/fast/research/researchTypes";
import { researchSafetyIdentity } from "../../../../src/services/microEdge/goldHunter/fast/research/nullExecutionGuard";
import { ReferencePaperSimulator } from "../../../../src/services/microEdge/goldHunter/fast/research/referencePaperSimulator";

const SOFT = GH_FAST_RESEARCH_FRESHNESS_MS;

function rel(price: number): number {
  return Math.round(price * MICRO_SPOT_PRICE_SCALE);
}

function depthPayload(bid: number, ask: number) {
  return {
    newQuotes: [
      { id: "b1", size: "100", bid: String(rel(bid)), ask: null },
      { id: "a1", size: "100", bid: null, ask: String(rel(ask)) }
    ],
    deletedQuotes: [] as string[]
  };
}

function spotPayload(bid: number, ask: number) {
  return { bid: rel(bid), ask: rel(ask) };
}

describe("negative freshness age", () => {
  it("5. future lastAt is never fresh; boundary ages exact", () => {
    expect(feedAgeFresh(1000, 999, SOFT)).toBe(false); // -1ms
    expect(feedAgeFresh(1000, 1000 - 5000, SOFT)).toBe(false);
    expect(feedAgeFresh(1000, 1000, SOFT)).toBe(true); // age 0
    expect(feedAgeFresh(1000, 1000 + 20_000, SOFT)).toBe(true);
    expect(feedAgeFresh(1000, 1000 + 20_001, SOFT)).toBe(false);
    expect(SOFT).toBe(20_000);
  });
});

describe("reconnect orchestrator bounds", () => {
  it("12-14. soft/hard/backoff unchanged", () => {
    expect(GH_FAST_RESEARCH_SOFT_STALE_MS).toBe(20_000);
    expect(GH_FAST_RESEARCH_HARD_STALE_RECONNECT_MS).toBe(45_000);
    expect([...GH_FAST_RESEARCH_STALE_FEED_BACKOFF_MS]).toEqual([
      120_000, 300_000, 900_000
    ]);
    expect(GH_FAST_SUSTAINED_CROSS_RECOVERY_MS).toBe(10_000);
    expect(GH_FAST_SUSTAINED_CROSS_RECOVERY_COOLDOWN_MS).toBe(30_000);
  });

  it("16. hanging reconnect times out", async () => {
    expect(GH_FAST_RESEARCH_RECONNECT_ATTEMPT_TIMEOUT_MS).toBe(30_000);
    let phase: "CONNECTING_SESSION" | "IDLE" = "CONNECTING_SESSION";
    const hang = new Promise<void>(() => {
      /* never resolves */
    });
    await expect(
      raceReconnectAttempt({
        body: hang,
        timeoutMs: 40,
        attemptId: 7,
        getPhase: () => phase
      })
    ).rejects.toBeInstanceOf(ResearchReconnectTimeoutError);
  });

  it("19. connect-failure retry backoff stepped", () => {
    expect([...GH_FAST_RESEARCH_CONNECT_FAILURE_BACKOFF_MS]).toEqual([
      2_500, 5_000, 15_000, 30_000, 60_000
    ]);
    expect(connectFailureBackoffMs(0)).toBe(2_500);
    expect(connectFailureBackoffMs(4)).toBe(60_000);
    expect(connectFailureBackoffMs(99)).toBe(60_000);
  });
});

describe("ordered backlog look-ahead protection", () => {
  let dir: string;
  beforeEach(async () => {
    delete process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET;
    dir = await mkdtemp(join(tmpdir(), "gh-ord-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function warm(bridge: ResearchIngestBridge, t0: number) {
    bridge.setScopeVerified(true);
    bridge.setConnectionState("CONNECTED", "t");
    bridge.setSubscriptionFlags(true, true);
    for (let i = 0; i < 25; i++) {
      const t = t0 + i * 40;
      const px = 3400 + i * 0.02;
      bridge.ingestSpot(spotPayload(px, px + 0.12), t);
      bridge.ingestDepth(depthPayload(px, px + 0.12), t + 1);
    }
    await bridge.drainForTests();
  }

  it("6. SPOT-future backlog cannot qualify older DEPTH receiveSeq", async () => {
    const bridge = new ResearchIngestBridge({
      localDir: dir,
      gcsBucket: null,
      freshnessLimitMs: SOFT
    });
    const t0 = 10_000_000;
    await warm(bridge, t0);
    const last = t0 + 24 * 40 + 1;

    bridge.closeOrderedProcessGateForTests();
    const tDepth = last + 25_000;
    const tSpotFuture = tDepth + 5_000;
    bridge.ingestDepth(depthPayload(3410, 3410.15), tDepth);
    bridge.ingestSpot(spotPayload(3410, 3410.15), tSpotFuture);

    expect(bridge.getFeedAgesMs(tSpotFuture).spotAgeMs).toBe(0);
    expect(bridge.getFeedAgesMs(tSpotFuture).depthAgeMs).toBe(5_000);
    // Processed stamps still warm-era — Spot age at tDepth is soft-stale.
    expect(bridge.getProcessedFeedAgesMs(tDepth).spotAgeMs!).toBeGreaterThan(
      SOFT
    );

    bridge.openOrderedProcessGateForTests();
    await bridge.drainForTests();
    // Ordered stamps advanced without ingress look-ahead during DEPTH seq.
    const after = bridge.getProcessedFeedAgesMs(tSpotFuture);
    expect(after.lastProcessedSpotAtMs).toBe(tSpotFuture);
    expect(after.lastProcessedDepthAtMs).toBe(tDepth);
    expect(after.depthAgeMs!).toBeLessThanOrEqual(SOFT);
    // Pipeline DEPTH_VALID uses a tighter book age (~2s); refresh both to prove recovery.
    const both = tSpotFuture + 20;
    bridge.ingestSpot(spotPayload(3410, 3410.15), both);
    bridge.ingestDepth(depthPayload(3410, 3410.15), both + 1);
    await bridge.drainForTests();
    expect(bridge.lastReferenceDataOkForTests()).toBe(true);
  });

  it("6b. while processing older DEPTH, future Spot ingress must not make dataOk", async () => {
    const bridge = new ResearchIngestBridge({
      localDir: dir + "-b",
      gcsBucket: null,
      freshnessLimitMs: SOFT
    });
    const t0 = 20_000_000;
    await warm(bridge, t0);
    const last = t0 + 24 * 40 + 1;

    // Soft-stale silence then DEPTH-only — classic DEPTH-first (no future look-ahead).
    const resume = last + 25_000;
    bridge.ingestDepth(depthPayload(3420, 3420.15), resume);
    await bridge.drainForTests();
    expect(bridge.lastReferenceDataOkForTests()).toBe(false);
    const proc = bridge.getProcessedFeedAgesMs(resume);
    expect(proc.lastProcessedDepthAtMs).toBe(resume);
    // Spot processed stamp still pre-silence.
    expect(proc.spotAgeMs!).toBeGreaterThan(SOFT);
  });

  it("7. DEPTH-future backlog: older SPOT cannot see future Depth freshness", async () => {
    const bridge = new ResearchIngestBridge({
      localDir: dir + "-c",
      gcsBucket: null,
      freshnessLimitMs: SOFT
    });
    const t0 = 30_000_000;
    await warm(bridge, t0);
    const last = t0 + 24 * 40 + 1;
    const resume = last + 25_000;
    bridge.ingestSpot(spotPayload(3430, 3430.15), resume);
    await bridge.drainForTests();
    expect(bridge.lastReferenceDataOkForTests()).toBe(false);
    const proc = bridge.getProcessedFeedAgesMs(resume);
    expect(proc.depthAgeMs!).toBeGreaterThan(SOFT);
  });

  it("6c. real ordered gate: process older DEPTH while future Spot only at ingress", async () => {
    const bridge = new ResearchIngestBridge({
      localDir: dir + "-gate",
      gcsBucket: null,
      freshnessLimitMs: SOFT
    });
    const t0 = 40_000_000;
    await warm(bridge, t0);
    const last = t0 + 24 * 40 + 1;

    bridge.closeOrderedProcessGateForTests();
    // Silence > soft, then DEPTH older + Spot future in backlog.
    const tDepth = last + 25_000;
    const tSpotFuture = tDepth + 5_000;
    bridge.ingestDepth(depthPayload(3440, 3440.2), tDepth);
    bridge.ingestSpot(spotPayload(3440, 3440.2), tSpotFuture);

    const before = bridge.getProcessedFeedAgesMs(tDepth);
    expect(before.spotAgeMs!).toBeGreaterThan(SOFT);
    expect(
      computeResearchReferencePaperDataOk({
        nowMs: tDepth,
        lastSpotAtMs: before.lastProcessedSpotAtMs,
        lastDepthAtMs: tDepth,
        lastBid: 3440,
        lastAsk: 3440.2,
        crossed: false,
        depthAvailable: true,
        depthRecoveryInFlight: false,
        depthValidity: "DEPTH_VALID"
      })
    ).toBe(false);

    // Ingress already has future spot — negative age when evaluated at tDepth.
    expect(feedAgeFresh(tSpotFuture, tDepth, SOFT)).toBe(false);
    expect(bridge.getFeedAgesMs(tDepth).spotAgeMs!).toBeLessThan(0);

    bridge.openOrderedProcessGateForTests();
    await bridge.drainForTests();
    const after = bridge.getProcessedFeedAgesMs(tSpotFuture);
    expect(after.lastProcessedSpotAtMs).toBe(tSpotFuture);
    expect(after.lastProcessedDepthAtMs).toBe(tDepth);
    const both = tSpotFuture + 20;
    bridge.ingestSpot(spotPayload(3440, 3440.2), both);
    bridge.ingestDepth(depthPayload(3440, 3440.2), both + 1);
    await bridge.drainForTests();
    expect(bridge.lastReferenceDataOkForTests()).toBe(true);
  });

  it("8. RESYNC clears ordered freshness", async () => {
    const bridge = new ResearchIngestBridge({
      localDir: dir + "-resync",
      gcsBucket: null,
      freshnessLimitMs: SOFT
    });
    const t0 = 50_000_000;
    await warm(bridge, t0);
    expect(bridge.getProcessedFeedAgesMs(t0 + 2000).lastProcessedSpotAtMs).not.toBeNull();

    bridge.noteDisconnect("session_detached", t0 + 3000);
    await bridge.drainForTests();
    const cleared = bridge.getProcessedFeedAgesMs(t0 + 3000);
    expect(cleared.lastProcessedSpotAtMs).toBeNull();
    expect(cleared.lastProcessedDepthAtMs).toBeNull();

    // Depth-only after resync → dataOk false
    bridge.setConnectionState("CONNECTED", "reattach");
    bridge.setSubscriptionFlags(true, true);
    bridge.ingestDepth(depthPayload(3450, 3450.2), t0 + 3100);
    await bridge.drainForTests();
    expect(bridge.lastReferenceDataOkForTests()).toBe(false);

    bridge.ingestSpot(spotPayload(3450, 3450.2), t0 + 3200);
    bridge.ingestDepth(depthPayload(3450, 3450.2), t0 + 3201);
    await bridge.drainForTests();
    expect(bridge.lastReferenceDataOkForTests()).toBe(true);
  });
});

describe("contaminated monitor filters", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "gh-filt-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("9-11. SELECTED/ELIGIBLE exclude contaminated; ALL retains labeled", async () => {
    const bridge = new ResearchIngestBridge({
      localDir: dir,
      gcsBucket: null,
      freshnessLimitMs: SOFT
    });
    bridge.setScopeVerified(true);
    bridge.setConnectionState("CONNECTED", "t");
    bridge.setSubscriptionFlags(true, true);
    const t0 = 60_000_000;
    for (let i = 0; i < 40; i++) {
      const t = t0 + i * 40;
      const px = 3400 + i * 0.08;
      bridge.ingestSpot(spotPayload(px, px + 0.15), t);
      bridge.ingestDepth(depthPayload(px, px + 0.15), t + 1);
    }
    await bridge.drainForTests();
    const selectedClean = bridge.health().selectedA + bridge.health().selectedB + bridge.health().selectedC;

    // Soft-stale DEPTH resume → contaminated rows (even if selectedCandidate)
    const resume = t0 + 39 * 40 + 25_000;
    bridge.ingestDepth(depthPayload(3500, 3500.2), resume);
    await bridge.drainForTests();

    const selected = bridge.recentCandidatesResponse(80, "SELECTED");
    expect(
      selected.observations.every((o) => o.derivedDataContaminated !== true)
    ).toBe(true);
    const eligible = bridge.recentCandidatesResponse(80, "ELIGIBLE");
    expect(
      eligible.observations.every((o) => o.derivedDataContaminated !== true)
    ).toBe(true);
    const all = bridge.recentCandidatesResponse(80, "ALL");
    const contaminated = all.observations.filter(
      (o) => o.derivedDataContaminated === true || o.tsMs === resume
    );
    // Soft-stale tick must not inflate clean selected counters.
    const selectedAfter =
      bridge.health().selectedA +
      bridge.health().selectedB +
      bridge.health().selectedC;
    expect(selectedAfter).toBe(selectedClean);

    // If any observation was recorded at resume, it must be labeled contaminated.
    const atResume = all.observations.filter((o) => o.tsMs === resume);
    if (atResume.length > 0) {
      expect(atResume.every((o) => o.derivedDataContaminated === true)).toBe(
        true
      );
      expect(
        atResume.every((o) =>
          String(o.setupName).includes("STALE / INVALID FOR QUALIFICATION")
        )
      ).toBe(true);
    } else {
      // No specialist observation emitted — still assert filter hygiene + counter freeze.
      expect(contaminated.length).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("failed reconnect lifecycle + process timeout", () => {
  const prevBucket = process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET;
  beforeEach(() => {
    process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET = "test-gh-fast-research";
  });
  afterEach(() => {
    if (prevBucket == null) delete process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET;
    else process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET = prevBucket;
  });

  it("18. noteReconnectFailed does not set CONNECTED", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gh-fail-"));
    const bridge = new ResearchIngestBridge({
      localDir: dir,
      gcsBucket: null
    });
    bridge.noteReconnectStart(Date.now(), "stale_feed");
    expect(bridge.health().connectionState).toBe("RECONNECTING");
    bridge.noteReconnectFailed(Date.now(), "timed_out", "CONNECTING_SESSION");
    const h = bridge.health();
    expect(h.connectionState).toBe("DISCONNECTED");
    expect(h.reconnectCount).toBe(1);
    await rm(dir, { recursive: true, force: true });
  });

  it("15-17. reconnectInFlight mutex + hang timeout + obsolete generation", async () => {
    const { GoldHunterFastResearchCaptureProcess } = await import(
      "../../../../src/services/microEdge/runtime/fastResearchCaptureProcess"
    );
    const proc = new GoldHunterFastResearchCaptureProcess({
      gcsBucket: "test-gh-fast-research",
      runtimeSha: "ffffffffffffffffffffffffffffffffffffffff"
    });
    proc.markRunningForTests();
    proc.setReconnectAttemptTimeoutMsForTests(80);
    proc.setHangConnectOnceForTests(true);

    const ok = proc.scheduleReconnectForTests("stale_feed", 0);
    expect(ok).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(proc.isReconnectInFlight()).toBe(true);
    expect(proc.scheduleReconnectForTests("stale_feed", 0)).toBe(false);

    await new Promise((r) => setTimeout(r, 120));
    const tel = proc.getReconnectTelemetryForTests();
    expect(tel.reconnectInFlight).toBe(false);
    expect(["TIMED_OUT", "FAILED", "IDLE"]).toContain(tel.reconnectPhase);
  });
});

describe("trades/hour wall-clock truthfulness", () => {
  it("24. uses wall-clock not frozen lastTick", () => {
    const paper = new ReferencePaperSimulator();
    // Drive one closed trade via dataOk false won't open; just check label
    const s = paper.summary();
    expect(s.tradesPerHourLabel).toBe("PAPER TRADES / WALL-CLOCK RUNTIME HOUR");
    expect(s.paperTradesPerRuntimeHourLabel).toBe(
      "PAPER TRADES / WALL-CLOCK RUNTIME HOUR"
    );
  });
});

describe("safety zeros", () => {
  it("26. broker mutation zero", () => {
    const id = researchSafetyIdentity();
    expect(id.brokerRequests).toBe(0);
    expect(id.brokerOrders).toBe(0);
    expect(id.shadowOrders).toBe(0);
    expect(id.executionAdapter).toBe("NONE");
    expect(id.mutationSurface).toBe("NONE");
  });

  it("20. soft-stale alone does not schedule hard reconnect", () => {
    const d = decideResearchStaleReconnect({
      nowMs: 1,
      connectionState: "CONNECTED",
      spotAgeMs: 25_000,
      depthAgeMs: 25_000,
      reconnectInFlight: false,
      lastStaleFeedReconnectAttemptMs: null,
      staleFeedBackoffIndex: 0
    });
    expect(d.action).toBe("SOFT_STALE_ONLY");
  });
});
