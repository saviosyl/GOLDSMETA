import { describe, expect, it } from "vitest";
import { deriveDemoAutoPermissionReadiness } from "./demoAutoReadiness";

describe("deriveDemoAutoPermissionReadiness", () => {
  it("1: Demo Auto enabled → green/ready with Demo Auto enabled detail", () => {
    const row = deriveDemoAutoPermissionReadiness({
      isLiveSelected: false,
      demoAccountConnected: true,
      autoTradeEnabledIntent: true,
      autoTradePaused: false,
      emergencyStopActive: false,
      qualificationState: "LIVE_QUALIFICATION",
      demoAutoEnabled: true
    });
    expect(row.ok).toBe(true);
    expect(row.pending).toBe(false);
    expect(row.detail).toBe("Demo Auto enabled");
    expect(row.label).toMatch(/Demo trading permission/i);
  });

  it("2: Demo Auto disabled (intent off) → not ready", () => {
    const row = deriveDemoAutoPermissionReadiness({
      isLiveSelected: false,
      demoAccountConnected: true,
      autoTradeEnabledIntent: false,
      qualificationState: "LIVE_QUALIFICATION",
      demoAutoEnabled: true
    });
    expect(row.ok).toBe(false);
    expect(row.pending).toBe(true);
    expect(row.detail).toBe("Demo Auto not enabled");
  });

  it("3: LIVE_QUALIFICATION + enabled intent → never shows Demo Auto not enabled", () => {
    const row = deriveDemoAutoPermissionReadiness({
      isLiveSelected: false,
      demoAccountConnected: true,
      autoTradeEnabledIntent: true,
      qualificationState: "LIVE_QUALIFICATION",
      demoAutoEnabled: true
    });
    expect(row.detail).not.toMatch(/not enabled/i);
    expect(row.detail).toBe("Demo Auto enabled");
    expect(row.ok).toBe(true);
  });

  it("4: Live selected keeps hard-locked pending approval messaging", () => {
    const row = deriveDemoAutoPermissionReadiness({
      isLiveSelected: true,
      demoAccountConnected: true,
      autoTradeEnabledIntent: true,
      qualificationState: "LIVE_QUALIFICATION",
      demoAutoEnabled: true
    });
    expect(row.ok).toBe(false);
    expect(row.label).toBe("Owner/live approval pending");
    expect(row.detail).toBe("Required for live");
  });

  it("uses DEMO_AUTO_ENABLED + intent as ready even if demoAuto flag omitted", () => {
    const row = deriveDemoAutoPermissionReadiness({
      isLiveSelected: false,
      demoAccountConnected: true,
      autoTradeEnabledIntent: true,
      qualificationState: "DEMO_AUTO_ENABLED",
      demoAutoEnabled: false
    });
    expect(row.ok).toBe(true);
    expect(row.detail).toBe("Demo Auto enabled");
  });

  it("paused Demo Auto is not ready with paused detail", () => {
    const row = deriveDemoAutoPermissionReadiness({
      isLiveSelected: false,
      demoAccountConnected: true,
      autoTradeEnabledIntent: true,
      autoTradePaused: true,
      qualificationState: "LIVE_QUALIFICATION",
      demoAutoEnabled: true
    });
    expect(row.ok).toBe(false);
    expect(row.detail).toBe("Demo Auto paused");
  });
});
