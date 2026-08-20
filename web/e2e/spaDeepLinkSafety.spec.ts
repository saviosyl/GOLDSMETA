import { expect, test } from "@playwright/test";

/**
 * Deep-link / refresh safety for key lazy routes (ui-review host).
 * Production Cloudflare nearest-404 is covered by AssetFallbackSafety + post-deploy-check.
 */
const ROUTES: Array<{ path: string; marker: string }> = [
  { path: "/ui-review/", marker: '[data-testid="overview-page"]' },
  { path: "/ui-review/intelligence", marker: '[data-testid="intelligence-page"]' },
  { path: "/ui-review/brokers", marker: '[data-testid="broker-control-centre"]' },
  { path: "/ui-review/settings", marker: '[data-testid="settings-page"]' },
  { path: "/ui-review/help", marker: '[data-testid="help-page"]' },
  { path: "/ui-review/learn", marker: '[data-testid="learn-page"]' },
  { path: "/ui-review/learn/what-is-trading", marker: '[data-testid="learn-lesson-page"]' },
  { path: "/ui-review/journal", marker: '[data-testid="journal-page"]' },
  { path: "/ui-review/alerts", marker: '[data-testid="alerts-setup-page"]' },
  { path: "/ui-review/planner", marker: '[data-testid="risk-planner-page"]' },
  { path: "/ui-review/levels", marker: '[data-testid="key-levels-page"]' }
];

test.describe("SPA deep link safety", () => {
  for (const route of ROUTES) {
    test(`opens ${route.path} directly without Update required`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await expect(page.locator(route.marker)).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId("route-error-boundary")).toHaveCount(0);
      await expect(page.getByText("Update required")).toHaveCount(0);

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator(route.marker)).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId("route-error-boundary")).toHaveCount(0);
    });
  }
});
