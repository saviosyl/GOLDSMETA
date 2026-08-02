import { expect, test } from "@playwright/test";

test.describe("Broker print layout", () => {
  test("hides navigation chrome in print media", async ({ page }) => {
    await page.goto("/ui-review/brokers");
    await expect(page.getByTestId("broker-control-centre")).toBeVisible({ timeout: 15_000 });
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
    await expect(page.getByTestId("no-order-badge")).toHaveText(
      /Order submission disabled in this preview/i
    );
  });
});
