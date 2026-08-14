/**
 * GOLD HUNTER FAST — inbound transport liveness correction.
 *
 * Catches f697b1f bug: successful local sendHeartbeat() must NOT keep
 * transportLivenessHealthy=true without recent inbound evidence.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  decideResearchStaleReconnect,
  GH_FAST_RESEARCH_HARD_FEED_STALE_MS,
  GH_FAST_RESEARCH_SOFT_STALE_MS,
  GH_FAST_RESEARCH_TRANSPORT_HEARTBEAT_INTERVAL_MS,
  GH_FAST_RESEARCH_TRANSPORT_LIVENESS_MS,
  GH_FAST_RESEARCH_TRANSPORT_LIVENESS_REASON
} from "../../../../src/services/microEdge/goldHunter/fast/research/researchStaleReconnectPolicy";
import { FakeMicroCTraderTransport } from "../../../../src/services/microEdge/marketData/microCTraderTransport";
import type { MicroLiveMarketSession } from "../../../../src/services/microEdge/marketData/liveSession";

describe("ctrader-layer close/error + heartbeat baseline", () => {
  it("CTraderConnection.#onClose is a no-op — no app-facing close event", () => {
    const src = readFileSync(
      join(
        process.cwd(),
        "node_modules/@reiryoku/ctrader-layer/src/core/CTraderConnection.ts"
      ),
      "utf8"
    );
    expect(src).toMatch(/#onClose \(\): void \{\s*\/\/ Silence is golden\./);
    expect(src).toMatch(/public sendHeartbeat/);
    // No emitter notify on close — cannot wire a public close event name.
    expect(src).not.toMatch(/#onClose[\s\S]{0,80}notifyListeners/);
  });

  it("liveness timeout retained at 40s above live inbound ~30s gaps", () => {
    expect(GH_FAST_RESEARCH_TRANSPORT_HEARTBEAT_INTERVAL_MS).toBe(10_000);
    expect(GH_FAST_RESEARCH_TRANSPORT_LIVENESS_MS).toBe(40_000);
    expect(GH_FAST_RESEARCH_TRANSPORT_LIVENESS_REASON).toMatch(/INBOUND/);
    expect(GH_FAST_RESEARCH_TRANSPORT_LIVENESS_REASON).toMatch(/30\.000s/);
    expect(GH_FAST_RESEARCH_HARD_FEED_STALE_MS).toBe(45_000);
    expect(GH_FAST_RESEARCH_SOFT_STALE_MS).toBe(20_000);
  });
});

describe("CRITICAL: outbound-only must NOT keep transport healthy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("outbound sendHeartbeat succeeds every 10s with ZERO inbound → unhealthy after 40s", () => {
    const t = new FakeMicroCTraderTransport();
    void t.connect();
    let now = 1_000_000;
    t.setResearchHeartbeatInboundEchoForTests(false);
    t.enableResearchTransportHeartbeat({
      intervalMs: 10_000,
      livenessTimeoutMs: 40_000,
      nowMs: () => now
    });
    t.clearInboundTransportLivenessForTests();

    // Immediate outbound tick still succeeds; inbound clocks wiped.
    expect(t.getResearchTransportHeartbeatTelemetry().lastHeartbeatSendOk).toBe(
      true
    );
    expect(
      t.getResearchTransportHeartbeatTelemetry().transportLivenessHealthy
    ).toBe(false);

    // Advance well past 40s while outbound keep-alive continues.
    for (let i = 0; i < 6; i++) {
      now += 10_000;
      vi.advanceTimersByTime(10_000);
    }
    const tel = t.getResearchTransportHeartbeatTelemetry();
    expect(tel.transportHeartbeatSentCount).toBeGreaterThanOrEqual(6);
    expect(tel.lastHeartbeatSendOk).toBe(true);
    expect(tel.transportHeartbeatReceivedCount).toBe(0);
    expect(tel.lastTransportMessageAt).toBeNull();
    expect(tel.transportLivenessHealthy).toBe(false);

    const d = decideResearchStaleReconnect({
      nowMs: now,
      connectionState: "CONNECTED",
      spotAgeMs: 120_000,
      depthAgeMs: 120_000,
      transportLivenessHealthy: tel.transportLivenessHealthy,
      reconnectInFlight: false
    });
    expect(d.action).toBe("SCHEDULE_TRANSPORT_RECONNECT");
    expect((d as { reason?: string }).reason).toBe("transport_liveness_lost");
    t.disconnect();
  });

  it("watchdog schedules ONE transport_liveness_lost reconnect", async () => {
    vi.useRealTimers();
    const prevBucket = process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET;
    process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET = "test-gh-fast-research";
    const dir = await mkdtemp(join(tmpdir(), "gh-inbound-live-"));
    try {
      const { GoldHunterFastResearchCaptureProcess } = await import(
        "../../../../src/services/microEdge/runtime/fastResearchCaptureProcess"
      );
      const proc = new GoldHunterFastResearchCaptureProcess({
        gcsBucket: "test-gh-fast-research",
        runtimeSha: "dddddddddddddddddddddddddddddddddddddddd",
        softStaleMs: 20_000,
        hardStaleReconnectMs: 45_000
      });
      await proc.prepareRuntimeForTests(dir);
      const bridge = proc.getRuntime()!.getBridge()!;
      bridge.setConnectionState("CONNECTED", "test");
      bridge.setSubscriptionFlags(true, true);

      const fake = new FakeMicroCTraderTransport();
      await fake.connect();
      fake.setResearchHeartbeatInboundEchoForTests(false);
      fake.enableResearchTransportHeartbeat({
        intervalMs: 10_000,
        livenessTimeoutMs: 40_000
      });
      fake.clearInboundTransportLivenessForTests();
      expect(fake.getResearchTransportHeartbeatTelemetry().transportLivenessHealthy).toBe(
        false
      );

      const session = {
        getResearchTransportHeartbeatTelemetry: () =>
          fake.getResearchTransportHeartbeatTelemetry(),
        disconnect: async () => {
          await fake.disconnect();
        }
      };
      proc.setActiveSessionForTests(session as unknown as MicroLiveMarketSession);
      proc.setSkipSessionConnectForTests(true);

      await proc.checkStaleAndReconnectForTests();
      // scheduleReconnect uses 500ms delay for transport_liveness_lost
      expect(proc.getReconnectTelemetryForTests().reconnectTimerPending).toBe(
        true
      );
      await new Promise((r) => setTimeout(r, 700));
      const tel = proc.getReconnectTelemetryForTests();
      expect(tel.transportReconnectCount).toBe(1);
      expect(tel.staleFeedReconnectCount).toBe(0);
      // Second watchdog while reconnect in-flight / after must not storm.
      await proc.checkStaleAndReconnectForTests();
      expect(proc.getReconnectTelemetryForTests().transportReconnectCount).toBe(
        1
      );
      await proc.stop();
    } finally {
      await rm(dir, { recursive: true, force: true });
      if (prevBucket == null) {
        delete process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET;
      } else {
        process.env.GOLD_HUNTER_FAST_RESEARCH_GCS_BUCKET = prevBucket;
      }
    }
  });
});

describe("healthy quiet-market with inbound heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("20-minute Spot/Depth silence + inbound HB → ZERO transport reconnect", () => {
    const t = new FakeMicroCTraderTransport();
    void t.connect();
    let now = 0;
    t.setResearchHeartbeatInboundEchoForTests(true);
    t.enableResearchTransportHeartbeat({
      intervalMs: 10_000,
      livenessTimeoutMs: 40_000,
      nowMs: () => now
    });

    let transportSchedules = 0;
    let staleSchedules = 0;
    let hardFeed = 0;
    const step = 5_000;
    const horizon = 20 * 60_000;

    for (; now <= horizon; now += step) {
      vi.advanceTimersByTime(step);
      const tel = t.getResearchTransportHeartbeatTelemetry();
      expect(tel.transportLivenessHealthy).toBe(true);
      expect(tel.lastHeartbeatSendOk).toBe(true);
      expect(tel.transportHeartbeatReceivedCount).toBeGreaterThan(0);

      const d = decideResearchStaleReconnect({
        nowMs: now,
        connectionState: "CONNECTED",
        spotAgeMs: now,
        depthAgeMs: now,
        softStaleMs: GH_FAST_RESEARCH_SOFT_STALE_MS,
        hardStaleReconnectMs: GH_FAST_RESEARCH_HARD_FEED_STALE_MS,
        transportLivenessHealthy: tel.transportLivenessHealthy,
        reconnectInFlight: false
      });
      if (d.action === "SCHEDULE_TRANSPORT_RECONNECT") transportSchedules += 1;
      if (d.action === "SCHEDULE_STALE_FEED_RECONNECT") staleSchedules += 1;
      if (d.action === "HARD_FEED_STALE") hardFeed += 1;
    }

    expect(transportSchedules).toBe(0);
    expect(staleSchedules).toBe(0);
    expect(hardFeed).toBeGreaterThan(100);
    t.disconnect();
  });
});

describe("inbound loss then recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("healthy inbound → stop inbound (outbound continues) → unhealthy → resume inbound", () => {
    const t = new FakeMicroCTraderTransport();
    void t.connect();
    let now = 1_000_000;
    t.setResearchHeartbeatInboundEchoForTests(true);
    t.enableResearchTransportHeartbeat({
      intervalMs: 10_000,
      livenessTimeoutMs: 40_000,
      nowMs: () => now
    });
    expect(t.getResearchTransportHeartbeatTelemetry().transportLivenessHealthy).toBe(
      true
    );

    // Stop ALL inbound; keep outbound succeeding.
    t.setResearchHeartbeatInboundEchoForTests(false);
    t.clearInboundTransportLivenessForTests();
    for (let i = 0; i < 5; i++) {
      now += 10_000;
      vi.advanceTimersByTime(10_000);
    }
    const lost = t.getResearchTransportHeartbeatTelemetry();
    expect(lost.lastHeartbeatSendOk).toBe(true);
    expect(lost.transportHeartbeatSentCount).toBeGreaterThan(0);
    expect(lost.transportLivenessHealthy).toBe(false);

    const decision = decideResearchStaleReconnect({
      nowMs: now,
      connectionState: "CONNECTED",
      spotAgeMs: 90_000,
      depthAgeMs: 90_000,
      transportLivenessHealthy: false,
      reconnectInFlight: false
    });
    expect(decision.action).toBe("SCHEDULE_TRANSPORT_RECONNECT");
    expect((decision as { reason?: string }).reason).toBe(
      "transport_liveness_lost"
    );

    // Resume inbound cohort.
    t.emitFakeInboundHeartbeatForTests();
    expect(t.getResearchTransportHeartbeatTelemetry().transportLivenessHealthy).toBe(
      true
    );
    t.disconnect();
  });
});
