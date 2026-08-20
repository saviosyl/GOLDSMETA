import { describe, expect, it } from "vitest";
import appSource from "../App.tsx?raw";

/**
 * Completeness gate: every App.tsx route path must remain registered.
 * Prevents silent route loss during UX refactors.
 */
const REQUIRED_PATHS = [
  "/brand",
  "/ui-review/*",
  "/register",
  "/legal/terms",
  "/legal/privacy",
  "/legal/risk",
  "/registration-complete",
  "/password-reset-sent",
  "/verify-email",
  "/account-ready",
  "/awaiting-approval",
  "/account-suspended",
  "/account/delete-request",
  "/",
  "/levels",
  "/alerts",
  "/analysis",
  "/history",
  "/history/:decisionId",
  "/signal-performance",
  "/setups/:setupId",
  "/analytics",
  "/analytics/v3",
  "/intelligence",
  "/replay",
  "/diagnostics",
  "/v4",
  "/journal",
  "/planner",
  "/brokers",
  "/tradingview",
  "/admin/users",
  "/admin/tradingview-template",
  "/gold-hunter",
  "/settings",
  "/help",
  "/learn",
  "/learn/:lessonId",
  "/insights",
  "/insights/:tab",
  "/history-replay",
  "/history-replay/:tab"
];

describe("App route inventory", () => {
  it("keeps every required route path in App.tsx", () => {
    for (const path of REQUIRED_PATHS) {
      expect(appSource, `missing route ${path}`).toContain(`path="${path}"`);
    }
    expect(REQUIRED_PATHS.length).toBeGreaterThanOrEqual(34);
  });

  it("does not register Core AutoTrade routes or pages", () => {
    expect(appSource).not.toContain('path="/autotrade"');
    expect(appSource).not.toContain('path="/autotrade/performance"');
    expect(appSource).toContain('path="/gold-hunter"');
    expect(appSource).not.toContain("AutoTradePage");
  });
});
