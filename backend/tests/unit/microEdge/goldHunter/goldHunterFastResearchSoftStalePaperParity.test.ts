/**
 * Soft-stale paper/freshness parity — ResearchIngestBridge integration.
 *
 * Proves DEPTH-first / SPOT-first resume after >20s silence cannot open
 * reference paper on a stale opposite feed. Reconnect policy untouched.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MICRO_SPOT_PRICE_SCALE } from "../../../../src/services/microEdge/marketData/microCTraderProtocol";
import { ResearchIngestBridge } from "../../../../src/services/microEdge/goldHunter/fast/research/researchIngestBridge";
import {
  computeResearchReferencePaperDataOk,
  feedAgeFresh,
  feedsSoftFreshForQualification
} from "../../../../src/services/microEdge/goldHunter/fast/research/researchFeedFreshness";
import {
  GH_FAST_RESEARCH_FRESHNESS_MS
} from "../../../../src/services/microEdge/goldHunter/fast/research/researchTypes";
import {
  GH_FAST_RESEARCH_HARD_STALE_RECONNECT_MS,
  GH_FAST_RESEARCH_STALE_FEED_BACKOFF_MS,
  decideResearchStaleReconnect
} from "../../../../src/services/microEdge/goldHunter/fast/research/researchStaleReconnectPolicy";
import {
  GH_FAST_SUSTAINED_CROSS_RECOVERY_COOLDOWN_MS,
  GH_FAST_SUSTAINED_CROSS_RECOVERY_MS
} from "../../../../src/services/microEdge/goldHunter/fast/depthRecovery";
import { researchSafetyIdentity } from "../../../../src/services/microEdge/goldHunter/fast/research/nullExecutionGuard";

// GH_FAST_RESEARCH_FRESHNESS_MS is the soft boundary (exported as 20_000).
const SOFT = GH_FAST_RESEARCH_FRESHNESS_MS;

function rel(price: number): number {
  return Math.round(price * MICRO_SPOT_PRICE_SCALE);
}

function depthPayload(bid: number, ask: number, _idBase: number) {
  // Reuse stable quote IDs so updates replace prior levels (avoid crossed ghost book).
  return {
    newQuotes: [
      {
        id: "b1",
        size: "100",
        bid: String(rel(bid)),
        ask: null
      },
      {
        id: "a1",
        size: "100",
        bid: null,
        ask: String(rel(ask))
      }
    ],
    deletedQuotes: [] as string[]
  };
}

function spotPayload(bid: number, ask: number) {
  return { bid: rel(bid), ask: rel(ask), timestamp: Date.now() };
}

describe("researchFeedFreshness pure helpers", () => {
  it("spotFresh / depthFresh formulas use soft freshnessLimitMs", () => {
    expect(SOFT).toBe(20_000);
    expect(feedAgeFresh(1000, 1000 + 20_000, SOFT)).toBe(true);
    expect(feedAgeFresh(1000, 1000 + 20_001, SOFT)).toBe(false);
    expect(feedAgeFresh(null, 1000, SOFT)).toBe(false);
  });

  it("DEPTH-first: valid Depth + stale Spot → dataOk false", () => {
    const ok = computeResearchReferencePaperDataOk({
      nowMs: 100_000,
      lastSpotAtMs: 100_000 - 25_000,
      lastDepthAtMs: 100_000,
      lastBid: 3400,
      lastAsk: 3400.2,
      crossed: false,
      depthAvailable: true,
      depthRecoveryInFlight: false,
      depthValidity: "DEPTH_VALID"
    });
    expect(ok).toBe(false);
  });

  it("SPOT-first: valid Spot + stale Depth → dataOk false", () => {
    const ok = computeResearchReferencePaperDataOk({
      nowMs: 100_000,
      lastSpotAtMs: 100_000,
      lastDepthAtMs: 100_000 - 25_000,
      lastBid: 3400,
      lastAsk: 3400.2,
      crossed: false,
      depthAvailable: true,
      depthRecoveryInFlight: false,
      depthValidity: "DEPTH_VALID"
    });
    expect(ok).toBe(false);
  });

  it("both fresh + DEPTH_VALID → dataOk true", () => {
    const ok = computeResearchReferencePaperDataOk({
      nowMs: 100_000,
      lastSpotAtMs: 99_500,
      lastDepthAtMs: 99_600,
      lastBid: 3400,
      lastAsk: 3400.2,
      crossed: false,
      depthAvailable: true,
      depthRecoveryInFlight: false,
      depthValidity: "DEPTH_VALID"
    });
    expect(ok).toBe(true);
  });
});

describe("ResearchIngestBridge soft-stale paper parity", () => {
  let dir: string;
  let prevResearchGcs: string | undefined;

  beforeEach(async () => {
    prevResearchGcs = process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET;
    delete process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET;
    dir = await mkdtemp(join(tmpdir(), "gh-soft-fresh-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    if (prevResearchGcs === undefined) {
      delete process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET;
    } else {
      process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET = prevResearchGcs;
    }
  });

  async function warmBridge(t0: number): Promise<ResearchIngestBridge> {
    const bridge = new ResearchIngestBridge({
      localDir: dir,
      gcsBucket: null,
      campaignMode: false,
      freshnessLimitMs: SOFT
    });
    bridge.setScopeVerified(true);
    bridge.setConnectionState("CONNECTED", "test");
    bridge.setSubscriptionFlags(true, true);
    // Warm feature engine + book with several fresh ticks.
    for (let i = 0; i < 30; i++) {
      const t = t0 + i * 40;
      const px = 3400 + i * 0.02;
      bridge.ingestSpot(spotPayload(px, px + 0.12), t);
      bridge.ingestDepth(depthPayload(px, px + 0.12, i), t + 1);
    }
    await bridge.drainForTests();
    return bridge;
  }

  it("1. valid Spot + valid Depth → reference dataOk may be true", async () => {
    const t0 = 1_000_000;
    const bridge = await warmBridge(t0);
    const t = t0 + 30 * 40 + 50;
    bridge.ingestSpot(spotPayload(3401, 3401.12), t);
    bridge.ingestDepth(depthPayload(3401, 3401.12, 99), t + 1);
    await bridge.drainForTests();
    expect(bridge.lastReferenceDataOkForTests()).toBe(true);
    const ages = bridge.getFeedAgesMs(t + 1);
    expect(ages.spotAgeMs!).toBeLessThanOrEqual(SOFT);
    expect(ages.depthAgeMs!).toBeLessThanOrEqual(SOFT);
    const id = researchSafetyIdentity();
    expect(id.brokerRequests).toBe(0);
    expect(id.brokerOrders).toBe(0);
    expect(id.shadowOrders).toBe(0);
    expect(id.executionAdapter).toBe("NONE");
    expect(bridge.health(t + 1).brokerOrders).toBe(0);
  });

  it("2. both silent >20s → no paper entry (dataOk false)", async () => {
    const t0 = 2_000_000;
    const bridge = await warmBridge(t0);
    const openBefore = bridge.referencePaperSummary().open;
    const tradesBefore = bridge.referencePaperSummary().paperTrades;
    // No new ingest — evaluate dataOk helper at silence.
    const now = t0 + 30 * 40 + 25_000;
    const ages = bridge.getFeedAgesMs(now);
    expect(ages.spotAgeMs!).toBeGreaterThan(SOFT);
    expect(ages.depthAgeMs!).toBeGreaterThan(SOFT);
    expect(
      computeResearchReferencePaperDataOk({
        nowMs: now,
        lastSpotAtMs: now - ages.spotAgeMs!,
        lastDepthAtMs: now - ages.depthAgeMs!,
        lastBid: 3400,
        lastAsk: 3400.12,
        crossed: false,
        depthAvailable: true,
        depthRecoveryInFlight: false,
        depthValidity: "DEPTH_VALID"
      })
    ).toBe(false);
    expect(bridge.referencePaperSummary().open).toBe(openBefore);
    expect(bridge.referencePaperSummary().paperTrades).toBe(tradesBefore);
  });

  it("3. DEPTH resumes first while Spot remains stale → NO paper entry", async () => {
    const t0 = 3_000_000;
    const bridge = await warmBridge(t0);
    const lastWarm = t0 + 29 * 40 + 1;
    const openBefore = bridge.referencePaperSummary().open;
    const tradesBefore = bridge.referencePaperSummary().paperTrades;
    const selectedBefore =
      bridge.health().selectedA +
      bridge.health().selectedB +
      bridge.health().selectedC;

    const resumeAt = lastWarm + 25_000;
    // Depth only — Spot still lastWarm (~25s stale).
    bridge.ingestDepth(depthPayload(3410, 3410.15, 200), resumeAt);
    await bridge.drainForTests();

    expect(bridge.lastReferenceDataOkForTests()).toBe(false);
    // Must not newly open. Existing open may DATA_STALE-exit (engine parity).
    expect(bridge.referencePaperSummary().open).toBe(0);
    if (openBefore === 0) {
      expect(bridge.referencePaperSummary().paperTrades).toBe(tradesBefore);
    }

    const ages = bridge.getFeedAgesMs(resumeAt);
    expect(ages.spotAgeMs!).toBeGreaterThan(SOFT);
    expect(ages.depthAgeMs!).toBe(0);
    expect(
      feedsSoftFreshForQualification({
        nowMs: resumeAt,
        lastSpotAtMs: resumeAt - ages.spotAgeMs!,
        lastDepthAtMs: resumeAt - ages.depthAgeMs!
      })
    ).toBe(false);

    // Clean selected counts must not advance on contaminated soft-stale rows.
    const selectedAfter =
      bridge.health().selectedA +
      bridge.health().selectedB +
      bridge.health().selectedC;
    expect(selectedAfter).toBe(selectedBefore);
  });

  it("4. SPOT resumes first while Depth remains stale → NO paper entry", async () => {
    const t0 = 4_000_000;
    const bridge = await warmBridge(t0);
    const lastWarm = t0 + 29 * 40 + 1;
    const openBefore = bridge.referencePaperSummary().open;
    const tradesBefore = bridge.referencePaperSummary().paperTrades;

    const resumeAt = lastWarm + 25_000;
    bridge.ingestSpot(spotPayload(3411, 3411.15), resumeAt);
    await bridge.drainForTests();

    expect(bridge.lastReferenceDataOkForTests()).toBe(false);
    expect(bridge.referencePaperSummary().open).toBe(0);
    if (openBefore === 0) {
      expect(bridge.referencePaperSummary().paperTrades).toBe(tradesBefore);
    }

    const ages = bridge.getFeedAgesMs(resumeAt);
    expect(ages.depthAgeMs!).toBeGreaterThan(SOFT);
    expect(ages.spotAgeMs!).toBe(0);
  });

  it("5. once BOTH become fresh again → dataOk can recover", async () => {
    const t0 = 5_000_000;
    const bridge = await warmBridge(t0);
    const lastWarm = t0 + 29 * 40 + 1;
    const resumeAt = lastWarm + 25_000;

    bridge.ingestDepth(depthPayload(3412, 3412.15, 300), resumeAt);
    await bridge.drainForTests();
    expect(bridge.lastReferenceDataOkForTests()).toBe(false);

    const bothAt = resumeAt + 50;
    bridge.ingestSpot(spotPayload(3412, 3412.15), bothAt);
    bridge.ingestDepth(depthPayload(3412, 3412.15, 301), bothAt + 1);
    await bridge.drainForTests();
    expect(bridge.lastReferenceDataOkForTests()).toBe(true);
    expect(
      feedsSoftFreshForQualification({
        nowMs: bothAt + 1,
        lastSpotAtMs: bothAt,
        lastDepthAtMs: bothAt + 1
      })
    ).toBe(true);
  });

  it("6+10. soft-stale alone does not imply reconnect; no broker mutation", async () => {
    // Soft stale decision must remain SOFT_STALE_ONLY (no reconnect).
    const d = decideResearchStaleReconnect({
      nowMs: 100_000,
      connectionState: "CONNECTED",
      spotAgeMs: 25_000,
      depthAgeMs: 25_000,
      transportLivenessHealthy: true,
      reconnectInFlight: false,
      lastStaleFeedReconnectAttemptMs: null,
      staleFeedBackoffIndex: 0
    });
    expect(d.action).toBe("SOFT_STALE_ONLY");
    const id = researchSafetyIdentity();
    expect(id.brokerRequests).toBe(0);
    expect(id.brokerOrders).toBe(0);
    expect(id.shadowOrders).toBe(0);
    expect(id.executionAdapter).toBe("NONE");
    expect(id.mutationSurface).toBe("NONE");
  });

  it("7+8+9. reconnect hard/mutex/backoff + sustained-cross unchanged", () => {
    expect(GH_FAST_RESEARCH_HARD_STALE_RECONNECT_MS).toBe(45_000);
    expect([...GH_FAST_RESEARCH_STALE_FEED_BACKOFF_MS]).toEqual([
      120_000, 300_000, 900_000
    ]);
    expect(SOFT).toBe(20_000);
    expect(GH_FAST_SUSTAINED_CROSS_RECOVERY_MS).toBe(10_000);
    expect(GH_FAST_SUSTAINED_CROSS_RECOVERY_COOLDOWN_MS).toBe(30_000);

    const hard = decideResearchStaleReconnect({
      nowMs: 100_000,
      connectionState: "CONNECTED",
      spotAgeMs: 50_000,
      depthAgeMs: 50_000,
      transportLivenessHealthy: true,
      reconnectInFlight: false,
      lastStaleFeedReconnectAttemptMs: null,
      staleFeedBackoffIndex: 0
    });
    expect(hard.action).toBe("HARD_FEED_STALE");

    const mutex = decideResearchStaleReconnect({
      nowMs: 100_000,
      connectionState: "CONNECTED",
      spotAgeMs: 50_000,
      depthAgeMs: 50_000,
      transportLivenessHealthy: true,
      reconnectInFlight: true,
      lastStaleFeedReconnectAttemptMs: 90_000,
      staleFeedBackoffIndex: 0
    });
    expect(mutex.action).toBe("SOFT_STALE_ONLY");

    const backoff = decideResearchStaleReconnect({
      nowMs: 100_000,
      connectionState: "CONNECTED",
      spotAgeMs: 50_000,
      depthAgeMs: 50_000,
      transportLivenessHealthy: true,
      reconnectInFlight: false,
      lastStaleFeedReconnectAttemptMs: 95_000,
      staleFeedBackoffIndex: 0
    });
    expect(backoff.action).toBe("HARD_FEED_STALE");
  });

  it("8b. soft-stale specialist rows are marked derivedDataContaminated", async () => {
    const t0 = 6_000_000;
    const bridge = await warmBridge(t0);
    const lastWarm = t0 + 29 * 40 + 1;
    const resumeAt = lastWarm + 25_000;
    bridge.ingestDepth(depthPayload(3415, 3415.2, 400), resumeAt);
    await bridge.drainForTests();
    const feed = bridge.recentCandidatesResponse(40, "ALL");
    // Any observation emitted on the soft-stale DEPTH tick must be contaminated.
    const atResume = feed.observations.filter((o) => o.tsMs === resumeAt);
    for (const row of atResume) {
      expect(row.derivedDataContaminated).toBe(true);
    }
  });
});
