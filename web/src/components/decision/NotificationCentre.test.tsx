import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { NotificationCentre } from "./NotificationCentre";

const apiMock = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  notificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
  markNotificationsRead: vi.fn(),
  sendTestNotification: vi.fn()
}));

vi.mock("../../lib/auth", () => ({
  useAuth: () => ({ api: apiMock })
}));

describe("NotificationCentre", () => {
  beforeEach(() => {
    apiMock.listNotifications.mockResolvedValue([
      {
        id: "n1",
        event: "VALID_PLAN_CREATED",
        direction: "BUY",
        createdAt: "2026-08-06T06:00:00.000Z",
        message: "Potential buy plan created.",
        shortMessage: "Potential buy plan created.",
        planId: "plan-1",
        read: false
      }
    ]);
    apiMock.notificationPreferences.mockResolvedValue({
      VALID_PLAN_CREATED: false,
      ENTRY_ZONE_APPROACHING: false,
      ENTRY_ZONE_REACHED: false,
      CONFIRM_5M: false,
      PLAN_INVALIDATED: false,
      TARGETS_REACHED: false
    });
    apiMock.updateNotificationPreferences.mockImplementation(async (patch) => ({
      VALID_PLAN_CREATED: false,
      ENTRY_ZONE_APPROACHING: false,
      ENTRY_ZONE_REACHED: false,
      CONFIRM_5M: false,
      PLAN_INVALIDATED: false,
      TARGETS_REACHED: false,
      ...patch
    }));
    apiMock.markNotificationsRead.mockResolvedValue({ ok: true });
    apiMock.sendTestNotification.mockResolvedValue({ ok: true, message: "Test notification sent." });
  });

  it("shows unread count and notification list", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <NotificationCentre />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole("button", { name: /Notifications, 1 unread/i }));
    expect(within(screen.getByRole("list", { name: /Recent notifications/i })).getByText(/VALID PLAN CREATED/i)).toBeInTheDocument();
    expect(screen.getByText(/Potential buy plan created/i)).toBeInTheDocument();
    expect(screen.getByText(/Plan ID: plan-1/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open plan/i })).toHaveAttribute("href", "/history/plan-1");
  });

  it("renders the six preferences off by default", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <NotificationCentre />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole("button", { name: /Notifications/i }));
    const prefs = screen.getByText(/Phone alert preferences/i).parentElement!;
    const boxes = within(prefs).getAllByRole("checkbox");
    expect(boxes).toHaveLength(6);
    boxes.forEach((box) => expect(box).not.toBeChecked());
  });

  it("sends a test notification", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <NotificationCentre />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole("button", { name: /Notifications/i }));
    await user.click(screen.getByRole("button", { name: /Send test notification/i }));
    expect(apiMock.sendTestNotification).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Test notification sent/i)).toBeInTheDocument();
  });
});
