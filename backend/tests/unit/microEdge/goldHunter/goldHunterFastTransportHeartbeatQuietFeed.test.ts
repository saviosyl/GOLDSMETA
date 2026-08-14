/**
 * GOLD HUNTER FAST — transport heartbeat + quiet-feed correction.
 *
 * Proves Spot/Depth silence with healthy ProtoHeartbeatEvent does NOT
 * full-detach / RESYNC / transport-reconnect (deadf271 loop forensic).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  decideResearchStaleReconnect,
  GH_FAST_RESEARCH_HARD_FEED_STALE_MS,
  GH_FAST_RESEARCH_SOFT_STALE_MS,
  GH_FAST_RESEARCH_TRANSPORT_HEARTBEAT_INTERVAL_MS,
  GH_FAST_RESEARCH_TRANSPORT_LIVENESS_MS
} from "../../../../src/services/microEdge/goldHunter/fast/research/researchStaleReconnectPolicy";
import { FakeMicroCTraderTransport } from "../../../../src/services/microEdge/marketData/microCTraderTransport";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("ctrader-layer heartbeat baseline", () => {
  it("6. package does NOT auto-send heartbeat — callers must use sendHeartbeat()", () => {
    const readme = readFileSync(
      join(
        process.cwd(),
        "node_modules/@reiryoku/ctrader-layer/README.md"
      ),
      "utf8"
    );
    expect(readme).toMatch(/sendHeartbeat/);
    expect(readme).toMatch(/25 seconds|heartbeat/i);
    const src = readFileSync(
      join(
        process.cwd(),
        "node_modules/@reiryoku/ctrader-layer/src/core/CTraderConnection.ts"
      ),
      "utf8"
    );
    expect(src).toMatch(/public sendHeartbeat/);
    // No setInterval heartbeat inside the connection class itself.
    expect(src).not.toMatch(/setInterval\s*\(\s*\(\)\s*=>\s*this\.sendHeartbeat/);
  });

  it("heartbeat cadence constants", () => {
    expect(GH_FAST_RESEARCH_TRANSPORT_HEARTBEAT_INTERVAL_MS).toBe(10_000);
    expect(GH_FAST_RESEARCH_TRANSPORT_LIVENESS_MS).toBe(40_000);
    expect(GH_FAST_RESEARCH_HARD_FEED_STALE_MS).toBe(45_000);
    expect(GH_FAST_RESEARCH_SOFT_STALE_MS).toBe(20_000);
  });
});

describe("quiet market with healthy transport heartbeat", () => {
  it("12+13. 20-minute silence + healthy HB → ZERO transport reconnect / RESYNC", () => {
    let now = 0;
    let transportSchedules = 0;
    let staleSchedules = 0;
    let hardFeed = 0;
    const step = 5_000;
    const horizon = 20 * 60_000;

    for (; now <= horizon; now += step) {
      // Heartbeat every 10s keeps transportMessageAge under 40s.
      const sinceHb = now % 10_000;
      const transportMessageAgeMs = sinceHb;
      const d = decideResearchStaleReconnect({
        nowMs: now,
        connectionState: "CONNECTED",
        spotAgeMs: now, // zero Spot events
        depthAgeMs: now, // zero Depth events
        softStaleMs: GH_FAST_RESEARCH_SOFT_STALE_MS,
        hardStaleReconnectMs: GH_FAST_RESEARCH_HARD_FEED_STALE_MS,
        transportLivenessHealthy:
          transportMessageAgeMs <= GH_FAST_RESEARCH_TRANSPORT_LIVENESS_MS,
        reconnectInFlight: false
      });
      if (d.action === "SCHEDULE_TRANSPORT_RECONNECT") transportSchedules += 1;
      if (d.action === "SCHEDULE_STALE_FEED_RECONNECT") staleSchedules += 1;
      if (d.action === "HARD_FEED_STALE") hardFeed += 1;
    }

    expect(transportSchedules).toBe(0);
    expect(staleSchedules).toBe(0);
    expect(hardFeed).toBeGreaterThan(100);
  });

  it("14+15. stop heartbeats → one transport_liveness_lost reconnect", () => {
    const healthy = decideResearchStaleReconnect({
      nowMs: 100_000,
      connectionState: "CONNECTED",
      spotAgeMs: 120_000,
      depthAgeMs: 120_000,
      transportLivenessHealthy: true,
      reconnectInFlight: false
    });
    expect(healthy.action).toBe("HARD_FEED_STALE");

    const lost = decideResearchStaleReconnect({
      nowMs: 100_000,
      connectionState: "CONNECTED",
      spotAgeMs: 120_000,
      depthAgeMs: 120_000,
      transportLivenessHealthy: false,
      reconnectInFlight: false
    });
    expect(lost.action).toBe("SCHEDULE_TRANSPORT_RECONNECT");
    expect((lost as { reason?: string }).reason).toBe(
      "transport_liveness_lost"
    );
  });
});

describe("FakeMicroCTraderTransport research heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("7-9. opt-in heartbeat ticks ~10s and exposes telemetry", () => {
    const t = new FakeMicroCTraderTransport();
    void t.connect();
    t.enableResearchTransportHeartbeat({
      intervalMs: 10_000,
      livenessTimeoutMs: 40_000,
      nowMs: () => Date.now()
    });
    const before = t.getResearchTransportHeartbeatTelemetry();
    expect(before.researchHeartbeatEnabled).toBe(true);
    vi.advanceTimersByTime(10_000);
    const mid = t.getResearchTransportHeartbeatTelemetry();
    expect(mid.transportHeartbeatSentCount).toBeGreaterThanOrEqual(1);
    expect(mid.transportHeartbeatReceivedCount).toBeGreaterThanOrEqual(1);
    expect(mid.transportLivenessHealthy).toBe(true);
    expect(mid.lastTransportMessageAt).not.toBeNull();
    t.disconnect();
    expect(t.getResearchTransportHeartbeatTelemetry().researchHeartbeatEnabled).toBe(
      false
    );
  });
});
