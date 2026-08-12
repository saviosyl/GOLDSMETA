import { beforeEach, describe, expect, it, vi } from "vitest";

const getDailySafetyDoc = vi.fn();
const saveDailySafetyDoc = vi.fn();
const listOpenPositionLifecycles = vi.fn();
const getActiveQualificationAccountId = vi.fn();
const getQualificationDoc = vi.fn();
const saveQualificationDoc = vi.fn();
const reconcileDemoBrokerPositions = vi.fn();
const reconcileClosedTradesWithoutErasingPnl = vi.fn();

vi.mock("../../../../src/services/broker/ctrader/dailySafetyStore", () => ({
  getDailySafetyDoc: (...a: unknown[]) => getDailySafetyDoc(...a),
  saveDailySafetyDoc: (...a: unknown[]) => saveDailySafetyDoc(...a)
}));
vi.mock("../../../../src/services/broker/ctrader/positionLifecycleStore", () => ({
  listOpenPositionLifecycles: (...a: unknown[]) => listOpenPositionLifecycles(...a)
}));
vi.mock("../../../../src/services/broker/ctrader/qualificationStore", () => ({
  getActiveQualificationAccountId: (...a: unknown[]) =>
    getActiveQualificationAccountId(...a),
  getQualificationDoc: (...a: unknown[]) => getQualificationDoc(...a),
  saveQualificationDoc: (...a: unknown[]) => saveQualificationDoc(...a),
  normalizeAccountId: (id: unknown) =>
    id == null ? null : String(id).trim() || null,
  findForeignStartedQualifications: vi.fn(async () => [])
}));
vi.mock("../../../../src/services/broker/ctrader/demoPositionMutations", () => ({
  reconcileDemoBrokerPositions: (...a: unknown[]) => reconcileDemoBrokerPositions(...a)
}));
vi.mock("../../../../src/services/broker/ctrader/demoCloseAccounting.js", () => ({
  reconcileClosedTradesWithoutErasingPnl: (...a: unknown[]) =>
    reconcileClosedTradesWithoutErasingPnl(...a)
}));
vi.mock("../../../../src/services/broker/ctrader/demoCloseAccounting", () => ({
  reconcileClosedTradesWithoutErasingPnl: (...a: unknown[]) =>
    reconcileClosedTradesWithoutErasingPnl(...a)
}));

import { reconcileDemoOpenPositionCounters } from "../../../../src/services/broker/ctrader/openPositionReconcile";

describe("reconcileDemoOpenPositionCounters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveQualificationAccountId.mockResolvedValue("48014710");
    reconcileClosedTradesWithoutErasingPnl.mockResolvedValue({
      examined: 0,
      repaired: 0,
      skipped: 0,
      errors: []
    });
  });

  it("A: healthy — lifecycle open matches counter → no broker call", async () => {
    getDailySafetyDoc.mockResolvedValue({ openPositions: 1, tradesUsed: 1 });
    listOpenPositionLifecycles.mockResolvedValue([{ correlationId: "c1" }]);
    const r = await reconcileDemoOpenPositionCounters("uid");
    expect(r.clearedGhost).toBe(false);
    expect(r.brokerChecked).toBe(false);
    expect(reconcileDemoBrokerPositions).not.toHaveBeenCalled();
  });

  it("C: heartbeat-style ghost — counter>0, no lifecycle, broker flat → clear + repair", async () => {
    getDailySafetyDoc.mockResolvedValue({
      openPositions: 1,
      tradesUsed: 1,
      countedTradeIds: ["open:corr_x"]
    });
    listOpenPositionLifecycles.mockResolvedValue([]);
    reconcileDemoBrokerPositions.mockResolvedValue([]);
    saveDailySafetyDoc.mockResolvedValue(undefined);

    const r = await reconcileDemoOpenPositionCounters("uid");
    expect(r.clearedGhost).toBe(true);
    expect(r.after).toBe(0);
    expect(r.repairAttempted).toBe(true);
    expect(saveDailySafetyDoc).toHaveBeenCalled();
    // Must NOT invent CLOSED + null pnl — repair path owns close accounting.
    expect(saveQualificationDoc).not.toHaveBeenCalled();
    expect(reconcileClosedTradesWithoutErasingPnl).toHaveBeenCalledWith("uid");
  });

  it("fail closed when broker reconcile fails — do not clear counter", async () => {
    getDailySafetyDoc.mockResolvedValue({ openPositions: 1, tradesUsed: 1 });
    listOpenPositionLifecycles.mockResolvedValue([]);
    reconcileDemoBrokerPositions.mockRejectedValue(new Error("TOKEN_FAIL"));
    const r = await reconcileDemoOpenPositionCounters("uid");
    expect(r.clearedGhost).toBe(false);
    expect(r.after).toBe(1);
    expect(saveDailySafetyDoc).not.toHaveBeenCalled();
  });

  it("broker still open → keep blocking (counter mirrors broker)", async () => {
    getDailySafetyDoc.mockResolvedValue({ openPositions: 1, tradesUsed: 1 });
    listOpenPositionLifecycles.mockResolvedValue([]);
    reconcileDemoBrokerPositions.mockResolvedValue([{ positionId: "9" }]);
    saveDailySafetyDoc.mockResolvedValue(undefined);
    const r = await reconcileDemoOpenPositionCounters("uid");
    expect(r.clearedGhost).toBe(false);
    expect(r.brokerOpen).toBe(1);
    expect(r.after).toBe(1);
  });
});
