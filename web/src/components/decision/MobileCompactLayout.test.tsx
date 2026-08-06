import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { chartExampleIntradayPlanFixture } from "../../fixtures/intradayPlanFixture";
import type { IntradayPlan } from "../../types/intradayPlan";
import { DecisionDashboard } from "./DecisionDashboard";
import { NotificationCentre } from "./NotificationCentre";

const apiMock = vi.hoisted(() => ({
  listNotifications: vi.fn(async () => [
    {
      id: "n1",
      event: "VALID_PLAN_CREATED",
      direction: "BUY",
      createdAt: "2026-08-06T06:00:00.000Z",
      message: "Potential buy plan created with a longer explanation for wrapping.",
      shortMessage: "Potential buy plan created with a longer explanation for wrapping.",
      planId: "plan-long-identifier-123",
      read: false
    }
  ]),
  notificationPreferences: vi.fn(async () => ({
    VALID_PLAN_CREATED: false,
    ENTRY_ZONE_APPROACHING: false,
    ENTRY_ZONE_REACHED: false,
    CONFIRM_5M: false,
    PLAN_INVALIDATED: false,
    TARGETS_REACHED: false
  })),
  updateNotificationPreferences: vi.fn(),
  markNotificationsRead: vi.fn(),
  sendTestNotification: vi.fn()
}));

vi.mock("../../lib/auth", () => ({
  useAuth: () => ({ api: apiMock })
}));

vi.mock("../../lib/push", () => ({
  getNotificationPermission: () => "default",
  isProbablyInstalledPwa: () => true,
  isWebPushSupported: () => true,
  subscribeWebPush: vi.fn()
}));

function waitPlan(): IntradayPlan {
  const plan = structuredClone(chartExampleIntradayPlanFixture);
  plan.planStatus = "NO_VALID_PLAN";
  plan.geometryValid = false;
  plan.geometryMessage = "Trade levels failed safety validation.";
  plan.zones = {
    ...plan.zones,
    nearestSupport: 4253.22,
    nearestResistance: 4259.64
  };
  return plan;
}

describe("Mobile compact layout contracts", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 568 });
  });

  it("keeps WAIT fold compact with support/resistance and no long top paragraphs", () => {
    render(
      <MemoryRouter>
        <DecisionDashboard
          plan={waitPlan()}
          marketFeedHealth={{
            status: "amber",
            title: "Market feed partially available",
            subtitle: "Limited",
            quoteStatus: "limited",
            lastVerifiedAt: new Date().toISOString(),
            lastVerifiedLabel: null
          }}
        />
      </MemoryRouter>
    );

    const dash = screen.getByTestId("todays-intraday-plan");
    expect(dash.className).toMatch(/gm-decision-premium/);
    expect(screen.getByTestId("market-feed-status").className).toMatch(/gm-feed-compact/);
    expect(screen.getByTestId("intraday-action-short")).toHaveTextContent("WAIT");
    expect(screen.getByTestId("decision-plan-state")).toHaveTextContent("No valid plan yet");
    expect(screen.getByTestId("nearest-support")).toBeInTheDocument();
    expect(screen.getByTestId("nearest-resistance")).toBeInTheDocument();
    expect(screen.getByTestId("next-plan-update")).toBeInTheDocument();
    expect(screen.getByTestId("phone-alerts-control")).toBeInTheDocument();
    expect(screen.getByTestId("enable-phone-alerts")).toBeInTheDocument();
    // Monitoring copy stays inside Why waiting, not as a top paragraph card.
    expect(screen.getByTestId("why-waiting").contains(screen.getByTestId("wait-monitoring-copy"))).toBe(true);
  });

  it("opens notification drawer fitted to viewport with close control and wrapping text", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <NotificationCentre />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole("button", { name: /Notifications/i }));
    const drawer = screen.getByTestId("notification-drawer");
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("notification-backdrop")).toBeInTheDocument();
    expect(screen.getByTestId("notification-close")).toBeInTheDocument();
    expect(screen.getByText(/longer explanation for wrapping/i)).toBeInTheDocument();
    expect(document.body.classList.contains("gm-drawer-open")).toBe(true);
    await user.click(screen.getByTestId("notification-close"));
    expect(screen.queryByTestId("notification-drawer")).not.toBeInTheDocument();
    expect(document.body.classList.contains("gm-drawer-open")).toBe(false);
  });

  it("exposes keyboard/screen-reader labels on notification controls", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <NotificationCentre />
      </MemoryRouter>
    );
    const bell = await screen.findByRole("button", { name: /Notifications/i });
    expect(bell).toHaveAttribute("aria-expanded", "false");
    await user.click(bell);
    expect(bell).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: /Notifications/i })).toBeInTheDocument();
    expect(screen.getByTestId("notification-close")).toHaveAttribute("aria-label", "Close notifications");
  });
});
