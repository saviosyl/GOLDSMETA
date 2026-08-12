/**
 * Execution-boundary authority — submitDemoMarketOrder must not run when authority is OFF.
 */
import { describe, expect, it } from "vitest";
import {
  assertAutonomousDemoSubmissionAllowed,
  evaluateControlledDemoOrderAuthority,
  evaluateDemoAutoExecutionAuthority,
  toDemoAutoAuthorityApi
} from "../../../../src/services/broker/ctrader/demoAutoExecutionAuthority";
import { isCTraderLiveEnabled } from "../../../../src/services/broker/ctrader/flags";

function authorityApi(over: {
  qualificationState?: "LIVE_QUALIFICATION" | "DEMO_AUTO_ENABLED" | "CONTROLLED_DEMO_QUALIFICATION";
  intentEnabled?: boolean;
  paused?: boolean;
  emergencyStop?: boolean;
  demoSubmissionFlag?: boolean;
  selectedDemoAccount?: string | null;
  tradingScope?: "accounts" | "trading" | null;
  quoteHealthy?: boolean;
  selectedAccountIsLive?: boolean;
  marketStatus?: string | null;
}) {
  const core = evaluateDemoAutoExecutionAuthority({
    qualificationState: over.qualificationState ?? "LIVE_QUALIFICATION",
    autoTradeEnabledIntent: over.intentEnabled ?? true,
    autoTradePaused: over.paused ?? false,
    emergencyStopActive: over.emergencyStop ?? false,
    selectedAccountIsLive: over.selectedAccountIsLive ?? false,
    demoOrderSubmissionEnabled: over.demoSubmissionFlag ?? true
  });
  return toDemoAutoAuthorityApi({
    authority: core,
    qualificationState: over.qualificationState ?? "LIVE_QUALIFICATION",
    intentEnabled: over.intentEnabled ?? true,
    paused: over.paused ?? false,
    emergencyStop: over.emergencyStop ?? false,
    demoSubmissionFlag: over.demoSubmissionFlag ?? true,
    selectedDemoAccount: over.selectedDemoAccount ?? "48…10",
    tradingScope: over.tradingScope ?? "trading",
    quoteHealthy: over.quoteHealthy ?? true,
    marketStatus: over.marketStatus ?? "OPEN"
  });
}

describe("autonomous Demo execution boundary", () => {
  it("Intent ON + Demo + trading OAuth + LIVE_QUALIFICATION → submission allowed", () => {
    const api = authorityApi({});
    expect(api.enabled).toBe(true);
    expect(api.submissionAuthorized).toBe(true);
    expect(api.executionEligible).toBe(true);
    expect(assertAutonomousDemoSubmissionAllowed(api)).toEqual({ ok: true });
  });

  it("Intent OFF + LIVE_QUALIFICATION → ZERO submission (essential regression)", () => {
    const api = authorityApi({ intentEnabled: false });
    expect(api.enabled).toBe(false);
    expect(api.reasons).toContain("INTENT_OFF");
    const gate = assertAutonomousDemoSubmissionAllowed(api);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reasonCode).toBe("EXECUTION_AUTHORITY_OFF");
  });

  it("Paused → zero submission", () => {
    const api = authorityApi({ paused: true });
    expect(assertAutonomousDemoSubmissionAllowed(api).ok).toBe(false);
  });

  it("Emergency stop → zero submission", () => {
    const api = authorityApi({ emergencyStop: true });
    expect(assertAutonomousDemoSubmissionAllowed(api).ok).toBe(false);
  });

  it("Accounts-only OAuth → zero submission", () => {
    const api = authorityApi({ tradingScope: "accounts" });
    expect(api.enabled).toBe(true);
    expect(api.submissionAuthorized).toBe(false);
    expect(assertAutonomousDemoSubmissionAllowed(api).ok).toBe(false);
  });

  it("Live account → zero submission", () => {
    const api = authorityApi({ selectedAccountIsLive: true, selectedDemoAccount: null });
    expect(api.enabled).toBe(false);
    expect(assertAutonomousDemoSubmissionAllowed(api).ok).toBe(false);
    expect(isCTraderLiveEnabled()).toBe(false);
  });

  it("Demo runtime submission flag false → zero submission", () => {
    const api = authorityApi({ demoSubmissionFlag: false });
    expect(assertAutonomousDemoSubmissionAllowed(api).ok).toBe(false);
  });

  it("Market closed → authorized but not execution-eligible now", () => {
    const api = authorityApi({ quoteHealthy: false, marketStatus: "CLOSED" });
    expect(api.enabled).toBe(true);
    expect(api.submissionAuthorized).toBe(true);
    expect(api.executionEligible).toBe(false);
    expect(api.executionNowLabel).toBe("WAITING — MARKET CLOSED");
    // Boundary still allows calling into risk/quote gates; quote gate blocks earlier.
    expect(assertAutonomousDemoSubmissionAllowed(api).ok).toBe(true);
  });

  it("Stale/unhealthy quote → not execution-eligible", () => {
    const api = authorityApi({ quoteHealthy: false, marketStatus: "OPEN" });
    expect(api.executionEligible).toBe(false);
    expect(api.executionNowLabel).toMatch(/WAITING/);
  });
});

describe("CONTROLLED_DEMO_QUALIFICATION separate permission", () => {
  it("allows controlled ladder orders without Demo Auto intent", () => {
    const controlled = evaluateControlledDemoOrderAuthority({
      qualificationState: "CONTROLLED_DEMO_QUALIFICATION",
      autoTradePaused: false,
      emergencyStopActive: false,
      selectedAccountIsLive: false,
      demoAccountSelected: true,
      tradingScope: "trading",
      demoOrderSubmissionEnabled: true
    });
    expect(controlled.allowed).toBe(true);
  });

  it("does not allow controlled permission for LIVE_QUALIFICATION (no intent bypass)", () => {
    const controlled = evaluateControlledDemoOrderAuthority({
      qualificationState: "LIVE_QUALIFICATION",
      autoTradePaused: false,
      emergencyStopActive: false,
      selectedAccountIsLive: false,
      demoAccountSelected: true,
      tradingScope: "trading",
      demoOrderSubmissionEnabled: true
    });
    expect(controlled.allowed).toBe(false);
    expect(controlled.reasons).toContain("NOT_CONTROLLED_DEMO_STATE");
  });

  it("autonomous assert rejects CONTROLLED state (must use controlled path)", () => {
    const api = authorityApi({
      qualificationState: "CONTROLLED_DEMO_QUALIFICATION",
      intentEnabled: true
    });
    expect(api.enabled).toBe(false);
    expect(assertAutonomousDemoSubmissionAllowed(api).ok).toBe(false);
  });
});
