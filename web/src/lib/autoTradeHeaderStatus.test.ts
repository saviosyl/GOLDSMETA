import { describe, expect, it } from "vitest";
import { deriveAutoTradeHeaderStatus } from "./autoTradeHeaderStatus";
import type { QualificationPublicView } from "./broker/qualificationTypes";
import { buildReviewAutoTradeStatus } from "./autoTradeTypes";

function qual(partial: Partial<QualificationPublicView>): QualificationPublicView {
  return {
    state: "PREVIEW_QUALIFICATION",
    overallLabel: "Preview qualification",
    accountMasked: "****4810",
    accountIdPresent: true,
    environment: "DEMO",
    nextAction: "Waiting for valid market setup",
    nextRequirement: "Complete 20 previews",
    blockers: [],
    canStart: false,
    canPause: true,
    canResume: false,
    canEnableDemoAuto: false,
    canBeginLiveActivation: false,
    preview: { completed: 0, required: 20 },
    controlledDemo: { completed: 0, required: 5, open: 0, blockedAttempts: 0 },
    observation: { day: null, requiredDays: 7, firstTradeAt: null, remainingMs: null },
    safety: { completed: 6, required: 6, checks: [] },
    liveEligibility: {
      demoAutoTrades: 0,
      requiredTrades: 20,
      observationDay: null,
      requiredDays: 7,
      criticalSafetyFailures: 0,
      status: "LOCKED"
    },
    demoAuto: { enabled: false, ready: false },
    liveOrders: "LOCKED",
    recentPreviews: [],
    recentControlledTrades: [],
    startedAt: null,
    updatedAt: null,
    ...partial
  };
}

describe("deriveAutoTradeHeaderStatus", () => {
  it("shows DEMO · QUALIFYING during preview qualification (not OFF)", () => {
    const result = deriveAutoTradeHeaderStatus({
      qualification: qual({ state: "PREVIEW_QUALIFICATION" }),
      status: buildReviewAutoTradeStatus()
    });
    expect(result.label).toBe("DEMO · QUALIFYING");
    expect(result.stateKey).toBe("QUALIFYING");
    expect(result.label).not.toMatch(/OFF/i);
  });

  it("shows DEMO AUTO · READY when demo auto is ready", () => {
    const result = deriveAutoTradeHeaderStatus({
      qualification: qual({
        state: "DEMO_AUTO_READY",
        demoAuto: { enabled: false, ready: true }
      }),
      status: buildReviewAutoTradeStatus()
    });
    expect(result.stateKey).toBe("DEMO_AUTO_READY");
    expect(result.label).toMatch(/AUTO READY/i);
  });

  it("shows DEMO · PAUSED when paused", () => {
    const result = deriveAutoTradeHeaderStatus({
      qualification: qual({ state: "PAUSED" }),
      status: buildReviewAutoTradeStatus()
    });
    expect(result.stateKey).toBe("DEMO_PAUSED");
  });

  it("shows OFF when no qualification activity", () => {
    const result = deriveAutoTradeHeaderStatus({
      qualification: null,
      status: buildReviewAutoTradeStatus({ mode: "OFF", displayStatus: "OFF" })
    });
    expect(result.stateKey).toBe("OFF");
  });
});
