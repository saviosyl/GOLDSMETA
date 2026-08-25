import { describe, expect, it } from "vitest";
import { isCTraderLiveEnabled } from "../../../../src/services/broker/ctrader/flags";
import {
  buildAuthoritativeQuoteFromCachedSchedule,
  resolveCachedScheduleMarketStatus
} from "../../../../src/services/broker/ctrader/persistentQuoteWorker";
import type { ScheduleInterval } from "../../../../src/services/broker/ctrader/marketSchedule";
import { DEFAULT_LIVE_QUOTE_THRESHOLDS } from "../../../../src/services/broker/ctrader/liveQuote";

/**
 * Pepperstone-like XAUUSD weekly intervals (seconds from Sunday 00:00 in America/New_York).
 * Includes a ~62 minute daily rollover gap (CLOSED) between sessions.
 */
const XAUUSD_SCHEDULE: ScheduleInterval[] = [
  { startSecond: 64860, endSecond: 147540 },
  { startSecond: 151260, endSecond: 233940 },
  { startSecond: 237660, endSecond: 320340 },
  { startSecond: 324060, endSecond: 406740 },
  { startSecond: 410460, endSecond: 492900 }
];

const TZ = "America/New_York";

/** Monday 17:30 NY — inside the daily rollover CLOSED gap. */
const CLOSED_ROLLOVER = new Date("2026-08-10T21:30:00.000Z");
/** Tuesday 03:05 NY / Dublin ~08:05 — OPEN session after rollover. */
const OPEN_AFTER_ROLLOVER = new Date("2026-08-11T07:05:00.000Z");
/** Tuesday 17:30 NY — next rollover CLOSED. */
const CLOSED_NEXT_ROLLOVER = new Date("2026-08-11T21:30:00.000Z");
/** Tuesday 18:10 NY — OPEN again after gap. */
const OPEN_AFTER_NEXT = new Date("2026-08-11T22:10:00.000Z");

function quoteAt(now: Date, overrides: { bid?: number; ask?: number; ageMs?: number } = {}) {
  const ageMs = overrides.ageMs ?? 50;
  const brokerTs = new Date(now.getTime() - ageMs).toISOString();
  return buildAuthoritativeQuoteFromCachedSchedule({
    symbolId: "41",
    symbolName: "XAUUSD",
    digits: 2,
    pipPosition: 1,
    bid: overrides.bid ?? 4362.8,
    ask: overrides.ask ?? 4362.91,
    brokerTimestamp: brokerTs,
    quoteSequence: 1,
    environment: "DEMO",
    schedule: XAUUSD_SCHEDULE,
    scheduleTimeZone: TZ,
    nowMs: now.getTime()
  });
}

describe("persistent quote worker market-status lifecycle (no latch)", () => {
  it("A: worker start during CLOSED → persisted quote CLOSED + non-executable", () => {
    const status = resolveCachedScheduleMarketStatus({
      schedule: XAUUSD_SCHEDULE,
      timeZone: TZ,
      now: CLOSED_ROLLOVER
    });
    expect(status).toBe("CLOSED");
    const q = quoteAt(CLOSED_ROLLOVER);
    expect(q.marketStatus).toBe("CLOSED");
    expect(q.freshness).toBe("MARKET_CLOSED");
    expect(q.executable).toBe(false);
  });

  it("B: same cached schedule, clock advances into OPEN → status OPEN without reconnect", () => {
    // Connect-time evaluation (CLOSED)
    const atConnect = resolveCachedScheduleMarketStatus({
      schedule: XAUUSD_SCHEDULE,
      timeZone: TZ,
      now: CLOSED_ROLLOVER
    });
    expect(atConnect).toBe("CLOSED");

    // Same cached schedule object — no Spotware metadata refetch, no reconnect.
    const later = resolveCachedScheduleMarketStatus({
      schedule: XAUUSD_SCHEDULE,
      timeZone: TZ,
      now: OPEN_AFTER_ROLLOVER
    });
    expect(later).toBe("OPEN");

    const q = quoteAt(OPEN_AFTER_ROLLOVER);
    expect(q.marketStatus).toBe("OPEN");
    expect(q.freshness).not.toBe("MARKET_CLOSED");
  });

  it("C: OPEN → CLOSED transition updates correctly", () => {
    expect(
      resolveCachedScheduleMarketStatus({
        schedule: XAUUSD_SCHEDULE,
        timeZone: TZ,
        now: OPEN_AFTER_ROLLOVER
      })
    ).toBe("OPEN");
    expect(
      resolveCachedScheduleMarketStatus({
        schedule: XAUUSD_SCHEDULE,
        timeZone: TZ,
        now: CLOSED_NEXT_ROLLOVER
      })
    ).toBe("CLOSED");
    const q = quoteAt(CLOSED_NEXT_ROLLOVER);
    expect(q.marketStatus).toBe("CLOSED");
    expect(q.executable).toBe(false);
  });

  it("D: CLOSED → OPEN transition updates correctly", () => {
    expect(
      resolveCachedScheduleMarketStatus({
        schedule: XAUUSD_SCHEDULE,
        timeZone: TZ,
        now: CLOSED_NEXT_ROLLOVER
      })
    ).toBe("CLOSED");
    expect(
      resolveCachedScheduleMarketStatus({
        schedule: XAUUSD_SCHEDULE,
        timeZone: TZ,
        now: OPEN_AFTER_NEXT
      })
    ).toBe("OPEN");
  });

  it("E: fresh quote after OPEN uses normal quote-age / executable logic", () => {
    const q = quoteAt(OPEN_AFTER_ROLLOVER, { ageMs: 50 });
    expect(q.marketStatus).toBe("OPEN");
    expect(q.freshness).toBe("LIVE");
    expect(q.ageMs).toBeLessThanOrEqual(DEFAULT_LIVE_QUOTE_THRESHOLDS.liveMaxAgeMs);
    expect(q.executable).toBe(true);
  });

  it("F: stale quote remains non-executable even when market OPEN", () => {
    const q = quoteAt(OPEN_AFTER_ROLLOVER, { ageMs: 60_000 });
    expect(q.marketStatus).toBe("OPEN");
    expect(q.freshness).toBe("STALE");
    expect(q.executable).toBe(false);
  });

  it("G: wide spread is still visible on the authoritative quote", () => {
    const q = quoteAt(OPEN_AFTER_ROLLOVER, { bid: 4362.0, ask: 4365.5, ageMs: 50 });
    expect(q.marketStatus).toBe("OPEN");
    expect(q.spread).toBeGreaterThan(2);
  });

  it("H: quote becomes executable after CLOSED → OPEN without a reconnect", () => {
    const closedQ = quoteAt(CLOSED_ROLLOVER);
    expect(closedQ.executable).toBe(false);
    expect(closedQ.marketStatus).toBe("CLOSED");

    const openQ = quoteAt(OPEN_AFTER_ROLLOVER, { ageMs: 50 });
    expect(openQ.marketStatus).toBe("OPEN");
    expect(openQ.executable).toBe(true);
  });

  it("I: actual CLOSED session still marks the quote non-executable", () => {
    const q = quoteAt(CLOSED_ROLLOVER);
    expect(q.executable).toBe(false);
    expect(q.marketStatus).toBe("CLOSED");
  });

  it("J: Live Auto remains hard-locked", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
    expect(
      isCTraderLiveEnabled({ CTRADER_LIVE_ENABLED: "true" } as NodeJS.ProcessEnv)
    ).toBe(false);
  });
});
