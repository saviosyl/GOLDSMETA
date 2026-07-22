import { test, expect } from "@playwright/test";

test.describe("AutoTrade Control Centre", () => {
  test("ui-review AutoTrade page shows status and STOP", async ({ page }) => {
    await page.goto("/ui-review/autotrade");
    await expect(page.getByTestId("ui-review-shell")).toBeVisible();
    await expect(page.getByTestId("autotrade-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("autotrade-mode-pill")).toHaveText("OFF");
    await expect(page.getByTestId("autotrade-emergency-stop")).toBeVisible();
    await expect(page.getByTestId("autotrade-budget")).toBeVisible();
    await expect(page.getByTestId("autotrade-live-activation")).toBeVisible();
  });

  test("AutoTrade emergency STOP locks mode", async ({ page }) => {
    await page.goto("/ui-review/autotrade");
    await expect(page.getByTestId("autotrade-page")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("autotrade-emergency-stop").click();
    await expect(page.getByTestId("autotrade-mode-pill")).toHaveText("LOCKED");
  });

  test("AutoTrade layout fits narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ui-review/autotrade");
    await expect(page.getByTestId("autotrade-page")).toBeVisible({ timeout: 15_000 });
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="autotrade-page"]');
      if (!el) return -1;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("autotrade-emergency-stop")).toBeVisible();
  });
});
