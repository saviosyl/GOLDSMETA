import { describe, expect, it } from "vitest";
import {
  evaluateQuoteStreamHealth,
  isQuoteWorkerHealthy,
  isWorkerLockQuoteStale
} from "../../../../src/services/broker/ctrader/quoteStreamHealth";
import { isCTraderLiveEnabled } from "../../../../src/services/broker/ctrader/flags";

describe("quoteStreamHealth", () => {
  const nowMs = 1_700_000_000_000;

  it("A: healthy worker + fresh quotes → no recovery (not stalled)", () => {
    const stream = evaluateQuoteStreamHealth({
      nowMs,
      lastValidQuoteAtMs: nowMs - 3_000,
      lastPersistedQuoteAtMs: nowMs - 3_000,
      marketStatus: "OPEN",
      stallAfterMs: 20_000
    });
    expect(stream.stalled).toBe(false);
    expect(stream.reason).toBe("OK");
    expect(
      isQuoteWorkerHealthy({ running: true, lockHeld: true, stream })
    ).toBe(true);
  });

  it("B: heartbeat-irrelevant — fresh lock context but quote stream stale → stall detected", () => {
    const stream = evaluateQuoteStreamHealth({
      nowMs,
      lastValidQuoteAtMs: nowMs - 45_000,
      lastPersistedQuoteAtMs: nowMs - 45_000,
      marketStatus: "OPEN",
      stallAfterMs: 20_000
    });
    expect(stream.stalled).toBe(true);
    expect(stream.reason).toBe("VALID_QUOTE_STALE");
    expect(
      isQuoteWorkerHealthy({ running: true, lockHeld: true, stream })
    ).toBe(false);
  });

  it("C: valid spots without Firestore persist → PERSIST_STALE (triggers recovery)", () => {
    const stream = evaluateQuoteStreamHealth({
      nowMs,
      lastValidQuoteAtMs: nowMs - 1_000,
      lastPersistedQuoteAtMs: nowMs - 60_000,
      marketStatus: "OPEN",
      stallAfterMs: 20_000
    });
    expect(stream.stalled).toBe(true);
    expect(stream.reason).toBe("PERSIST_STALE");
  });

  it("D: recovery success path — after persist resumes, stream healthy again", () => {
    const stalled = evaluateQuoteStreamHealth({
      nowMs,
      lastValidQuoteAtMs: nowMs - 30_000,
      lastPersistedQuoteAtMs: nowMs - 30_000,
      stallAfterMs: 20_000
    });
    expect(stalled.stalled).toBe(true);

    const recovered = evaluateQuoteStreamHealth({
      nowMs: nowMs + 5_000,
      lastValidQuoteAtMs: nowMs + 4_000,
      lastPersistedQuoteAtMs: nowMs + 4_000,
      stallAfterMs: 20_000
    });
    expect(recovered.stalled).toBe(false);
    expect(recovered.reason).toBe("OK");
  });

  it("F: worker lock quote-stale allows steal; fresh quote does not", () => {
    expect(
      isWorkerLockQuoteStale({
        nowMs,
        lastSuccessfulQuoteAt: new Date(nowMs - 60_000).toISOString(),
        staleAfterMs: 45_000
      })
    ).toBe(true);
    expect(
      isWorkerLockQuoteStale({
        nowMs,
        lastSuccessfulQuoteAt: new Date(nowMs - 10_000).toISOString(),
        staleAfterMs: 45_000
      })
    ).toBe(false);
    expect(
      isWorkerLockQuoteStale({
        nowMs,
        lastSuccessfulQuoteAt: null,
        staleAfterMs: 45_000
      })
    ).toBe(true);
  });

  it("market CLOSED uses longer stall window (quiet-period safe)", () => {
    const stream = evaluateQuoteStreamHealth({
      nowMs,
      lastValidQuoteAtMs: nowMs - 60_000,
      lastPersistedQuoteAtMs: nowMs - 60_000,
      marketStatus: "CLOSED",
      stallAfterMs: 20_000,
      stallAfterMsMarketClosed: 600_000
    });
    expect(stream.stalled).toBe(false);
    expect(stream.stallAfterMs).toBe(600_000);
  });

  it("G: Live trading remains hard-locked", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
    expect(
      isCTraderLiveEnabled({ CTRADER_LIVE_ENABLED: "true" } as NodeJS.ProcessEnv)
    ).toBe(false);
  });
});
