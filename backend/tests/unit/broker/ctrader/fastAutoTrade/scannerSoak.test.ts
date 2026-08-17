import { describe, expect, it } from "vitest";
import {
  runBoundedFastScanCycle,
  runOverlappingBoundedScans,
  simulateFastScanSoak
} from "../../../../../src/services/broker/ctrader/fastAutoTrade/scanScheduler";
import {
  createAtomicMemoryClaimBackend,
  generateFastClientOrderId,
  reserveFastExecutionClaim,
  resetFastExecutionClaimsForTests,
  updateFastExecutionClaim,
  useFastExecutionClaimBackendForTests
} from "../../../../../src/services/broker/ctrader/fastAutoTrade/executionClaimStore";
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

  it("overlapping one-minute invocations do not duplicate FAST orders", async () => {
    const backend = createAtomicMemoryClaimBackend();
    useFastExecutionClaimBackendForTests(backend);
    await resetFastExecutionClaimsForTests();
    const signalId = "fast_overlap_minute";
    const clientOrderId = generateFastClientOrderId(signalId);
    let newOrderReqCount = 0;
    const overlap = await runOverlappingBoundedScans({
      firstBudgetMs: 90,
      secondBudgetMs: 90,
      secondStartDelayMs: 20,
      scan: async () => {
        const reserved = await reserveFastExecutionClaim({
          ownerUid: "soak_owner",
          signalId,
          clientOrderId
        });
        if (reserved.ok) {
          newOrderReqCount += 1;
          await updateFastExecutionClaim("soak_owner", signalId, {
            state: "BROKER_ACCEPTED_PENDING_FILL",
            requestSent: true,
            newOrderReqCount: 1
          });
        }
        await new Promise((r) => setTimeout(r, 35));
        return { evaluated: true };
      }
    });
    useFastExecutionClaimBackendForTests(null);
    expect(newOrderReqCount).toBe(1);
    expect(overlap.first.scanRan).toBe(true);
    expect(overlap.second.scanRan).toBe(true);
    expect(overlap.queueHighWater).toBeLessThanOrEqual(2);
    expect(overlap.deadlock).toBe(false);
  });

  it("BoundedOpTimeoutError is distinct from a hang", async () => {
    const err = new BoundedOpTimeoutError("QUOTE", 12_000);
    expect(err.message).toBe("QUOTE_TIMEOUT");
    expect(err.timeoutMs).toBe(12_000);
  });
});
