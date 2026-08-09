import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AlertsSetupPage } from "./AlertsSetupPage";

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    api: {
      marketFeedHealth: vi.fn(async () => ({
        status: "green",
        title: "Operational",
        subtitle: "Live",
        quoteStatus: "live",
        lastVerifiedAt: null,
        lastVerifiedLabel: "now"
      })),
      listNotifications: vi.fn(async () => []),
      notificationPreferences: vi.fn(async () => ({
        VALID_PLAN_CREATED: true,
        ENTRY_ZONE_APPROACHING: true,
        ENTRY_ZONE_REACHED: true,
        CONFIRM_5M: true,
        PLAN_INVALIDATED: true,
        TARGETS_REACHED: true
      })),
      updateNotificationPreferences: vi.fn(),
      adminMarketFeedStatus: vi.fn(async () => ({
        checklist: [
          { id: "legacy", label: "Old Pine 2.1 alert disabled", status: "pass" }
        ],
        sharedWebhookUrl: "https://example.test/webhook/secret"
      }))
    },
    account: { role: "USER" },
    user: { email: "user@example.com" }
  })
}));

vi.mock("../lib/push", () => ({
  getNotificationPermission: () => "default",
  isProbablyInstalledPwa: () => true,
  isWebPushSupported: () => true,
  subscribeWebPush: vi.fn()
}));

describe("AlertsSetupPage ordinary user", () => {
  it("shows notification preferences and hides TradingView feed setup", async () => {
    render(
      <MemoryRouter>
        <AlertsSetupPage />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("notification-status")).toBeInTheDocument();
    expect(screen.getByTestId("alerts-preferences")).toBeInTheDocument();
    expect(screen.queryByTestId("premium-setup-health")).not.toBeInTheDocument();
    expect(screen.queryByTestId("alerts-advanced-setup")).not.toBeInTheDocument();
    expect(screen.queryByTestId("standard-webhook-url")).not.toBeInTheDocument();
    expect(screen.queryByText(/example\.test\/webhook/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pine 3\.0 detected/i)).not.toBeInTheDocument();
  });
});
