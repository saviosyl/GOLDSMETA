import { describe, expect, it } from "vitest";
import {
  submitFastMarketOrder,
  type OrderTransportPort
} from "../../../../../src/services/broker/ctrader/fastAutoTrade/orderTransport";
import {
  blocksAutomaticResubmit,
  generateFastClientOrderId,
  reserveFastExecutionClaim,
  resetFastExecutionClaimsForTests,
  updateFastExecutionClaim
} from "../../../../../src/services/broker/ctrader/fastAutoTrade/executionClaimStore";
import type { ReconcileSnapshot } from "../../../../../src/services/broker/ctrader/fastAutoTrade/orderReconcile";

const SIGNAL = "fast_sig_transport";
const CLIENT = generateFastClientOrderId(SIGNAL);

function request() {
  return {
    ctidTraderAccountId: "48014710",
    symbolId: "1",
    side: "BUY" as const,
    volume: 100,
    clientOrderId: CLIENT
  };
}

function fakeTransport(opts: {
  send?: OrderTransportPort["sendNewOrder"];
  events?: Array<{ name: string; payload: Record<string, unknown>; delayMs?: number }>;
}): OrderTransportPort & { newOrderCount: number } {
  const box = { newOrderCount: 0 };
  return {
    newOrderCount: 0,
    async sendNewOrder(payload) {
      box.newOrderCount += 1;
      (this as { newOrderCount: number }).newOrderCount = box.newOrderCount;
      if (opts.send) return opts.send(payload);
      return { confirmedSent: true, response: {} };
    },
    onEvent(listener) {
      for (const ev of opts.events ?? []) {
        setTimeout(() => listener(ev), ev.delayMs ?? 5);
      }
      return () => undefined;
    }
  };
}

