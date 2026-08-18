import { describe, expect, it } from "vitest";
import {
  FAST_CLIENT_ORDER_ID_MAX_LEN,
  generateFastClientOrderId,
  isLegacyTruncatedFastClientOrderId
} from "../../../../../src/services/broker/ctrader/fastAutoTrade/clientOrderId";

describe("FAST clientOrderId", () => {
  it("is deterministic for the same ownerUid + signalId", () => {
    const a = generateFastClientOrderId("fast_BUY_BREAKOUT_long", "owner-1");
    const b = generateFastClientOrderId("fast_BUY_BREAKOUT_long", "owner-1");
    expect(a).toBe(b);
    expect(a.length).toBeLessThanOrEqual(FAST_CLIENT_ORDER_ID_MAX_LEN);
    expect(a.startsWith("fa_")).toBe(true);
  });

  it("differs across owners with the same signalId", () => {
    const a = generateFastClientOrderId("fast_BUY_BREAKOUT_same", "owner-a");
    const b = generateFastClientOrderId("fast_BUY_BREAKOUT_same", "owner-b");
    expect(a).not.toBe(b);
  });

  it("100,000 long signalIds sharing the first 50 characters produce zero collisions", () => {
    const owner = "owner-collision";
    const prefix =
      "fast_BUY_PULLBACK_CONTINUATION_PULLBACK_CONTINUATION:BULLISH:4399_5_1:";
    expect(prefix.length).toBeGreaterThan(50);
    const seen = new Set<string>();
    for (let i = 0; i < 100_000; i += 1) {
      const signalId = `${prefix}${String(i).padStart(8, "0")}:tail`;
      const id = generateFastClientOrderId(signalId, owner);
      expect(id.length).toBeLessThanOrEqual(FAST_CLIENT_ORDER_ID_MAX_LEN);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(100_000);
  });

  it("marks the production truncated pattern as legacy", () => {
    expect(
      isLegacyTruncatedFastClientOrderId("fa_fast_BUY_PULLBACK_CONTINUATION_PULLBACK_")
    ).toBe(true);
    expect(
      isLegacyTruncatedFastClientOrderId(
        generateFastClientOrderId("fast_BUY_BREAKOUT_x", "owner")
      )
    ).toBe(false);
  });
});
