import { describe, expect, it } from "vitest";
import {
  formatCountdown,
  msUntilNextPeriodClose,
  resolveNextUpdateKind
} from "./nextPlanUpdate";

describe("nextPlanUpdate", () => {
  it("computes remaining time to the next UTC-aligned period close", () => {
    // 12:07:00 UTC → 8 minutes into a 15m bar → 7m remaining
    const now = Date.UTC(2026, 7, 4, 12, 7, 0);
    expect(msUntilNextPeriodClose(now, 15)).toBe(8 * 60_000);
    expect(formatCountdown(8 * 60_000)).toBe("8m 00s");
  });

  it("selects PLAN_15M for no-valid / building states", () => {
    expect(resolveNextUpdateKind({ planStatus: "NO_VALID_PLAN" })).toBe("PLAN_15M");
    expect(resolveNextUpdateKind({ geometryValid: false })).toBe("PLAN_15M");
  });

  it("selects CONFIRM_5M when in zone awaiting confirmation", () => {
    expect(
      resolveNextUpdateKind({
        planStatus: "ARMED",
        setupProgress: { items: [{ id: "location", mark: "pass", complete: true }] },
        confirmation5m: { state: "NONE", meaningful: false }
      })
    ).toBe("CONFIRM_5M");
  });
});
