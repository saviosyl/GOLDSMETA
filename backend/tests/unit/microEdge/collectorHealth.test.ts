import { describe, expect, it } from "vitest";
import { MicroCTraderReadOnlyClient } from "../../../src/services/microEdge/marketData/microCTraderClient";
import {
  evaluateCollectorHealth,
  getCollectorStatus
} from "../../../src/services/microEdge/runtime/collector";
import { buildQuote } from "../../../src/services/microEdge/marketData/quoteRepository";
import type { MicroBar } from "../../../src/services/microEdge/types";

describe("Micro Edge collector health (fail-closed)", () => {
  it("does not hard-code healthy when feed is disconnected", () => {
    const client = new MicroCTraderReadOnlyClient();
    const status = getCollectorStatus(client, {
      lastQuoteTs: null,
      lastM1CloseTs: null,
      quote: null,
      lastM1: null,
      nowMs: Date.now()
    });
    expect(status.healthy).toBe(false);
    expect(status.marketFeedStatus).toBe("Market feed not connected");
    expect(status.connectionState).toBe("LIVE_NOT_CONNECTED");
    expect(status.degradedDecision).toBe("WAIT");
    expect(status.dataUnavailable).toBe(true);
    expect(status.reasons).toContain("market_feed_not_connected");
  });

  it("reports MOCK_SEEDED when data is injected (still not live)", () => {
    const client = new MicroCTraderReadOnlyClient();
    const now = Date.parse("2026-08-12T12:00:00.000Z");
    client.seedQuote(
      buildQuote({
        bid: 2000,
        ask: 2000.1,
        brokerTimestamp: new Date(now).toISOString(),
        nowMs: now,
        freshness: "LIVE"
      })
    );
    expect(client.isLiveMarketFeedConnected()).toBe(false);
    expect(client.connectionState()).toBe("MOCK_SEEDED");
    expect(client.marketFeedStatusMessage()).toBe("Market feed not connected");
  });

  it("requires valid fresh quote + completed M1 when feed connected", () => {
    const now = Date.parse("2026-08-12T12:00:00.000Z");
    const quote = buildQuote({
      bid: 2000,
      ask: 2000.1,
      brokerTimestamp: new Date(now).toISOString(),
      nowMs: now,
      freshness: "LIVE"
    });
    const m1: MicroBar = {
      timeframe: "M1",
      openTimeMs: now - 60_000,
      closeTimeMs: now,
      open: 2000,
      high: 2000.2,
      low: 1999.8,
      close: 2000.05,
      tickVolume: 10
    };
    const ok = evaluateCollectorHealth({
      quote,
      lastM1: m1,
      nowMs: now + 1_000,
      marketFeedConnected: true
    });
    expect(ok.healthy).toBe(true);

    const stale = evaluateCollectorHealth({
      quote,
      lastM1: m1,
      nowMs: now + 120_000,
      marketFeedConnected: true
    });
    expect(stale.healthy).toBe(false);
    expect(stale.reasons.some((r) => r.includes("stale") || r.includes("missing"))).toBe(
      true
    );
  });

  it("capability states distinguish interface / seeded / not-connected / gated", () => {
    const client = new MicroCTraderReadOnlyClient();
    expect(client.isInterfaceReady()).toBe(true);
    const states = client.capabilityStates();
    expect(states.M1_TRENDBARS).toBe("LIVE_NOT_CONNECTED");
    expect(states.DEPTH_OF_MARKET).toBe("FEATURE_GATED");
    expect(states.HISTORICAL_TICKS).toBe("FEATURE_GATED");
  });
});
