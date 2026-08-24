import { describe, expect, it } from "vitest";
import { defaultGhFastConfig } from "../../../src/services/goldHunterAdmin/abc/defaults";
import {
  selectV6R03ExecutableSetup,
  selectV6TrendContinuationFallback
} from "../../../src/services/goldHunterAdmin/abc/featurePipeline";
import type { GhFastFeatureSnapshot } from "../../../src/services/goldHunterAdmin/abc/features";
import type { M1CandleFlowEvaluation } from "../../../src/services/goldHunterAdmin/abc/m1CandleFlow";

function strongBreakout(
  side: "BUY" | "SELL",
  overrides: Partial<GhFastFeatureSnapshot> = {}
): GhFastFeatureSnapshot {
  const buy = side === "BUY";
  const mid = 4600;
  return {
    mid,
    spread: 0.08,
    priorHigh5s: buy ? 4599.55 : 4600.5,
    priorLow5s: buy ? 4599.5 : 4600.45,
    midVel250: buy ? 0.0005 : -0.0005,
    midVel500: buy ? 0.00045 : -0.00045,
    midVel1s: buy ? 0.00055 : -0.00055,
    acceleration: buy ? 0.0002 : -0.0002,
    signedImbalance1s: buy ? 0.6 : -0.6,
    efficiency1s: 0.9,
    updateRate1s: 20,
    depth: {
      depthImbalance: buy ? 0.4 : -0.4,
      removeRateAsk: buy ? 10 : 2,
      removeRateBid: buy ? 2 : 10
    },
    ...overrides
  } as unknown as GhFastFeatureSnapshot;
}

function waitingFlow(
  side: "BUY" | "SELL",
  overrides: Partial<M1CandleFlowEvaluation> = {}
): M1CandleFlowEvaluation {
  const buy = side === "BUY";
  return {
    eligible: false,
    side,
    waitReason: "WAIT_PULLBACK_TOO_SHALLOW",
    regime: buy ? "TREND_UP" : "TREND_DOWN",
    currentCandleAgeSec: 25,
    currentM1Displacement: buy ? 0.7 : -0.7,
    recentNoise: 0.2,
    ...overrides
  } as unknown as M1CandleFlowEvaluation;
}

describe("Brain V6 Revision 03 diagnostic trend continuation", () => {
  it("detects a strong BUY breakout for diagnostics", () => {
    const hit = selectV6TrendContinuationFallback(
      strongBreakout("BUY"),
      defaultGhFastConfig(),
      waitingFlow("BUY")
    );
    expect(hit?.setup).toBe("B_FAST_BREAKOUT");
    expect(hit?.side).toBe("BUY");
    expect(hit?.reasons).toContain("v6_trend_continuation_fallback");
  });

  it("detects the symmetric strong SELL continuation for diagnostics", () => {
    const hit = selectV6TrendContinuationFallback(
      strongBreakout("SELL"),
      defaultGhFastConfig(),
      waitingFlow("SELL")
    );
    expect(hit?.setup).toBe("B_FAST_BREAKOUT");
    expect(hit?.side).toBe("SELL");
  });

  it("does not override a RANGE/chop regime", () => {
    const hit = selectV6TrendContinuationFallback(
      strongBreakout("BUY"),
      defaultGhFastConfig(),
      waitingFlow("BUY", { regime: "RANGE", waitReason: "WAIT_CHOP" })
    );
    expect(hit).toBeNull();
  });

  it("requires the forming M1 candle to agree with the breakout", () => {
    const hit = selectV6TrendContinuationFallback(
      strongBreakout("BUY"),
      defaultGhFastConfig(),
      waitingFlow("BUY", { currentM1Displacement: -0.2 })
    );
    expect(hit).toBeNull();
  });

  it("does not promote inefficient immediate price action", () => {
    const hit = selectV6TrendContinuationFallback(
      strongBreakout("BUY", { efficiency1s: 0.3 }),
      defaultGhFastConfig(),
      waitingFlow("BUY")
    );
    expect(hit).toBeNull();
  });

  it("does not promote opening-noise or dying-candle entries", () => {
    expect(
      selectV6TrendContinuationFallback(
        strongBreakout("BUY"),
        defaultGhFastConfig(),
        waitingFlow("BUY", { currentCandleAgeSec: 3 })
      )
    ).toBeNull();
    expect(
      selectV6TrendContinuationFallback(
        strongBreakout("BUY"),
        defaultGhFastConfig(),
        waitingFlow("BUY", { currentCandleAgeSec: 58 })
      )
    ).toBeNull();
  });

  it("never promotes a diagnostic continuation to executable selection", () => {
    const diagnostic = selectV6TrendContinuationFallback(
      strongBreakout("BUY"),
      defaultGhFastConfig(),
      waitingFlow("BUY")
    );
    expect(diagnostic?.setup).toBe("B_FAST_BREAKOUT");
    expect(selectV6R03ExecutableSetup(null, diagnostic)).toBeNull();
    expect(selectV6R03ExecutableSetup(diagnostic, null)).toBeNull();
  });

  it("preserves a qualified Setup A when a diagnostic candidate is present", () => {
    const setupA = {
      setup: "A_MOMENTUM_IGNITION" as const,
      side: "BUY" as const,
      quality: 0.8,
      reasons: ["pulse_guard_buy"]
    };
    const diagnostic = selectV6TrendContinuationFallback(
      strongBreakout("BUY"),
      defaultGhFastConfig(),
      waitingFlow("BUY")
    );
    expect(selectV6R03ExecutableSetup(setupA, diagnostic)).toBe(setupA);
  });
});
