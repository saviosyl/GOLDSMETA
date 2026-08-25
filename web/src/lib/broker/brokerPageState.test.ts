import { describe, expect, it } from "vitest";
import {
  deriveCanonicalBrokerView,
  isAuthReconnectCode,
  isVersionConflictCode,
  shouldApplyResponse,
  nextGeneration,
  actionButtonLabel,
  successBannerFor
} from "./brokerPageState";

describe("brokerPageState", () => {
  it("never shows Connected + Account pending when a selected account exists", () => {
    const view = deriveCanonicalBrokerView({
      pageLoading: false,
      hasCentre: true,
      selectedBrokerId: "pepperstone_ctrader",
      readinessConnected: true,
      authSetupRequired: false,
      setupRequired: false,
      reconnectRequired: false,
      tokenRefreshHealthy: true,
      accountSelected: true,
      selectedAccountIsLive: false,
      demoAccountSelected: true
    });
    expect(view.connectionLabel).toBe("Connected");
    expect(view.accountTypeLabel).toBe("Demo account selected");
    expect(view.accountPhase).not.toBe("pending");
  });

  it("shows reconnect_required instead of Connected when token is unhealthy", () => {
    const view = deriveCanonicalBrokerView({
      pageLoading: false,
      hasCentre: true,
      selectedBrokerId: "pepperstone_ctrader",
      readinessConnected: true,
      authSetupRequired: false,
      setupRequired: false,
      reconnectRequired: false,
      tokenRefreshHealthy: false,
      accountSelected: true,
      selectedAccountIsLive: false,
      demoAccountSelected: true
    });
    expect(view.connectionPhase).toBe("reconnect_required");
    expect(view.connectionLabel).toBe("Reconnect required");
    expect(view.reconnectRequired).toBe(true);
  });

  it("shows Account pending only when connected without a selected account", () => {
    const view = deriveCanonicalBrokerView({
      pageLoading: false,
      hasCentre: true,
      selectedBrokerId: "pepperstone_ctrader",
      readinessConnected: true,
      authSetupRequired: false,
      setupRequired: false,
      reconnectRequired: false,
      tokenRefreshHealthy: true,
      accountSelected: false,
      selectedAccountIsLive: false,
      demoAccountSelected: false
    });
    expect(view.connectionLabel).toBe("Connected");
    expect(view.accountTypeLabel).toBe("Account pending");
  });

  it("does not stay in loading once centre is present", () => {
    const view = deriveCanonicalBrokerView({
      pageLoading: true,
      hasCentre: true,
      selectedBrokerId: "manual",
      readinessConnected: false,
      authSetupRequired: false,
      setupRequired: false,
      reconnectRequired: false,
      tokenRefreshHealthy: null,
      accountSelected: false,
      selectedAccountIsLive: false,
      demoAccountSelected: false
    });
    expect(view.connectionPhase).not.toBe("loading");
    expect(view.accountTypeLabel).toBe("Analysis only");
  });

  it("shows Ready to connect when OAuth is configured but not yet connected", () => {
    const view = deriveCanonicalBrokerView({
      pageLoading: false,
      hasCentre: true,
      selectedBrokerId: "pepperstone_ctrader",
      readinessConnected: false,
      authSetupRequired: false,
      setupRequired: true,
      oauthConfigured: true,
      reconnectRequired: false,
      tokenRefreshHealthy: null,
      accountSelected: false,
      selectedAccountIsLive: false,
      demoAccountSelected: false
    });
    expect(view.connectionPhase).toBe("available");
    expect(view.connectionLabel).toBe("Ready to connect");
  });

  it("keeps Setup required when OAuth credentials are missing", () => {
    const view = deriveCanonicalBrokerView({
      pageLoading: false,
      hasCentre: true,
      selectedBrokerId: "pepperstone_ctrader",
      readinessConnected: false,
      authSetupRequired: false,
      setupRequired: true,
      oauthConfigured: false,
      reconnectRequired: false,
      tokenRefreshHealthy: null,
      accountSelected: false,
      selectedAccountIsLive: false,
      demoAccountSelected: false
    });
    expect(view.connectionPhase).toBe("setup_required");
    expect(view.connectionLabel).toBe("Setup required");
  });

  it("recognises ACCESS_DENIED and VERSION_CONFLICT codes", () => {
    expect(isAuthReconnectCode("ACCESS_DENIED")).toBe(true);
    expect(isAuthReconnectCode("CTRADER_TOKEN_REFRESH_FAILED")).toBe(true);
    expect(isVersionConflictCode("CTRADER_TOKEN_VERSION_CONFLICT")).toBe(true);
    expect(isVersionConflictCode("VERSION_CONFLICT")).toBe(true);
    expect(isAuthReconnectCode("CTRADER_SETUP_REQUIRED")).toBe(false);
  });

  it("applies latest-request-wins correctly", () => {
    expect(shouldApplyResponse(3, 2)).toBe(false);
    expect(shouldApplyResponse(3, 3)).toBe(true);
    expect(nextGeneration(4)).toBe(5);
  });

  it("provides pending/success button labels", () => {
    expect(actionButtonLabel("refresh_accounts", "pending", "Refresh accounts")).toMatch(
      /Refreshing/
    );
    expect(actionButtonLabel("preview", "success", "Preview next trade")).toMatch(/Preview ready/);
    expect(successBannerFor("refresh_diagnostics")).toMatch(/Diagnostics refreshed/);
  });
});
