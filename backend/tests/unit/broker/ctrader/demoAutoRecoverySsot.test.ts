/**
 * AutoTrade production recovery — Demo Auto SSOT + silent-drop + Live lock.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  demoAutoAuthorityConflictsWithLegacyMode,
  demoAutoSurfaceLabels,
  evaluateDemoAutoExecutionAuthority,
  toDemoAutoAuthorityApi
} from "../../../../src/services/broker/ctrader/demoAutoExecutionAuthority";
import {
  formatEvaluationActivityMessage,
  reasonLabelFor
} from "../../../../src/services/broker/ctrader/evaluationLogStore";
import {
  isCTraderLiveEnabled,
  isCTraderDemoOrderSubmissionEnabled,
  isBrokerExecutionEnabled
} from "../../../../src/services/broker/ctrader/flags";
import { overallLabel } from "../../../../src/services/broker/ctrader/qualificationMachine";

describe("Demo Auto SSOT authority API", () => {
  const prev = process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
  beforeEach(() => {
    process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = "true";
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
    else process.env.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED = prev;
  });

  it("exposes demoAutoAuthority shape with executionEligible", () => {
    const authority = evaluateDemoAutoExecutionAuthority({
      qualificationState: "LIVE_QUALIFICATION",
      autoTradeEnabledIntent: true,
      autoTradePaused: false,
      emergencyStopActive: false,
      selectedAccountIsLive: false,
      demoOrderSubmissionEnabled: true
    });
    const api = toDemoAutoAuthorityApi({
      authority,
      qualificationState: "LIVE_QUALIFICATION",
      intentEnabled: true,
      paused: false,
      emergencyStop: false,
      demoSubmissionFlag: true,
      selectedDemoAccount: "48…10",
      tradingScope: "trading",
      quoteHealthy: true,
      startedAt: "2026-08-08T00:00:00.000Z",
      demoAutoEnabledAt: "2026-08-10T00:00:00.000Z"
    });
    expect(api.enabled).toBe(true);
    expect(api.label).toBe("ON");
    expect(api.executionEligible).toBe(true);
    expect(api.selectedDemoAccount).toBe("48…10");
    expect(api.tradingScope).toBe("trading");
    const surface = demoAutoSurfaceLabels(api);
    expect(surface.autoTrade).toBe("ON");
    expect(surface.orderSubmissionEnabled).toBe(true);
  });

  it("legacy risk.mode OFF cannot override valid Demo Auto authority ON", () => {
    const authority = evaluateDemoAutoExecutionAuthority({
      qualificationState: "LIVE_QUALIFICATION",
      autoTradeEnabledIntent: true,
      autoTradePaused: false,
      emergencyStopActive: false,
      selectedAccountIsLive: false,
      demoOrderSubmissionEnabled: true
    });
    expect(authority.demoExecutionEnabled).toBe(true);
    expect(
      demoAutoAuthorityConflictsWithLegacyMode({ legacyMode: "OFF", authority })
    ).toBe(true);
    expect(demoAutoSurfaceLabels(authority).autoTrade).toBe("ON");
  });

  it("never auto-enables from false intent", () => {
    const authority = evaluateDemoAutoExecutionAuthority({
      qualificationState: "LIVE_QUALIFICATION",
      autoTradeEnabledIntent: false,
      autoTradePaused: false,
      emergencyStopActive: false,
      selectedAccountIsLive: false,
      demoOrderSubmissionEnabled: true
    });
    expect(authority.demoExecutionEnabled).toBe(false);
    expect(demoAutoSurfaceLabels(authority).autoTrade).toBe("OFF");
  });

  it("emergency stop immediately blocks", () => {
    const authority = evaluateDemoAutoExecutionAuthority({
      qualificationState: "LIVE_QUALIFICATION",
      autoTradeEnabledIntent: true,
      autoTradePaused: false,
      emergencyStopActive: true,
      selectedAccountIsLive: false,
      demoOrderSubmissionEnabled: true
    });
    expect(authority.demoExecutionEnabled).toBe(false);
    expect(authority.reasons).toContain("EMERGENCY_STOP");
  });

  it("Live account → absolute no Demo submission authority", () => {
    const authority = evaluateDemoAutoExecutionAuthority({
      qualificationState: "LIVE_QUALIFICATION",
      autoTradeEnabledIntent: true,
      autoTradePaused: false,
      emergencyStopActive: false,
      selectedAccountIsLive: true,
      demoOrderSubmissionEnabled: true
    });
    expect(authority.demoExecutionEnabled).toBe(false);
    expect(authority.authorityLabel).toBe("DEMO_AUTO_LOCKED_LIVE");
    expect(demoAutoSurfaceLabels(authority).orderSubmissionEnabled).toBe(false);
  });

  it("Live execution flags remain hard false", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
    expect(isBrokerExecutionEnabled()).toBe(false);
    expect(isCTraderDemoOrderSubmissionEnabled()).toBe(true);
  });

  it("hero label is Demo Auto not active when startedAt null", () => {
    expect(overallLabel("READY_TO_QUALIFY", { startedAt: null })).toBe(
      "Demo Auto not active"
    );
    expect(overallLabel("LIVE_QUALIFICATION", { startedAt: "2026-08-08T00:00:00Z" })).toBe(
      "Qualifying"
    );
  });

  it("formats QUALIFICATION_NOT_STARTED activity message", () => {
    expect(reasonLabelFor("QUALIFICATION_NOT_STARTED")).toMatch(/not started/i);
    expect(
      formatEvaluationActivityMessage({
        direction: "BUY",
        confidence: 91,
        outcome: "REJECTED",
        reasonCode: "QUALIFICATION_NOT_STARTED"
      })
    ).toBe("BUY 91/100 skipped — Demo Auto qualification was not started.");
  });

  it("BUY and SELL authority identical when gates pass", () => {
    const buy = evaluateDemoAutoExecutionAuthority({
      qualificationState: "CONTROLLED_DEMO_QUALIFICATION",
      autoTradeEnabledIntent: true,
      autoTradePaused: false,
      emergencyStopActive: false,
      selectedAccountIsLive: false,
      demoOrderSubmissionEnabled: true
    });
    const sell = evaluateDemoAutoExecutionAuthority({
      qualificationState: "CONTROLLED_DEMO_QUALIFICATION",
      autoTradeEnabledIntent: true,
      autoTradePaused: false,
      emergencyStopActive: false,
      selectedAccountIsLive: false,
      demoOrderSubmissionEnabled: true
    });
    expect(buy.demoExecutionEnabled).toBe(true);
    expect(sell.demoExecutionEnabled).toBe(true);
    expect(buy.authorityLabel).toBe(sell.authorityLabel);
  });
});
