import { describe, expect, it } from "vitest";
import { isCTraderLiveEnabled } from "../../../../src/services/broker/ctrader/flags";
import { PersistentXauUsdQuoteWorker } from "../../../../src/services/broker/ctrader/persistentQuoteWorker";
import {
  evaluateQuoteStreamHealth,
  isQuoteWorkerHealthy
} from "../../../../src/services/broker/ctrader/quoteStreamHealth";

describe("persistent quote worker contract", () => {
  it("exposes websocketPersistent=true in status and starts disconnected", () => {
    const worker = new PersistentXauUsdQuoteWorker();
    const status = worker.getStatus();
    expect(status.websocketPersistent).toBe(true);
    expect(status.connected).toBe(false);
    expect(status.running).toBe(false);
    expect(status.lockHeld).toBe(false);
    expect(status.lastQuote).toBeNull();
    expect(status.lastValidQuoteAtMs).toBeNull();
    expect(status.lastPersistedQuoteAtMs).toBeNull();
  });

  it("B/C: heartbeat-style running+lockHeld is unhealthy when quote stream stalled", () => {
    const stream = evaluateQuoteStreamHealth({
      nowMs: Date.now(),
      lastValidQuoteAtMs: Date.now() - 120_000,
      lastPersistedQuoteAtMs: Date.now() - 120_000,
      marketStatus: "OPEN",
      stallAfterMs: 20_000
    });
    expect(stream.stalled).toBe(true);
    expect(
      isQuoteWorkerHealthy({ running: true, lockHeld: true, stream })
    ).toBe(false);
  });

  it("keeps Live order submission hard-locked while pricing worker exists", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
    expect(isCTraderLiveEnabled({ CTRADER_LIVE_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(
      false
    );
  });
});
