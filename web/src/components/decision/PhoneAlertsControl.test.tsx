import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhoneAlertsControl } from "./PhoneAlertsControl";

const pushMocks = vi.hoisted(() => ({
  getNotificationPermission: vi.fn<() => NotificationPermission | "unsupported">(),
  isProbablyInstalledPwa: vi.fn<() => boolean>(),
  isWebPushSupported: vi.fn<() => boolean>(),
  subscribeWebPush: vi.fn()
}));

vi.mock("../../lib/auth", () => ({
  useAuth: () => ({ api: { getVapidPublicKey: vi.fn() } })
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
      message: "Push subscription registered for this browser."
    });
    setUserAgent("Mozilla/5.0");
  });

  it("requests push only after the enable button is clicked", async () => {
    const user = userEvent.setup();
    render(<PhoneAlertsControl />);

    expect(pushMocks.subscribeWebPush).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("enable-phone-alerts"));
    expect(pushMocks.subscribeWebPush).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("phone-alerts-label")).toHaveTextContent(/Phone alerts active/i);
  });

  it("shows blocked when browser permission is denied", () => {
    pushMocks.getNotificationPermission.mockReturnValue("denied");
    render(<PhoneAlertsControl />);
    expect(screen.getByTestId("phone-alerts-label")).toHaveTextContent(/Notifications blocked/i);
    expect(screen.queryByTestId("enable-phone-alerts")).not.toBeInTheDocument();
  });

  it("shows unsupported browser state", () => {
    pushMocks.isWebPushSupported.mockReturnValue(false);
    render(<PhoneAlertsControl compact={false} />);
    expect(screen.getByTestId("phone-alerts-label")).toHaveTextContent(/Unsupported on this browser/i);
    expect(screen.getByText(/In-app notifications still work/i)).toBeInTheDocument();
  });

  it("shows iPhone install instructions before enabling", async () => {
    const user = userEvent.setup();
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
    pushMocks.isProbablyInstalledPwa.mockReturnValue(false);
    render(<PhoneAlertsControl />);
    expect(screen.getByTestId("phone-alerts-label")).toHaveTextContent(/Add to Home Screen for iPhone alerts/i);
    await user.click(screen.getByText(/iPhone setup/i));
    expect(screen.getByTestId("iphone-alert-steps")).toHaveTextContent(/Tap Allow/i);
  });
});
