import { describe, expect, it } from "vitest";
import {
  runBoundedFastScanCycle,
  simulateFastScanSoak
} from "../../../../../src/services/broker/ctrader/fastAutoTrade/scanScheduler";
import { BoundedOpTimeoutError } from "../../../../../src/services/broker/ctrader/fastAutoTrade/boundedOp";

describe("FAST scanner soak", () => {
  it("60-minute deterministic soak stays >=90% coverage without hangs or duplicates", async () => {
    const soak = await simulateFastScanSoak({
      minutes: 60,
      opBoundMs: 40
    });
    expect(soak.expected).toBe(60);
    expect(soak.coverage).toBeGreaterThanOrEqual(0.9);
    expect(soak.maxHangMs).toBeLessThan(2_000);
    expect(soak.duplicateOrders).toBe(0);
    expect(soak.connectionsCreated).toBeLessThanOrEqual(60);
    expect(soak.timedOutMinutes).toBeGreaterThanOrEqual(1);
    expect(soak.timedOutMinutes).toBeLessThanOrEqual(5);
  });

  it("bounded cycle runs scan first and still finishes when manage hangs", async () => {
    const cycle = await runBoundedFastScanCycle({
      scan: async () => ({ scanned: 1, handled: 1 }),
      manage: () =>
        new Promise(() => {
          /* hang */
        }),
      scanBudgetMs: 50,
      manageBudgetMs: 30
    });
    expect(cycle.scanRan).toBe(true);
    expect(cycle.scanResult).toEqual({ scanned: 1, handled: 1 });
    expect(cycle.manageTimedOut).toBe(true);
    expect(cycle.manageRan).toBe(false);
  });

  it("a slow broker read fails that scan and leaves the next tick runnable", async () => {
    const seen: number[] = [];
    await simulateFastScanSoak({
      minutes: 3,
      opBoundMs: 25,
      kindForMinute: (m) => (m === 1 ? "quote_timeout" : "normal"),
      onSubmit: (minute) => {
        seen.push(minute);
      }
    });
    expect(seen).toEqual([2, 3]);
  });

  it("BoundedOpTimeoutError is distinct from a hang", async () => {
    const err = new BoundedOpTimeoutError("QUOTE", 12_000);
    expect(err.message).toBe("QUOTE_TIMEOUT");
    expect(err.timeoutMs).toBe(12_000);
  });
});
