import { describe, expect, it } from "vitest";
import { matchReconcileByClientOrderId } from "../../../../../src/services/broker/ctrader/demoTransport/orderReconcile";

describe("legacy clientOrderId reconcile", () => {
  it("fails closed when a truncated ID matches more than one outstanding claim", () => {
    const r = matchReconcileByClientOrderId({
      clientOrderId: "fa_fast_BUY_PULLBACK_CONTINUATION_PULLBACK_",
      snapshot: {
        orders: [
          {
            orderId: "o1",
            positionId: "p1",
            clientOrderId: "fa_fast_BUY_PULLBACK_CONTINUATION_PULLBACK_"
          }
        ],
        positions: []
      },
      outstandingClaimClientOrderIds: [
        "fa_fast_BUY_PULLBACK_CONTINUATION_PULLBACK_",
        "fa_fast_BUY_PULLBACK_CONTINUATION_PULLBACK_"
      ]
    });
    expect(r.matched).toBe(false);
    if (r.matched) return;
    expect(r.reason).toBe("AMBIGUOUS_LEGACY_CLIENT_ORDER_ID");
  });
});
