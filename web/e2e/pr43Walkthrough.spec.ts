import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "320", width: 320, height: 640 },
  { name: "375", width: 375, height: 812 },
  { name: "390", width: 390, height: 844 },
  { name: "430", width: 430, height: 932 },
  { name: "768", width: 768, height: 1024 },
  { name: "1024", width: 1024, height: 768 },
  { name: "1440", width: 1440, height: 900 }
] as const;

test.describe("PR #43 human UX walkthrough (ui-review)", () => {
  test("legacy AutoTrade review path redirects away from Core AutoTrade", async ({ page }) => {
    await page.goto("/ui-review/autotrade");
    await expect(page.getByTestId("autotrade-page")).toHaveCount(0);
    await expect(page.getByTestId("ui-review-shell")).toBeVisible({ timeout: 15_000 });
  });

  test("TradingView standard wizard labels", async ({ page }) => {
    await page.goto("/ui-review/tradingview");
    await expect(page.getByTestId("tradingview-setup-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("tv-recommended-badge")).toBeVisible();
    await expect(page.getByTestId("tv-advanced-badge")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy webhook" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy alert message" })).toBeVisible();
  });

  test("Admin template page accessible in owner review shell", async ({ page }) => {
    await page.goto("/ui-review/admin/tradingview-template");
    await expect(page.getByTestId("admin-tv-template-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("goldmeta-standard-v1", { exact: true }).first()).toBeVisible();
  });

  for (const vp of VIEWPORTS) {
    test(`Plan page no horizontal overflow @ ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/ui-review/");
      await expect(page.getByTestId("overview-page")).toBeVisible({ timeout: 15_000 });
      const overflow = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="overview-page"]');
        if (!el) return -1;
        return el.scrollWidth - el.clientWidth;
      });
      expect(overflow).toBeLessThanOrEqual(2);
    });
  }
});
