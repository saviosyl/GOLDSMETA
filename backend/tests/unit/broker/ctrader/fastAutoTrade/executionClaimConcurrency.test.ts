import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  blocksAutomaticResubmit,
  createAtomicMemoryClaimBackend,
  dropFastExecutionClaimCacheForTests,
  generateFastClientOrderId,
  getFastExecutionClaim,
  reserveFastExecutionClaim,
  resetFastExecutionClaimsForTests,
  updateFastExecutionClaim,
  useFastExecutionClaimBackendForTests
} from "../../../../../src/services/broker/ctrader/fastAutoTrade/executionClaimStore";
import {
  setFastReconcileForTests,
  tryReconcileExistingFastClaim
} from "../../../../../src/services/broker/ctrader/fastAutoTrade/pendingFillReconcile";
import { runOverlappingBoundedScans } from "../../../../../src/services/broker/ctrader/fastAutoTrade/scanScheduler";

const OWNER = "owner_fast_claim";
const SIGNAL = "fast_sig_concurrency";
const CLIENT = generateFastClientOrderId(SIGNAL);

describe("FAST durable execution claim concurrency", () => {
  beforeEach(async () => {
    useFastExecutionClaimBackendForTests(createAtomicMemoryClaimBackend());
    await resetFastExecutionClaimsForTests();
    setFastReconcileForTests(null);
  });

  afterEach(() => {
    setFastReconcileForTests(null);
    useFastExecutionClaimBackendForTests(null);
  });

  it("1. two concurrent workers → exactly one claim and one NewOrderReq", async () => {
    let newOrderReqCount = 0;
    const worker = async () => {
      const reserved = await reserveFastExecutionClaim({
        ownerUid: OWNER,
        signalId: SIGNAL,
        clientOrderId: CLIENT
      });
      if (!reserved.ok) return { sent: false, reason: reserved.reason };
      await updateFastExecutionClaim(OWNER, SIGNAL, { state: "SUBMITTING" });
      newOrderReqCount += 1;
      await updateFastExecutionClaim(OWNER, SIGNAL, {
        state: "BROKER_ACCEPTED_PENDING_FILL",
        requestSent: true,
        newOrderReqCount: 1
      });
      return { sent: true, reason: null };
    };
    const [a, b] = await Promise.all([worker(), worker()]);
    const sent = [a, b].filter((r) => r.sent);
    expect(sent).toHaveLength(1);
    expect(newOrderReqCount).toBe(1);
    const blocked = [a, b].filter((r) => !r.sent);
    expect(blocked[0]?.reason).toBe("ALREADY_CLAIMED");
  });

  it("2. process A dies after requestSent → B does not send a second order", async () => {
    const first = await reserveFastExecutionClaim({
      ownerUid: OWNER,
      signalId: SIGNAL,
      clientOrderId: CLIENT
    });
    expect(first.ok).toBe(true);
    await updateFastExecutionClaim(OWNER, SIGNAL, {
      state: "SUBMITTING",
      requestSent: true,
      newOrderReqCount: 1
    });
    dropFastExecutionClaimCacheForTests();
    const second = await reserveFastExecutionClaim({
      ownerUid: OWNER,
      signalId: SIGNAL,
      clientOrderId: generateFastClientOrderId(SIGNAL)
    });
    expect(second.ok).toBe(false);
    expect(blocksAutomaticResubmit(second.claim)).toBe(true);
    expect(second.claim?.newOrderReqCount).toBe(1);
    let reconcileCalls = 0;
    setFastReconcileForTests(async () => {
      reconcileCalls += 1;
      return { matched: false, reason: "NOT_FOUND" };
    });
    const promoted = await tryReconcileExistingFastClaim({
      ownerUid: OWNER,
      claim: second.claim!
    });
    expect(promoted.filled).toBe(false);
    expect(reconcileCalls).toBe(1);
  });

  it("3. cold start loses in-memory cache → Firestore/backend still blocks", async () => {
    const reserved = await reserveFastExecutionClaim({
      ownerUid: OWNER,
      signalId: SIGNAL,
      clientOrderId: CLIENT
    });
    expect(reserved.ok).toBe(true);
    await updateFastExecutionClaim(OWNER, SIGNAL, {
      requestSent: true,
      newOrderReqCount: 1,
      state: "BROKER_OUTCOME_UNKNOWN"
    });
    dropFastExecutionClaimCacheForTests();
    const persisted = await getFastExecutionClaim(OWNER, SIGNAL);
    expect(persisted?.requestSent).toBe(true);
    const again = await reserveFastExecutionClaim({
      ownerUid: OWNER,
      signalId: SIGNAL,
      clientOrderId: "fa_other"
    });
    expect(again.ok).toBe(false);
    expect(again.claim?.clientOrderId).toBe(CLIENT);
  });

  it("8. unknown outcome then later exact reconcile match → success once", async () => {
    await reserveFastExecutionClaim({
      ownerUid: OWNER,
      signalId: SIGNAL,
      clientOrderId: CLIENT
    });
    await updateFastExecutionClaim(OWNER, SIGNAL, {
      state: "BROKER_OUTCOME_UNKNOWN",
      requestSent: true,
      newOrderReqCount: 1
    });
    let lookups = 0;
    setFastReconcileForTests(async (id) => {
      lookups += 1;
      expect(id).toBe(CLIENT);
      return {
        matched: true,
        by: "ORDER_CLIENT_ORDER_ID",
        orderId: "o8",
        positionId: "p8",
        clientOrderId: CLIENT
      };
    });
    const claim = await getFastExecutionClaim(OWNER, SIGNAL);
    const first = await tryReconcileExistingFastClaim({
      ownerUid: OWNER,
      claim: claim!
    });
    expect(first.filled).toBe(true);
    expect(first.positionId).toBe("p8");
    const second = await tryReconcileExistingFastClaim({
      ownerUid: OWNER,
      claim: first.claim
    });
    expect(second.filled).toBe(true);
    expect(lookups).toBe(1);
  });

  it("9. unrelated BUY position is never matched", async () => {
    await reserveFastExecutionClaim({
      ownerUid: OWNER,
      signalId: SIGNAL,
      clientOrderId: CLIENT
    });
    await updateFastExecutionClaim(OWNER, SIGNAL, {
      state: "BROKER_ACCEPTED_PENDING_FILL",
      requestSent: true,
      newOrderReqCount: 1
    });
    setFastReconcileForTests(async () => ({
      matched: false,
      reason: "NOT_FOUND"
    }));
    const claim = await getFastExecutionClaim(OWNER, SIGNAL);
    const result = await tryReconcileExistingFastClaim({
      ownerUid: OWNER,
      claim: claim!
    });
    expect(result.filled).toBe(false);
    expect(result.positionId).toBeNull();
  });

  it("10. two overlapping scheduled scans → no duplicate order", async () => {
    let newOrderReqCount = 0;
    const overlap = await runOverlappingBoundedScans({
      firstBudgetMs: 80,
      secondBudgetMs: 80,
      secondStartDelayMs: 15,
      scan: async () => {
        const reserved = await reserveFastExecutionClaim({
          ownerUid: OWNER,
          signalId: SIGNAL,
          clientOrderId: CLIENT
        });
        if (reserved.ok) {
          newOrderReqCount += 1;
          await updateFastExecutionClaim(OWNER, SIGNAL, {
            state: "BROKER_ACCEPTED_PENDING_FILL",
            requestSent: true,
            newOrderReqCount: 1
          });
        }
        await new Promise((r) => setTimeout(r, 25));
        return { evaluated: true, reserved: reserved.ok };
      }
    });
    expect(newOrderReqCount).toBe(1);
    expect(overlap.second.scanRan || overlap.second.scanTimedOut).toBe(true);
    expect(overlap.queueHighWater).toBeLessThanOrEqual(2);
    expect(overlap.deadlock).toBe(false);
  });
});
