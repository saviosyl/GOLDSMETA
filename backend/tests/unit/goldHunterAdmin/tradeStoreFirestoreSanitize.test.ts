import { describe, expect, it } from "vitest";
import { stripUndefinedForFirestore } from "../../../src/services/goldHunterAdmin/tradeStore";

describe("stripUndefinedForFirestore", () => {
  it("drops undefined keys including nested entryReconcileEvidence optionals", () => {
    const trade = {
      goldHunterTradeId: "GH-D-ac23097e",
      status: "PENDING_RECONCILIATION",
      entryReconcileEvidence: {
        reconciliationAttempts: 1,
        lastReconcileAt: "2026-08-18T13:22:00.000Z",
        lastBrokerReadOk: true,
        successfulEmptyProofCycles: 0,
        firstSuccessfulEmptyProofAt: null,
        lastSuccessfulEmptyProofAt: null,
        lastHistoryComplete: false,
        terminalReason: null,
        openPositionChecks: undefined,
        orderHistoryChecks: undefined,
        dealHistoryChecks: undefined,
        firstReconcileAt: undefined
      },
      brokerOrderId: undefined
    };

    const sanitized = stripUndefinedForFirestore(trade);
    expect(sanitized).toEqual({
      goldHunterTradeId: "GH-D-ac23097e",
      status: "PENDING_RECONCILIATION",
      entryReconcileEvidence: {
        reconciliationAttempts: 1,
        lastReconcileAt: "2026-08-18T13:22:00.000Z",
        lastBrokerReadOk: true,
        successfulEmptyProofCycles: 0,
        firstSuccessfulEmptyProofAt: null,
        lastSuccessfulEmptyProofAt: null,
        lastHistoryComplete: false,
        terminalReason: null
      }
    });
    expect(
      JSON.stringify(sanitized).includes("openPositionChecks")
    ).toBe(false);
  });
});
