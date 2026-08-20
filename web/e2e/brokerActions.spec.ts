import { expect, test } from "@playwright/test";

test.describe("Broker action feedback", () => {
  test("desktop: action buttons, keyboard, reduced motion, print", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/ui-review/brokers");
    await expect(page.getByTestId("broker-control-centre")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("autotrade-off-badge")).toHaveText("Gold Hunter Demo OFF");
    await expect(page.getByTestId("no-order-badge")).toContainText(
      /Live orders locked|Order submission disabled/i
    );

    const refresh = page.getByTestId("ctrader-refresh-accounts-btn");
    await expect(refresh).toBeVisible();
    await refresh.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("broker-action-banner")).toBeVisible({ timeout: 10_000 });

    const diagnostics = page.getByTestId("ctrader-diagnostics-btn");
    await diagnostics.click();
    await expect(page.getByTestId("broker-action-banner")).toContainText(/Diagnostics|Accounts|refreshed|updated/i);

    await page.getByTestId("ctrader-live-preview-btn").click();
    await expect(page.getByTestId("ctrader-preview-only")).toBeVisible({ timeout: 10_000 });

    // Duplicate-click protection: second click while disabled should not throw
    await refresh.click();
    await expect(refresh).toBeVisible();

    await page.emulateMedia({ media: "print" });
    const navHidden = await page.evaluate(() => {
      const mobile = document.querySelector('[data-testid="mobile-bottom-nav"]');
      const sidebar = document.querySelector('[data-testid="desktop-sidebar"]');
      const styleOf = (el: Element | null) =>
        el ? getComputedStyle(el).display === "none" : true;
      return styleOf(mobile) && styleOf(sidebar);
    });
    expect(navHidden).toBe(true);
    await expect(page.getByTestId("broker-edit-autotrade-settings")).toBeVisible();
  });

  test("mobile: touch targets and disconnect confirmation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ui-review/brokers");
    await expect(page.getByTestId("broker-control-centre")).toBeVisible({ timeout: 15_000 });

    const disconnect = page.getByTestId("ctrader-disconnect-btn");
    await expect(disconnect).toBeVisible();
    const box = await disconnect.boundingBox();
    expect(box).toBeTruthy();
    expect((box?.height ?? 0) >= 40 || (box?.width ?? 0) >= 40).toBeTruthy();

    await disconnect.click();
    await expect(disconnect).toContainText(/Confirm disconnect/i);
    await page.getByTestId("ctrader-disconnect-cancel-btn").click();
    await expect(disconnect).toHaveText(/Disconnect/i);

    const live = page.getByTestId("ctrader-account-****9910");
    if (await live.isVisible().catch(() => false)) {
      await live.click();
      await expect(live).toContainText(/Confirm Live/i);
    }
  });
});
