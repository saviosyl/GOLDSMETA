import { describe, expect, it } from "vitest";
import {
  MICRO_TRENDBAR_PERIOD,
  assertReadOnlyCommand,
  parseMicroTrendbars,
  barDocumentId,
  MICRO_BANNED_MUTATION_COMMANDS
} from "../../../src/services/microEdge/marketData/microCTraderProtocol";
import { FakeMicroCTraderTransport } from "../../../src/services/microEdge/marketData/microCTraderTransport";
import { resolveMicroXauUsd } from "../../../src/services/microEdge/marketData/microCTraderSymbolResolver";
import { validateSpotPayload } from "../../../src/services/microEdge/marketData/microCTraderQuotes";
import {
  detectCompletedM1,
  filterBarsAtOrBeforeCutoff,
  assertNoLookahead
} from "../../../src/services/microEdge/marketData/completedBars";
import { filterCompletedBars } from "../../../src/services/microEdge/marketData/microCTraderTrendbars";
import { MemoryMicroMarketDataStore, makeRawBar } from "../../../src/services/microEdge/marketData/marketDataStore";
import { runHistoricalBackfill } from "../../../src/services/microEdge/marketData/backfill";
import { createFakeLiveSession } from "../../../src/services/microEdge/marketData/liveSession";
import { loadMicroCTraderCredentials } from "../../../src/services/microEdge/marketData/microCTraderAuth";
import { createMicroPacer, withBoundedRetries } from "../../../src/services/microEdge/marketData/pacing";
import { selectExpiredQuoteIds } from "../../../src/services/microEdge/marketData/retention";
import { MICRO_SPOT_PRICE_SCALE } from "../../../src/services/microEdge/marketData/microCTraderProtocol";

function rawTrendbar(openMinute: number, lowRel: number, vol: number) {
  return {
    utcTimestampInMinutes: openMinute,
    low: lowRel,
    deltaOpen: 0,
    deltaClose: 100, // +0.001 after scale? 100/100000 = 0.001
    deltaHigh: 200,
    volume: vol
  };
}

