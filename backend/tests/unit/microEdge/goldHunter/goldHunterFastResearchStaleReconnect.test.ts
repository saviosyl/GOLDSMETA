/**
 * GOLD HUNTER FAST — stale-feed reconnect stabilisation.
 *
 * Soft stale (~20s) = FEED_STALE / paper block — NOT full-session teardown.
 * Hard stale (45s) = one bounded reconnect + quiet-market backoff.
 * reconnectInFlight mutex prevents stacked reconnect (#4 scenario).
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decideResearchStaleReconnect,
  GH_FAST_RESEARCH_HARD_STALE_RECONNECT_MS,
  GH_FAST_RESEARCH_HARD_STALE_THRESHOLD_REASON,
  GH_FAST_RESEARCH_SOFT_STALE_MS,
  GH_FAST_RESEARCH_STALE_FEED_BACKOFF_MS,
  staleFeedBackoffMs
} from "../../../../src/services/microEdge/goldHunter/fast/research/researchStaleReconnectPolicy";
import {
  GH_FAST_SUSTAINED_CROSS_RECOVERY_COOLDOWN_MS,
  GH_FAST_SUSTAINED_CROSS_RECOVERY_MS
} from "../../../../src/services/microEdge/goldHunter/fast/depthRecovery";
import { ResearchIngestBridge } from "../../../../src/services/microEdge/goldHunter/fast/research/researchIngestBridge";
import { evaluateCaptureHealth } from "../../../../src/services/microEdge/goldHunter/fast/research/researchCaptureHealth";
import { ReferencePaperSimulator } from "../../../../src/services/microEdge/goldHunter/fast/research/referencePaperSimulator";
import type { ResearchSpecialistObservation } from "../../../../src/services/microEdge/goldHunter/fast/research/researchTypes";

function selectedBuyA(): ResearchSpecialistObservation[] {
  return [
    {
      setup: "A",
      eligible: true,
      selectedCandidate: true,
      candidateSide: "BUY",
      rawQuality: 1,
      failedConditions: [],
      derivedDataContaminated: false,
      depthValidity: "DEPTH_VALID"
    },
    {
      setup: "B",
      eligible: false,
      selectedCandidate: false,
      candidateSide: null,
      rawQuality: null,
      failedConditions: [],
      derivedDataContaminated: false,
      depthValidity: "DEPTH_VALID"
    },
    {
      setup: "C",
      eligible: false,
      selectedCandidate: false,
      candidateSide: null,
      rawQuality: null,
      failedConditions: [],
      derivedDataContaminated: false,
      depthValidity: "DEPTH_VALID"
    }
  ];
}

describe("research stale reconnect policy (pure)", () => {
  it("documents soft=20s and hard=45s above observed quiet gaps ~22–26.5s", () => {
    expect(GH_FAST_RESEARCH_SOFT_STALE_MS).toBe(20_000);
    expect(GH_FAST_RESEARCH_HARD_STALE_RECONNECT_MS).toBe(45_000);
    expect(GH_FAST_RESEARCH_HARD_STALE_THRESHOLD_REASON).toMatch(/22–26\.5s/);
    expect(GH_FAST_RESEARCH_HARD_STALE_RECONNECT_MS).toBeGreaterThan(26_500);
  });

  it("1. 25s simultaneous Spot/Depth silence while CONNECTED does NOT full reconnect", () => {
    const d = decideResearchStaleReconnect({
      nowMs: 100_000,
      connectionState: "CONNECTED",
      spotAgeMs: 25_000,
      depthAgeMs: 25_000,
      reconnectInFlight: false,
      lastStaleFeedReconnectAttemptMs: null,
      staleFeedBackoffIndex: 0
    });
    expect(d.action).toBe("SOFT_STALE_ONLY");
    expect(d.feedSoftStale).toBe(true);
  });

  it("2. soft stale still fails captureHealthy / paper dataOk freshness gate", () => {
    const h = evaluateCaptureHealth({
      processHealthy: true,
      connectionState: "CONNECTED",
      spotSubscribed: true,
      depthSubscribed: true,
      spotAgeMs: 25_000,
      depthAgeMs: 25_000,
      freshnessLimitMs: GH_FAST_RESEARCH_SOFT_STALE_MS,
      eventsDropped: 0,
      persistenceDroppedRows: 0,
      persistenceDroppedChunks: 0,
      writeErrors: 0,
      uploadErrors: 0,
      durableMode: "GCS",
      campaignMode: true,
      scopeVerified: true,
      fatalPersistenceError: false,
      healthWarning: null,
      heartbeatsPersisted: 5,
      sessionTransitionsPersisted: 2
    });
    expect(h.captureHealthy).toBe(false);
    expect(h.captureUnhealthyReasons).toEqual(
      expect.arrayContaining(["spot_stale", "depth_stale"])
    );

    const paper = new ReferencePaperSimulator();
    paper.onMarketTick({
      bid: 3400,
      ask: 3400.2,
      tsMs: 1,
      receiveSeq: 1,
      specialists: selectedBuyA(),
      features: null,
      dataOk: false
    });
    expect(paper.summary().open).toBe(0);
    expect(paper.summary().paperEntriesBlockedDataNotOk).toBeGreaterThan(0);
  });

  it("3. prolonged hard stale triggers at most one SCHEDULE_STALE_FEED_RECONNECT", () => {
    const d = decideResearchStaleReconnect({
      nowMs: 100_000,
      connectionState: "CONNECTED",
      spotAgeMs: 50_000,
      depthAgeMs: 50_000,
      reconnectInFlight: false,
      lastStaleFeedReconnectAttemptMs: null,
      staleFeedBackoffIndex: 0
    });
    expect(d.action).toBe("SCHEDULE_STALE_FEED_RECONNECT");
  });

  it("4. reconnectInFlight prevents stacked stale reconnect decision", () => {
    const d = decideResearchStaleReconnect({
      nowMs: 100_000,
      connectionState: "CONNECTED",
      spotAgeMs: 60_000,
      depthAgeMs: 60_000,
      reconnectInFlight: true,
      lastStaleFeedReconnectAttemptMs: 50_000,
      staleFeedBackoffIndex: 0
    });
    expect(d.action).toBe("SOFT_STALE_ONLY");
  });

  it("5. successful fresh events reset to NONE (caller clears backoff)", () => {
    const d = decideResearchStaleReconnect({
      nowMs: 100_000,
      connectionState: "CONNECTED",
      spotAgeMs: 100,
      depthAgeMs: 100,
      reconnectInFlight: false,
      lastStaleFeedReconnectAttemptMs: 90_000,
      staleFeedBackoffIndex: 2
    });
    expect(d).toEqual({ action: "NONE", feedSoftStale: false });
  });

  it("6. continued market-closed-like silence uses stepped backoff (no storm)", () => {
    expect([...GH_FAST_RESEARCH_STALE_FEED_BACKOFF_MS]).toEqual([
      120_000, 300_000, 900_000
    ]);
    const afterFirst = decideResearchStaleReconnect({
      nowMs: 100_000,
      connectionState: "CONNECTED",
      spotAgeMs: 80_000,
      depthAgeMs: 80_000,
      reconnectInFlight: false,
      lastStaleFeedReconnectAttemptMs: 95_000,
      staleFeedBackoffIndex: 0
    });
    expect(afterFirst.action).toBe("STALE_BACKOFF_WAIT");
    if (afterFirst.action === "STALE_BACKOFF_WAIT") {
      expect(afterFirst.backoffMs).toBe(120_000);
      expect(afterFirst.nextEligibleAtMs).toBe(95_000 + 120_000);
    }

    const afterWaitElapsed = decideResearchStaleReconnect({
      nowMs: 95_000 + 120_000 + 1,
      connectionState: "CONNECTED",
      spotAgeMs: 200_000,
      depthAgeMs: 200_000,
      reconnectInFlight: false,
      lastStaleFeedReconnectAttemptMs: 95_000,
      staleFeedBackoffIndex: 0
    });
    expect(afterWaitElapsed.action).toBe("SCHEDULE_STALE_FEED_RECONNECT");

    const midFiveMin = decideResearchStaleReconnect({
      nowMs: 200_000 + 60_000,
      connectionState: "CONNECTED",
      spotAgeMs: 200_000,
      depthAgeMs: 200_000,
      reconnectInFlight: false,
      lastStaleFeedReconnectAttemptMs: 200_000,
      staleFeedBackoffIndex: 1
    });
    expect(midFiveMin.action).toBe("STALE_BACKOFF_WAIT");
    if (midFiveMin.action === "STALE_BACKOFF_WAIT") {
      expect(midFiveMin.backoffMs).toBe(300_000);
    }

    expect(staleFeedBackoffMs(99)).toBe(900_000);
  });

  it("7. genuine transport disconnect still schedules prompt reconnect", () => {
    const d = decideResearchStaleReconnect({
      nowMs: 100_000,
      connectionState: "DISCONNECTED",
      spotAgeMs: 100,
      depthAgeMs: 100,
      reconnectInFlight: false,
      lastStaleFeedReconnectAttemptMs: null,
      staleFeedBackoffIndex: 0
    });
    expect(d.action).toBe("SCHEDULE_TRANSPORT_RECONNECT");
    expect(
      (d as { reason?: string }).reason
    ).toBe("transport_disconnect");
  });
});

describe("ordered RESYNC ghost-clear + sustained-cross unchanged", () => {
  it("8. disconnect still creates ordered RESYNC and clears old Depth IDs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-stale-resync-"));
    const bridge = new ResearchIngestBridge({
      localDir: dir,
      gcsBucket: null,
      campaignMode: false,
      runtimeSha: "deadbeef"
    });
    bridge.setScopeVerified(true);
    bridge.setConnectionState("CONNECTED", "test");
    bridge.setSubscriptionFlags(true, true);

    bridge.ingestDepth(
      {
        newQuotes: [
          { id: "2361229607", size: "100", bid: "438732000", ask: null },
          { id: "a1", size: "100", bid: null, ask: "438743000" }
        ],
        deletedQuotes: []
      },
      1000
    );
    await bridge.drainForTests();
    expect(bridge.pipelineForTests().depthBook().hasQuoteId("2361229607")).toBe(
      true
    );

    const beforeDisconnect = bridge.getDisconnectResyncCount();
    const beforeResync = bridge.getResyncCount();
    bridge.noteDisconnect("session_detached", 2000);
    await bridge.drainForTests();

    expect(bridge.getDisconnectResyncCount()).toBe(beforeDisconnect + 1);
    expect(bridge.getResyncCount()).toBe(beforeResync + 1);
    expect(bridge.pipelineForTests().depthBook().hasQuoteId("2361229607")).toBe(
      false
    );
    await rm(dir, { recursive: true, force: true });
  });

  it("9. sustained-cross 10s recovery threshold remains unchanged", () => {
    expect(GH_FAST_SUSTAINED_CROSS_RECOVERY_MS).toBe(10_000);
    expect(GH_FAST_SUSTAINED_CROSS_RECOVERY_COOLDOWN_MS).toBe(30_000);
  });
});

describe("process reconnectInFlight mutex (#4 scenario)", () => {
  const prevBucket = process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET;
  const prevSha = process.env.GOLD_HUNTER_FAST_DEPLOY_GIT_SHA;

  beforeEach(() => {
    process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET = "test-gh-fast-research";
    process.env.GOLD_HUNTER_FAST_DEPLOY_GIT_SHA =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  });

  afterEach(() => {
    if (prevBucket == null) {
      delete process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET;
    } else {
      process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET = prevBucket;
    }
    if (prevSha == null) {
      delete process.env.GOLD_HUNTER_FAST_DEPLOY_GIT_SHA;
    } else {
      process.env.GOLD_HUNTER_FAST_DEPLOY_GIT_SHA = prevSha;
    }
  });

  it("4b. Reconnect A slow + watchdog during A → Reconnect B MUST NOT run", async () => {
    const { GoldHunterFastResearchCaptureProcess } = await import(
      "../../../../src/services/microEdge/runtime/fastResearchCaptureProcess"
    );
    const proc = new GoldHunterFastResearchCaptureProcess({
      gcsBucket: "test-gh-fast-research",
      runtimeSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      softStaleMs: 20_000,
      hardStaleReconnectMs: 45_000
    });
    proc.markRunningForTests();
    proc.setSkipSessionConnectForTests(true);
    proc.setReconnectHoldMsForTests(80);

    const scheduledA = proc.scheduleReconnectForTests("stale_feed", 0);
    expect(scheduledA).toBe(true);

    await new Promise((r) => setTimeout(r, 20));
    expect(proc.isReconnectInFlight()).toBe(true);

    const scheduledB = proc.scheduleReconnectForTests("stale_feed", 0);
    expect(scheduledB).toBe(false);

    await new Promise((r) => setTimeout(r, 120));
    const tel = proc.getReconnectTelemetryForTests();
    expect(tel.staleFeedReconnectCount).toBe(1);
    expect(tel.reconnectInFlight).toBe(false);
  });

  it("11. soft/hard thresholds + counter fields on process health", async () => {
    const { GoldHunterFastResearchCaptureProcess } = await import(
      "../../../../src/services/microEdge/runtime/fastResearchCaptureProcess"
    );
    const proc = new GoldHunterFastResearchCaptureProcess({
      gcsBucket: "test-gh-fast-research",
      runtimeSha: "cccccccccccccccccccccccccccccccccccccccc"
    });
    const policy = proc.getStaleReconnectPolicy();
    expect(policy.softStaleMs).toBe(20_000);
    expect(policy.hardStaleReconnectMs).toBe(45_000);
    expect(policy.hardStaleThresholdReason).toMatch(/ops integrity/);
    const h = proc.buildHealth();
    expect(h.runtimeSha).toBe("cccccccccccccccccccccccccccccccccccccccc");
    expect(h.softStaleMs).toBe(20_000);
    expect(h.hardStaleReconnectMs).toBe(45_000);
    expect(h.transportReconnectCount).toBe(0);
    expect(h.staleFeedReconnectCount).toBe(0);
    expect(h.executionAdapter).toBe("NONE");
    expect(h.mutationSurface).toBe("NONE");
    expect(h.brokerRequests).toBe(0);
    expect(h.brokerOrders).toBe(0);
    expect(h.shadowOrders).toBe(0);
  });

  it("12. runtimeSha comes from GOLD_HUNTER_FAST_DEPLOY_GIT_SHA (not hardcoded)", async () => {
    process.env.GOLD_HUNTER_FAST_DEPLOY_GIT_SHA =
      "dddddddddddddddddddddddddddddddddddddddd";
    const { GoldHunterFastResearchCaptureProcess } = await import(
      "../../../../src/services/microEdge/runtime/fastResearchCaptureProcess"
    );
    const proc = new GoldHunterFastResearchCaptureProcess({
      gcsBucket: "test-gh-fast-research"
    });
    expect(proc.buildHealth().runtimeSha).toBe(
      "dddddddddddddddddddddddddddddddddddddddd"
    );
  });
});

describe("reconnect/resync counter semantics on bridge", () => {
  it("11b. noteReconnectStart/Finish and disconnectResync reconcile", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-reconn-count-"));
    const bridge = new ResearchIngestBridge({
      localDir: dir,
      gcsBucket: null,
      campaignMode: false,
      runtimeSha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    });
    expect(bridge.getReconnectCount()).toBe(0);
    expect(bridge.getDisconnectResyncCount()).toBe(0);
    bridge.noteReconnectStart(Date.now(), "stale_feed");
    expect(bridge.getReconnectCount()).toBe(1);
    bridge.noteDisconnect("session_detached");
    expect(bridge.getDisconnectResyncCount()).toBe(1);
    expect(bridge.getResyncCount()).toBe(1);
    bridge.noteReconnectFinish(Date.now());
    const h = bridge.health();
    expect(h.reconnectCount).toBe(1);
    expect(h.resyncCount).toBe(1);
    expect(h.disconnectResyncCount).toBe(1);
    expect(h.sustainedCrossRecoveryCount).toBe(0);
    expect(h.depthResyncCount).toBe(1);
    expect(h.runtimeSha).toBe("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
    await rm(dir, { recursive: true, force: true });
  });
});

describe("paper entry blocked during stale/recovery", () => {
  it("10. no paper entry when dataOk false (FEED_STALE / recovery)", () => {
    const paper = new ReferencePaperSimulator();
    paper.onMarketTick({
      bid: 3400,
      ask: 3400.15,
      tsMs: 10,
      receiveSeq: 10,
      specialists: selectedBuyA(),
      features: null,
      dataOk: false
    });
    expect(paper.summary().open).toBe(0);
    expect(paper.summary().paperTrades).toBe(0);
  });
});