describe("FAST order transport", () => {
  it("1. sendCommand returns ORDER_FILLED — accepted once, no second event required", async () => {
    const transport = fakeTransport({
      send: async () => ({
        confirmedSent: true,
        response: {
          executionType: "ORDER_FILLED",
          order: { orderId: "o1", clientOrderId: CLIENT },
          position: { positionId: "p1" }
        }
      })
    });
    const result = await submitFastMarketOrder({
      request: request(),
      transport,
      eventWaitMs: 50
    });
    expect(result.outcome).toBe("BROKER_FILLED");
    expect(result.accepted).toBe(true);
    expect(result.newOrderReqCount).toBe(1);
    expect(result.orderId).toBe("o1");
    expect(result.positionId).toBe("p1");
  });

  it("2. ORDER_ACCEPTED then fill event — exactly one NewOrder lifecycle", async () => {
    const transport = fakeTransport({
      send: async () => ({
        confirmedSent: true,
        response: {
          executionType: "ORDER_ACCEPTED",
          order: { orderId: "o2", clientOrderId: CLIENT }
        }
      }),
      events: [
        {
          name: "ProtoOAExecutionEvent",
          payload: {
            executionType: "ORDER_FILLED",
            order: { orderId: "o2", clientOrderId: CLIENT },
            position: { positionId: "p2" }
          },
          delayMs: 15
        }
      ]
    });
    const result = await submitFastMarketOrder({
      request: request(),
      transport,
      eventWaitMs: 80
    });
    expect(result.accepted).toBe(true);
    expect(result.newOrderReqCount).toBe(1);
    expect(result.outcome).toBe("BROKER_FILLED");
    expect(result.positionId).toBe("p2");
  });

  it("ORDER_ACCEPTED with no position → not filled, no invented ids", async () => {
    const transport = fakeTransport({
      send: async () => ({
        confirmedSent: true,
        response: {
          executionType: "ORDER_ACCEPTED",
          order: { orderId: "o_acc", clientOrderId: CLIENT }
        }
      })
    });
    const result = await submitFastMarketOrder({
      request: request(),
      transport,
      eventWaitMs: 30,
      reconcileAttempts: 1,
      reconcile: {
        async reconcile(): Promise<ReconcileSnapshot> {
          return { orders: [], positions: [] };
        }
      }
    });
    expect(result.outcome).toBe("BROKER_ACCEPTED");
    expect(result.accepted).toBe(false);
    expect(result.positionId).toBeNull();
    expect(result.fillPrice).toBeNull();
    expect(result.filledVolumeLots).toBeNull();
    expect(result.newOrderReqCount).toBe(1);
  });

  it("ORDER_ACCEPTED then reconcile finds clientOrderId + position → filled once", async () => {
    const transport = fakeTransport({
      send: async () => ({
        confirmedSent: true,
        response: {
          executionType: "ORDER_ACCEPTED",
          order: { orderId: "o_rec", clientOrderId: CLIENT }
        }
      })
    });
    const result = await submitFastMarketOrder({
      request: request(),
      transport,
      eventWaitMs: 20,
      reconcileAttempts: 1,
      reconcile: {
        async reconcile(): Promise<ReconcileSnapshot> {
          return {
            orders: [
              { orderId: "o_rec", positionId: "p_rec", clientOrderId: CLIENT }
            ],
            positions: [
              { positionId: "p_rec", clientOrderId: CLIENT, orderId: "o_rec" }
            ]
          };
        }
      }
    });
    expect(result.outcome).toBe("BROKER_TIMEOUT_RECONCILED_FILLED");
    expect(result.accepted).toBe(true);
    expect(result.positionId).toBe("p_rec");
    expect(result.newOrderReqCount).toBe(1);
  });

  it("3. ProtoOAExecutionEvent FILLED maps correctly", async () => {
    const transport = fakeTransport({
      events: [
        {
          name: "ProtoOAExecutionEvent",
          payload: {
            executionType: "ORDER_FILLED",
            order: { orderId: "o3", clientOrderId: CLIENT },
            position: { positionId: "p3", price: 4400.5 },
            deal: { executionPrice: 4400.5, filledVolume: 100 }
          }
        }
      ]
    });
    const result = await submitFastMarketOrder({
      request: request(),
      transport,
      eventWaitMs: 80
    });
    expect(result.outcome).toBe("BROKER_FILLED");
    expect(result.fillPrice).toBe(4400.5);
    expect(result.filledVolumeLots).toBe(1);
  });

  it("4. ProtoOAOrderErrorEvent → BROKER_REJECTED with sanitized code, not TIMEOUT", async () => {
    const transport = fakeTransport({
      events: [
        {
          name: "ProtoOAOrderErrorEvent",
          payload: {
            errorCode: "NOT_ENOUGH_MONEY",
            description: "insufficient",
            order: { clientOrderId: CLIENT }
          }
        }
      ]
    });
    const result = await submitFastMarketOrder({
      request: request(),
      transport,
      eventWaitMs: 80
    });
    expect(result.outcome).toBe("BROKER_REJECTED");
    expect(result.errorCode).toBe("NOT_ENOUGH_MONEY");
    expect(result.outcome).not.toBe("BROKER_OUTCOME_UNKNOWN");
    expect(String(result.errorCode)).not.toMatch(/TIMEOUT/);
  });

  it("5. ProtoOAErrorRes → BROKER_REJECTED, not silent", async () => {
    const transport = fakeTransport({
      events: [
        {
          name: "ProtoOAErrorRes",
          payload: { errorCode: "ALREADY_LOGGED_IN", clientOrderId: CLIENT }
        }
      ]
    });
    const result = await submitFastMarketOrder({
      request: request(),
      transport,
      eventWaitMs: 80
    });
    expect(result.outcome).toBe("BROKER_REJECTED");
    expect(result.errorCode).toBe("ALREADY_LOGGED_IN");
    expect(result.accepted).toBe(false);
  });

  it("6. command times out BEFORE confirmed send → UNKNOWN (uncertain, not proven non-send)", async () => {
    const transport = fakeTransport({
      send: () =>
        new Promise(() => {
          /* never confirms send — underlying may still be in flight */
        })
    });
    const result = await submitFastMarketOrder({
      request: request(),
      transport,
      sendTimeoutMs: 30,
      sendUncertaintyMs: 40,
      eventWaitMs: 10
    });
    expect(result.outcome).toBe("BROKER_OUTCOME_UNKNOWN");
    expect(result.errorCode).toBe("NEWORDER_SEND_TIMEOUT");
    expect(result.requestSent).toBe(false);
    expect(result.newOrderReqCount).toBe(0);
  });

  it("7. request sent but response lost → UNKNOWN then reconcile before any retry", async () => {
    let reconcileCalls = 0;
    const transport = fakeTransport({});
    const result = await submitFastMarketOrder({
      request: request(),
      transport,
      eventWaitMs: 20,
      reconcileAttempts: 1,
      reconcile: {
        async reconcile(): Promise<ReconcileSnapshot> {
          reconcileCalls += 1;
          return { orders: [], positions: [] };
        }
      }
    });
    expect(result.requestSent).toBe(true);
    expect(result.newOrderReqCount).toBe(1);
    expect(reconcileCalls).toBe(1);
    expect(result.outcome).toBe("BROKER_TIMEOUT_RECONCILED_NOT_FOUND");
  });

  it("8. timeout then reconcile finds clientOrderId → reconciled success, zero second order", async () => {
    const transport = fakeTransport({});
    const result = await submitFastMarketOrder({
      request: request(),
      transport,
      eventWaitMs: 15,
      reconcileAttempts: 1,
      reconcile: {
        async reconcile(): Promise<ReconcileSnapshot> {
          return {
            orders: [
              {
                orderId: "o8",
                positionId: "p8",
                clientOrderId: CLIENT
              }
            ],
            positions: [
              { positionId: "p8", clientOrderId: CLIENT, orderId: "o8" }
            ]
          };
        }
      }
    });
    expect(result.outcome).toBe("BROKER_TIMEOUT_RECONCILED_FILLED");
    expect(result.accepted).toBe(true);
    expect(result.newOrderReqCount).toBe(1);
    expect(result.positionId).toBe("p8");
  });

  it("9. timeout then bounded reconcile finds nothing → terminal safe, no duplicate", async () => {
    const transport = fakeTransport({});
    const result = await submitFastMarketOrder({
      request: request(),
      transport,
      eventWaitMs: 15,
      reconcileAttempts: 1,
      reconcile: {
        async reconcile(): Promise<ReconcileSnapshot> {
          return { orders: [], positions: [] };
        }
      }
    });
    expect(result.outcome).toBe("BROKER_TIMEOUT_RECONCILED_NOT_FOUND");
    expect(result.accepted).toBe(false);
    expect(result.newOrderReqCount).toBe(1);
  });

  it("10. duplicate FAST signal after unknown outcome → ZERO second NewOrderReq", async () => {
    await resetFastExecutionClaimsForTests();
    const first = await reserveFastExecutionClaim({
      ownerUid: "u1",
      signalId: SIGNAL,
      clientOrderId: CLIENT
    });
    expect(first.ok).toBe(true);
    await updateFastExecutionClaim("u1", SIGNAL, {
      state: "BROKER_OUTCOME_UNKNOWN",
      requestSent: true,
      newOrderReqCount: 1
    });
    const second = await reserveFastExecutionClaim({
      ownerUid: "u1",
      signalId: SIGNAL,
      clientOrderId: generateFastClientOrderId(SIGNAL)
    });
    expect(second.ok).toBe(false);
    expect(blocksAutomaticResubmit(second.claim)).toBe(true);
    expect(second.claim.newOrderReqCount).toBe(1);
  });

  it("11. unrelated existing broker position is never mistaken as this order", async () => {
    const transport = fakeTransport({});
    const result = await submitFastMarketOrder({
      request: request(),
      transport,
      eventWaitMs: 15,
      reconcileAttempts: 1,
      reconcile: {
        async reconcile(): Promise<ReconcileSnapshot> {
          return {
            orders: [
              {
                orderId: "other",
                positionId: "pos_other",
                clientOrderId: "someone_else"
              }
            ],
            positions: [
              {
                positionId: "pos_other",
                clientOrderId: "someone_else",
                side: "BUY"
              }
            ]
          };
        }
      }
    });
    expect(result.outcome).toBe("BROKER_TIMEOUT_RECONCILED_NOT_FOUND");
    expect(result.positionId).toBeNull();
  });
});
