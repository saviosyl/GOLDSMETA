import { describe, expect, it } from "vitest";
import { isCTraderLiveEnabled } from "../../../../src/services/broker/ctrader/flags";
import { PersistentXauUsdQuoteWorker } from "../../../../src/services/broker/ctrader/persistentQuoteWorker";

describe("persistent quote worker contract", () => {
  it("exposes websocketPersistent=true in status and starts disconnected", () => {
    const worker = new PersistentXauUsdQuoteWorker();
    const status = worker.getStatus();
    expect(status.websocketPersistent).toBe(true);
    expect(status.connected).toBe(false);
    expect(status.running).toBe(false);
    expect(status.lockHeld).toBe(false);
    expect(status.lastQuote).toBeNull();
  });

  it("keeps Live order submission hard-locked while pricing worker exists", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
    expect(isCTraderLiveEnabled({ CTRADER_LIVE_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(
      false
    );
  });
});
