import { describe, expect, it } from "vitest";
import { evaluateFastManagement } from "../../../../../src/services/broker/ctrader/fastAutoTrade";

describe("FAST_AUTOTRADE_V1 management", () => {
  it("does not move to break-even on early noise", () => {
    const r = evaluateFastManagement({
      side: "BUY",
      entry: 3380,
      currentPrice: 3381.1,
      currentSl: 3377.2,
      initialSl: 3377.2,
      tp1: 3382.2,
      openedAtMs: 0,
      nowMs: 60_000,
      atr: 2.4,
      regime: "FAST",
      momentumCollapsed: false,
      oppositeStructureBreak: false,
      alreadyBreakeven: false
    });
    expect(r.action).toBe("HOLD");
  });

  it("moves to break-even after configured R", () => {
    const r = evaluateFastManagement({
      side: "BUY",
      entry: 3380,
      currentPrice: 3383.5,
      currentSl: 3377.2,
      initialSl: 3377.2,
      tp1: 3382.2,
      openedAtMs: 0,
      nowMs: 120_000,
      atr: 2.4,
      regime: "FAST",
      momentumCollapsed: false,
      oppositeStructureBreak: false,
      alreadyBreakeven: false
    });
    expect(r.action).toBe("MOVE_SL_TO_BREAKEVEN");
    expect(r.newStopLoss).toBe(3380);
  });

  it("exits stale trade only when momentum is gone", () => {
    const hold = evaluateFastManagement({
      side: "BUY",
      entry: 3380,
      currentPrice: 3380.1,
      currentSl: 3377.2,
      initialSl: 3377.2,
      tp1: 3382.2,
      openedAtMs: 0,
      nowMs: 10 * 60_000,
      atr: 2.4,
      regime: "FAST",
      momentumCollapsed: false,
      oppositeStructureBreak: false,
      alreadyBreakeven: false
    });
    expect(hold.action).toBe("HOLD");
    const stale = evaluateFastManagement({
      side: "BUY",
      entry: 3380,
      currentPrice: 3380.1,
      currentSl: 3377.2,
      initialSl: 3377.2,
      tp1: 3382.2,
      openedAtMs: 0,
      nowMs: 10 * 60_000,
      atr: 2.4,
      regime: "FAST",
      momentumCollapsed: true,
      oppositeStructureBreak: false,
      alreadyBreakeven: false
    });
    expect(stale.action).toBe("EXIT_STALE");
  });
});