describe("Micro market-data protocol + transport", () => {
  it("maps M1/M5/M15 period enums", () => {
    expect(MICRO_TRENDBAR_PERIOD.M1).toBe(1);
    expect(MICRO_TRENDBAR_PERIOD.M5).toBe(5);
    expect(MICRO_TRENDBAR_PERIOD.M15).toBe(7);
  });

  it("parses OHLC + tick volume + timestamps", () => {
    const bars = parseMicroTrendbars([rawTrendbar(1_700_000, 2000 * MICRO_SPOT_PRICE_SCALE, 42)], "M1");
    expect(bars).toHaveLength(1);
    expect(bars[0]!.tickVolume).toBe(42);
    expect(bars[0]!.openTimeMs).toBe(1_700_000 * 60 * 1000);
    expect(bars[0]!.closeTimeMs - bars[0]!.openTimeMs).toBe(60_000);
    expect(bars[0]!.low).toBeCloseTo(2000, 5);
  });

  it("bans mutation commands and allows read commands", () => {
    expect(() => assertReadOnlyCommand("ProtoOAGetTrendbarsReq")).not.toThrow();
    expect(() =>
      assertReadOnlyCommand("ProtoOAGetAccountListByAccessTokenReq")
    ).not.toThrow();
    for (const cmd of MICRO_BANNED_MUTATION_COMMANDS) {
      expect(() => assertReadOnlyCommand(cmd)).toThrow(/BANNED|NOT_ALLOWED/);
    }
    const fake = new FakeMicroCTraderTransport();
    expect(fake.mutationSurface).toBe("NONE");
  });

  it("resolves exact XAUUSD and rejects silver/ambiguity", () => {
    expect(
      resolveMicroXauUsd([
        { symbolId: 1, symbolName: "XAUUSD", baseAsset: "XAU", quoteAsset: "USD" },
        { symbolId: 2, symbolName: "XAGUSD", baseAsset: "XAG", quoteAsset: "USD" }
      ])?.symbolId
    ).toBe("1");
    expect(
      resolveMicroXauUsd([
        { symbolId: 1, symbolName: "XAUUSD" },
        { symbolId: 2, symbolName: "XAUUSD" }
      ])
    ).toBeNull();
    expect(resolveMicroXauUsd([{ symbolId: 9, symbolName: "XAUEUR" }])).toBeNull();
  });

  it("validates Bid/Ask and rejects ask < bid / missing", () => {
    expect(
      validateSpotPayload({
        bid: 2000 * MICRO_SPOT_PRICE_SCALE,
        ask: 2000.2 * MICRO_SPOT_PRICE_SCALE,
        timestamp: 1,
        symbolId: 41
      })
    ).toMatchObject({ bid: 2000, ask: 2000.2 });
    expect(
      validateSpotPayload({
        bid: 2000 * MICRO_SPOT_PRICE_SCALE,
        ask: 1999 * MICRO_SPOT_PRICE_SCALE
      })
    ).toEqual({ error: "quote_invalid" });
    expect(validateSpotPayload({})).toEqual({ error: "quote_missing" });
  });

  it("completed M1 detection rejects forming bar and is idempotent", () => {
    const now = Date.parse("2026-08-12T12:05:00.000Z");
    const completed = {
      openTimeMs: now - 60_000,
      closeTimeMs: now,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      tickVolume: 1
    };
    const forming = {
      openTimeMs: now,
      closeTimeMs: now + 60_000,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      tickVolume: 1
    };
    const seen = new Set<number>();
    const a = detectCompletedM1({ bars: [completed, forming], nowMs: now, seenCloseTimes: seen });
    expect(a).toHaveLength(1);
    const b = detectCompletedM1({ bars: [completed, forming], nowMs: now, seenCloseTimes: seen });
    expect(b).toHaveLength(0);
    expect(filterCompletedBars([completed, forming], now)).toHaveLength(1);
  });

  it("M5/M15 cutoff <= M1 timestamp (no lookahead)", () => {
    const t = 1_000_000;
    const bars = [
      { closeTimeMs: t - 1, timeframe: "M5" as const },
      { closeTimeMs: t, timeframe: "M15" as const },
      { closeTimeMs: t + 1, timeframe: "M5" as const }
    ];
    const filtered = filterBarsAtOrBeforeCutoff(bars, t);
    expect(filtered).toHaveLength(2);
    expect(() => assertNoLookahead(filtered, t)).not.toThrow();
    expect(() => assertNoLookahead(bars, t)).toThrow(/LOOKAHEAD/);
  });

  it("idempotent bar upsert + conflict without overwrite", async () => {
    const store = new MemoryMicroMarketDataStore();
    const bar = makeRawBar({
      symbol: "XAUUSD",
      symbolId: "41",
      timeframe: "M1",
      openTimeMs: 1000,
      closeTimeMs: 61_000,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      tickVolume: 9,
      environment: "DEMO"
    });
    expect(await store.upsertBar(bar)).toBe("created");
    expect(await store.upsertBar(bar)).toBe("skipped_identical");
    expect(
      await store.upsertBar({ ...bar, close: 1.7 })
    ).toBe("conflict");
    expect((await store.getBar(bar.id))!.close).toBe(1.5);
    expect(barDocumentId("XAUUSD", "M1", 61_000)).toBe(bar.id);
  });

  it("backfill is resumable and respects rate-limit pause", async () => {
    const store = new MemoryMicroMarketDataStore();
    const fake = new FakeMicroCTraderTransport();
    await fake.connect();
    const now = Date.parse("2026-08-12T12:00:00.000Z");
    const openMin = Math.floor((now - 120_000) / 60000);
    fake.trendbarsByTf.set("M1", [
      rawTrendbar(openMin, 2000 * MICRO_SPOT_PRICE_SCALE, 3)
    ]);
    const results = await runHistoricalBackfill({
      transport: fake,
      store,
      symbol: "XAUUSD",
      symbolId: "41",
      environment: "DEMO",
      timeframes: ["M1"],
      nowMs: now,
      daysByTf: { M1: 1 },
      minIntervalMs: 1
    });
    expect(results[0]!.status).toBe("COMPLETED");
    expect(await store.countBars("M1")).toBeGreaterThan(0);
    // duplicate run skips
    const again = await runHistoricalBackfill({
      transport: fake,
      store,
      symbol: "XAUUSD",
      symbolId: "41",
      environment: "DEMO",
      timeframes: ["M1"],
      nowMs: now,
      daysByTf: { M1: 1 },
      minIntervalMs: 1
    });
    expect(again[0]!.skipped).toBeGreaterThan(0);
  });

  it("live session fail-closed without credentials / XAUUSD", async () => {
    const missing = loadMicroCTraderCredentials({});
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.missing.length).toBeGreaterThan(0);

    const store = new MemoryMicroMarketDataStore();
    const { session, fake } = createFakeLiveSession(store);
    fake.symbols = [{ symbolId: 2, symbolName: "XAGUSD", baseAsset: "XAG", quoteAsset: "USD" }];
    await expect(session.connect()).rejects.toMatchObject({ code: "xauusd_not_found" });
  });

  it("live session connects, resolves XAUUSD, retrieves quote — mutation surface NONE", async () => {
    const store = new MemoryMicroMarketDataStore();
    const now = Date.parse("2026-08-12T12:00:00.000Z");
    const { session, fake } = createFakeLiveSession(store, undefined, () => now + 1_000);
    fake.nextSpot = {
      bid: 2400 * MICRO_SPOT_PRICE_SCALE,
      ask: 2400.2 * MICRO_SPOT_PRICE_SCALE,
      timestamp: now,
      symbolId: 41
    };
    await session.connect();
    await new Promise((r) => setImmediate(r));
    expect(session.mutationSurface).toBe("NONE");
    expect(fake.getSubscribeSpotsCallCount()).toBe(1);
    const q = await session.refreshQuote();
    expect(q.bid).toBeCloseTo(2400, 4);
    await store.upsertBar(
      makeRawBar({
        symbol: "XAUUSD",
        symbolId: "41",
        timeframe: "M1",
        openTimeMs: now - 60_000,
        closeTimeMs: now,
        open: 2400,
        high: 2401,
        low: 2399,
        close: 2400.1,
        tickVolume: 10,
        environment: "DEMO"
      })
    );
    const state = await session.getState();
    expect(state.symbol?.symbolName).toBe("XAUUSD");
    expect(state.liveConnected).toBe(true);
    expect(await store.countQuotes()).toBe(1);
    // polling must not create more subscriptions
    await session.getState();
    expect(fake.getSubscribeSpotsCallCount()).toBe(1);
  });

  it("quote sample interval collapses duplicates in same bucket", async () => {
    let t = Date.parse("2026-08-12T12:00:00.000Z");
    const store2 = new MemoryMicroMarketDataStore();
    const fake2 = new FakeMicroCTraderTransport();
    fake2.configuredAccountId = "123";
    fake2.authorizedAccountIds = ["123"];
    const { MicroLiveMarketSession } = await import(
      "../../../src/services/microEdge/marketData/liveSession"
    );
    const s = new MicroLiveMarketSession({
      store: store2,
      transport: fake2,
      credentials: {
        clientId: "t",
        clientSecret: "t",
        accessToken: "a",
        refreshToken: "r",
        accountId: "123",
        environment: "DEMO",
        tokenUrl: "x",
        authUrl: "y",
        redirectUri: null
      },
      quoteSampleIntervalMs: 5000,
      nowMs: () => t
    });
    fake2.nextSpot = {
      bid: 1 * MICRO_SPOT_PRICE_SCALE,
      ask: 1.1 * MICRO_SPOT_PRICE_SCALE,
      timestamp: t,
      symbolId: 41
    };
    await s.connect();
    await new Promise((r) => setImmediate(r));
    expect(await store2.countQuotes()).toBe(1);
    t += 1000;
    s.ingestSpotEventForTests({
      bid: 1 * MICRO_SPOT_PRICE_SCALE,
      ask: 1.1 * MICRO_SPOT_PRICE_SCALE,
      timestamp: t,
      symbolId: 41
    });
    expect(await store2.countQuotes()).toBe(1);
    t += 5000;
    s.ingestSpotEventForTests({
      bid: 1 * MICRO_SPOT_PRICE_SCALE,
      ask: 1.1 * MICRO_SPOT_PRICE_SCALE,
      timestamp: t,
      symbolId: 41
    });
    expect(await store2.countQuotes()).toBe(2);
    expect(fake2.getSubscribeSpotsCallCount()).toBe(1);
  });

  it("rate-limit pacing retries then succeeds", async () => {
    const pacer = createMicroPacer({ minIntervalMs: 1, maxBackoffMs: 10 });
    let n = 0;
    const result = await withBoundedRetries({
      maxAttempts: 3,
      pacer,
      isRateLimit: (e) => (e as { code?: string }).code === "rate_limited",
      run: async () => {
        n += 1;
        if (n < 2) throw Object.assign(new Error("rl"), { code: "rate_limited" });
        return "ok";
      }
    });
    expect(result).toBe("ok");
    expect(n).toBe(2);
  });

  it("retention helper selects expired quotes without deleting", () => {
    const now = Date.parse("2026-08-12T00:00:00.000Z");
    const ids = selectExpiredQuoteIds(
      [
        { id: "old", brokerTimestamp: new Date(now - 40 * 86400000).toISOString() },
        { id: "new", brokerTimestamp: new Date(now - 2 * 86400000).toISOString() }
      ],
      now,
      30
    );
    expect(ids).toEqual(["old"]);
  });

  it("API diagnostics never include tokens", async () => {
    const { buildMarketDataDiagnosticsPayload } = await import(
      "../../../src/services/microEdge/marketData/marketDataService"
    );
    const d = await buildMarketDataDiagnosticsPayload();
    expect(d.accessToken).toBeUndefined();
    expect(d.refreshToken).toBeUndefined();
    expect(d.clientSecret).toBeUndefined();
    expect(d.mutationSurface).toBe("NONE");
    expect(String(d.marketFeedStatus)).toMatch(/not connected/i);
  });
});
