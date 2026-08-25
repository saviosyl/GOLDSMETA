import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhoneAlertsControl } from "./PhoneAlertsControl";

const pushMocks = vi.hoisted(() => ({
  getNotificationPermission: vi.fn<() => NotificationPermission | "unsupported">(),
  isProbablyInstalledPwa: vi.fn<() => boolean>(),
  isWebPushSupported: vi.fn<() => boolean>(),
  subscribeWebPush: vi.fn(),
  ensureWebPushRegistered: vi.fn()
}));

const apiMock = vi.hoisted(() => ({
  getVapidPublicKey: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  sendTestNotification: vi.fn()
}));

vi.mock("../../lib/auth", () => ({
  useAuth: () => ({ api: apiMock })
}));

vi.mock("../../lib/push", () => pushMocks);

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    value,
    configurable: true
  });
}

describe("PhoneAlertsControl", () => {
  beforeEach(() => {
    pushMocks.getNotificationPermission.mockReturnValue("default");
    pushMocks.isProbablyInstalledPwa.mockReturnValue(true);
    pushMocks.isWebPushSupported.mockReturnValue(true);
    pushMocks.subscribeWebPush.mockResolvedValue({
      status: "subscribed",
      message: "Push subscription registered for this phone with GoldMeta."
    });
    pushMocks.ensureWebPushRegistered.mockResolvedValue({
      status: "permission_required",
      message: "Notifications permission required."
    });
    apiMock.getSettings.mockResolvedValue({ notificationsEnabled: false });
    apiMock.updateSettings.mockResolvedValue({ notificationsEnabled: true });
    apiMock.sendTestNotification.mockResolvedValue({
      ok: true,
      webSent: 1,
      fcmSent: 0,
      message: "Test Web Push sent."
    });
    setUserAgent("Mozilla/5.0");
  });

  it("does not treat Notification.permission granted alone as active", async () => {
    pushMocks.getNotificationPermission.mockReturnValue("granted");
    pushMocks.ensureWebPushRegistered.mockResolvedValue({
      status: "failed",
      message: "No push subscription on this phone yet. Tap Enable alerts."
    });
    render(<PhoneAlertsControl />);
    await waitFor(() => {
      expect(screen.getByTestId("phone-alerts-label")).toHaveTextContent(/Push subscription failed/i);
    });
    expect(screen.queryByTestId("phone-alerts-label")).not.toHaveTextContent(/Phone alerts active/i);
    expect(screen.getByTestId("enable-phone-alerts")).toBeInTheDocument();
  });

  it("requests push only after the enable button is clicked and shows active only when subscribed", async () => {
    const user = userEvent.setup();
    render(<PhoneAlertsControl />);

    await waitFor(() => {
      expect(pushMocks.ensureWebPushRegistered).toHaveBeenCalled();
    });
    expect(pushMocks.subscribeWebPush).not.toHaveBeenCalled();
    await user.click(await screen.findByTestId("enable-phone-alerts"));
    expect(pushMocks.subscribeWebPush).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("phone-alerts-label")).toHaveTextContent(/Phone alerts active/i);
    expect(apiMock.updateSettings).toHaveBeenCalledWith({ notificationsEnabled: true });
  });

  it("shows blocked when browser permission is denied", async () => {
    pushMocks.getNotificationPermission.mockReturnValue("denied");
    pushMocks.ensureWebPushRegistered.mockResolvedValue({
      status: "denied",
      message: "Notification permission was not granted."
    });
    render(<PhoneAlertsControl />);
    await waitFor(() => {
      expect(screen.getByTestId("phone-alerts-label")).toHaveTextContent(/Notifications blocked/i);
    });
    expect(screen.queryByTestId("enable-phone-alerts")).not.toBeInTheDocument();
  });

  it("shows server configuration missing when VAPID is absent", async () => {
    pushMocks.ensureWebPushRegistered.mockResolvedValue({
      status: "missing_vapid",
      message: "Server configuration missing — Web Push is not configured yet."
    });
    render(<PhoneAlertsControl compact={false} />);
    await waitFor(() => {
      expect(screen.getByTestId("phone-alerts-label")).toHaveTextContent(/Server configuration missing/i);
    });
  });

  it("shows unsupported browser state", async () => {
    pushMocks.isWebPushSupported.mockReturnValue(false);
    pushMocks.ensureWebPushRegistered.mockResolvedValue({
      status: "unsupported",
      message: "This browser does not support Web Push."
    });
    render(<PhoneAlertsControl compact={false} />);
    await waitFor(() => {
      expect(screen.getByTestId("phone-alerts-label")).toHaveTextContent(/Unsupported on this browser/i);
    });
    expect(screen.getByText(/In-app notifications still work/i)).toBeInTheDocument();
  });

  it("shows iPhone install instructions before enabling", async () => {
    const user = userEvent.setup();
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
    pushMocks.isProbablyInstalledPwa.mockReturnValue(false);
    pushMocks.ensureWebPushRegistered.mockResolvedValue({
      status: "needs_install",
      message: "On iPhone, add GoldMeta to your Home Screen first."
    });
    render(<PhoneAlertsControl />);
    await waitFor(() => {
      expect(screen.getByTestId("phone-alerts-label")).toHaveTextContent(
        /Add to Home Screen for iPhone alerts/i
      );
    });
    await user.click(screen.getByText(/iPhone setup/i));
    expect(screen.getByTestId("iphone-alert-steps")).toHaveTextContent(/Tap Allow/i);
  });

  it("sends a real test notification only when subscription is active", async () => {
    const user = userEvent.setup();
    pushMocks.ensureWebPushRegistered.mockResolvedValue({
      status: "subscribed",
      message: "Push subscription registered for this phone with GoldMeta."
    });
    render(<PhoneAlertsControl />);
    await waitFor(() => {
      expect(screen.getByTestId("phone-alerts-label")).toHaveTextContent(/Phone alerts active/i);
    });
    await user.click(screen.getByTestId("phone-alerts-send-test"));
    expect(apiMock.sendTestNotification).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("phone-alerts-message")).toHaveTextContent(/Test Web Push sent/i);
  });
});
