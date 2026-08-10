import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const getMock = vi.fn();
const collectionGroupMock = vi.fn(() => ({
  limit: vi.fn(() => ({ get: getMock }))
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collectionGroup: collectionGroupMock
  })
}));

import { listOwnersNeedingQuoteRefresh } from "../../../../src/services/broker/ctrader/quoteStore";

describe("listOwnersNeedingQuoteRefresh (keepalive owners)", () => {
  beforeEach(() => {
    getMock.mockReset();
    collectionGroupMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not use inequality filter (avoids missing COLLECTION_GROUP index)", async () => {
    getMock.mockResolvedValue({
      docs: [
        {
          ref: { path: "users/uidA/ctraderConnection/current" },
          data: () => ({
            ownerUid: "uidA",
            selectedAccountId: "48014710",
            symbolId: "41",
            disconnectedAt: null
          })
        },
        {
          ref: { path: "users/uidB/ctraderConnection/current" },
          data: () => ({
            ownerUid: "uidB",
            selectedAccountId: null,
            symbolId: "41"
          })
        }
      ]
    });

    const owners = await listOwnersNeedingQuoteRefresh(50);
    expect(owners).toEqual(["uidA"]);
    // Only collectionGroup().limit().get() — no .where(...)
    expect(collectionGroupMock).toHaveBeenCalledWith("ctraderConnection");
    const limitFn = collectionGroupMock.mock.results[0]?.value?.limit;
    expect(limitFn).toHaveBeenCalled();
  });

  it("returns [] on query failure without throwing", async () => {
    getMock.mockRejectedValue(new Error("FAILED_PRECONDITION"));
    await expect(listOwnersNeedingQuoteRefresh(10)).resolves.toEqual([]);
  });
});
