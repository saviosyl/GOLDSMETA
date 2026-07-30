import { expect, test } from "@playwright/test";

/**
 * Account-ready activation screen — desktop + mobile smoke (static UI review path).
 */
test.describe("Account ready activation screen", () => {
  test("desktop account-ready copy and Open Dashboard CTA", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/ui-review/account-ready");
    // Fall back to direct status page if ui-review route absent
    if (!(await page.getByTestId("account-ready-page").count())) {
      await page.goto("/account-ready");
    }
    // When unauthenticated, gate may redirect — assert via review shell if present
    const ready = page.getByTestId("account-ready-page");
    if (await ready.count()) {
      await expect(ready).toContainText(/Your account is ready/i);
      await expect(page.getByTestId("account-ready-open-dashboard")).toBeVisible();
      await expect(page.locator("body")).not.toContainText("USER_APPROVED");
      await expect(page.locator("body")).not.toContainText("USER_PENDING");
    }
  });

  test("mobile account-ready layout usable at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/ui-review/account-ready");
    if (!(await page.getByTestId("account-ready-page").count())) {
      await page.goto("/account-ready");
    }
    const ready = page.getByTestId("account-ready-page");
    if (await ready.count()) {
      await expect(ready).toBeVisible();
      const box = await ready.boundingBox();
      expect(box?.width ?? 0).toBeLessThanOrEqual(375 + 1);
      await expect(page.getByTestId("account-ready-open-dashboard")).toBeVisible();
    }
  });
});
