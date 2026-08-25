import { describe, expect, it } from "vitest";
import {
  alignTimeframesWithConfirmation,
  resolveAuthoritativeConfirmation
} from "./confirmationAuthority";
import { chartExampleIntradayPlanFixture } from "../fixtures/intradayPlanFixture";

describe("confirmationAuthority", () => {
  it("keeps pending 5M pending — card and timeframe agree", () => {
    const auth = resolveAuthoritativeConfirmation({
      confirmationState: "NONE",
      direction: "BUY"
    });
    expect(auth.label).toBe("Pending");
    expect(auth.meaningful).toBe(false);
    const aligned = alignTimeframesWithConfirmation(
      chartExampleIntradayPlanFixture,
      auth,
      chartExampleIntradayPlanFixture.timeframeAlignment
    );
    const cell5m = aligned.cells.find((c) => c.timeframe === "5M");
    expect(cell5m?.direction).toBe("Pending");
  });

  it("does not let bearish rejection confirm a BUY plan", () => {
    const auth = resolveAuthoritativeConfirmation({
      confirmationState: "REJECTION_CONFIRMED",
      direction: "BUY"
    });
    expect(auth.supportsPlan).toBe(false);
    expect(auth.state).toBe("CONFIRMATION_FAILED");
    expect(auth.label).toMatch(/does not confirm long/i);
  });

  it("allows bullish rejection from support to support a BUY plan", () => {
    const auth = resolveAuthoritativeConfirmation({
      confirmationState: "BULLISH_REJECTION_CONFIRMED",
      direction: "BUY"
    });
    expect(auth.supportsPlan).toBe(true);
  });

  it("formats conflicting confirmation into one authoritative state", () => {
    const auth = resolveAuthoritativeConfirmation({
      confirmationState: "REJECTION_CONFIRMED",
      direction: "BUY_ON_PULLBACK"
    });
    const aligned = alignTimeframesWithConfirmation(
      {
        ...chartExampleIntradayPlanFixture,
        action: "BUY_ON_PULLBACK",
        tradePlan: {
          ...chartExampleIntradayPlanFixture.tradePlan,
          direction: "BUY"
        },
        confirmation5m: {
          state: "REJECTION_CONFIRMED",
          label: "REJECTION CONFIRMED",
          meaningful: true,
          detail: "Bearish rejection"
        },
        timeframeAlignment: {
          cells: [
            {
              timeframe: "5M",
              direction: "Pending",
              label: "Entry confirm",
              tone: "wait"
            }
          ],
          conclusion: "5M Pending"
        }
      },
      auth
    );
    const cell5m = aligned.cells.find((c) => c.timeframe === "5M");
    expect(cell5m?.direction).toBe(auth.label);
    expect(cell5m?.direction).not.toBe("Pending");
    expect(auth.label).not.toMatch(/^REJECTION CONFIRMED$/i);
  });
});
