import { describe, expect, it } from "vitest";
import { deriveAutoTradeHeaderStatus } from "./autoTradeHeaderStatus";
import type { QualificationPublicView } from "./broker/qualificationTypes";
import { demoAutoLabelFromAuthority } from "./broker/demoAutoAuthority";
import type { DemoAutoAuthorityApi } from "./broker/demoAutoAuthority";

function baseQual(over: Partial<QualificationPublicView> = {}): QualificationPublicView {
  return {
    state: "READY_TO_QUALIFY",
    overallLabel: "Demo Auto not active",
    accountMasked: "48…10",
    accountIdPresent: true,
    environment: "DEMO",
    nextAction: "Start Demo Auto qualification",
    nextRequirement: "Start",
    blockers: [],
    canStart: true,
    canPause: false,
    canResume: false,
    canEnableDemoAuto: false,
    canBeginLiveActivation: false,
    preview: { completed: 0, required: 20 },
    controlledDemo: { completed: 0, required: 5, open: 0, blockedAttempts: 0 },
    observation: { day: null, requiredDays: 7, firstTradeAt: null, remainingMs: null },
    safety: { completed: 0, required: 6, checks: [] },
    liveEligibility: {
      demoAutoTrades: 0,
      requiredTrades: 10,
      observationDay: null,
      requiredDays: 14,
      criticalSafetyFailures: 0,
      status: "LOCKED"
    },
    demoAuto: { enabled: false, ready: false },
    liveOrders: "LOCKED",
    recentPreviews: [],
    recentControlledTrades: [],
    startedAt: null,
    updatedAt: null,
    ...over
  };
}

describe("header when Demo Auto not started", () => {
  it("shows DEMO AUTO NOT ACTIVE instead of QUALIFYING", () => {
    const h = deriveAutoTradeHeaderStatus({
      qualification: baseQual(),
      status: {
        displayStatus: "OFF",
        mode: "OFF",
        locked: false,
        lockReason: null,
        emergencyStopActive: false,
        liveExecutionFeatureEnabled: false,
        selectedBroker: "PEPPERSTONE_CTRADER",
        brokerBadge: "PEPPERSTONE CTRADER DEMO — READ ONLY",
        igParked: true,
        t212: null,
        t212RiskLimits: {} as never,
        t212GoldCandidates: [],
        t212LastDiagnosticReport: null,
        t212PendingProposal: null,
        t212Disclaimer: "",
        connection: {
          connected: true,
          environment: "DEMO",
          accountIdMasked: "48…10",
          accountName: null,
          currency: "EUR",
          balance: null,
          available: null,
          marginUsed: null,
          marketStatus: null
        },
        limits: {} as never,
        budget: {} as never,
        positions: [],
        activity: [],
        strategyVersion: "test",
        goldCandidates: [],
        proposedEpic: null,
        selectionRequired: false,
        lastDiagnosticReport: null
      }
    });
    expect(h.label).toBe("DEMO AUTO NOT ACTIVE");
    expect(h.nextAction).toBe("Start Demo Auto qualification");
  });

  it("authority ON wins over legacy mode OFF (reload / deploy persistence)", () => {
    const authority: DemoAutoAuthorityApi = {
      enabled: true,
      label: "ON",
      reasons: [],
      qualificationState: "LIVE_QUALIFICATION",
      intentEnabled: true,
      paused: false,
      emergencyStop: false,
      demoSubmissionFlag: true,
      selectedDemoAccount: "48…10",
      tradingScope: "trading",
      quoteHealthy: true,
      executionEligible: true,
      authorityLabel: "DEMO_AUTO",
      startedAt: "2026-08-08T00:00:00.000Z",
      demoAutoEnabledAt: "2026-08-10T00:00:00.000Z",
      quoteAgeSeconds: 2,
      quoteExecutable: true,
      marketStatus: "OPEN"
    };
    expect(demoAutoLabelFromAuthority(authority)).toBe("ON");
    const h = deriveAutoTradeHeaderStatus({
      qualification: baseQual({
        state: "LIVE_QUALIFICATION",
        startedAt: authority.startedAt,
        demoAuto: { enabled: true, ready: true },
        demoAutoAuthority: authority
      }),
      status: {
        displayStatus: "DEMO",
        mode: "OFF",
        locked: false,
        lockReason: null,
        emergencyStopActive: false,
        liveExecutionFeatureEnabled: false,
        demoAutoAuthority: authority,
        selectedBroker: "PEPPERSTONE_CTRADER",
        brokerBadge: "PEPPERSTONE CTRADER DEMO — READ ONLY",
        igParked: true,
        t212: null,
        t212RiskLimits: {} as never,
        t212GoldCandidates: [],
        t212LastDiagnosticReport: null,
        t212PendingProposal: null,
        t212Disclaimer: "",
        connection: {
          connected: true,
          environment: "DEMO",
          accountIdMasked: "48…10",
          accountName: null,
          currency: "EUR",
          balance: null,
          available: null,
          marginUsed: null,
          marketStatus: "OPEN"
        },
        limits: {} as never,
        budget: {} as never,
        positions: [],
        activity: [],
        strategyVersion: "test",
        goldCandidates: [],
        proposedEpic: null,
        selectionRequired: false,
        lastDiagnosticReport: null
      }
    });
    expect(h.stateKey).toBe("DEMO_AUTO");
    expect(h.label).toMatch(/DEMO AUTO/);
  });
});
