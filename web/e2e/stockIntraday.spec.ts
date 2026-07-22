import { test, expect } from "@playwright/test";

test.describe("Stocks Intraday AutoTrade", () => {
  test("ui-review stocks page shows mode and safety statement", async ({ page }) => {
    await page.goto("/ui-review/stocks-intraday");
    await expect(page.getByTestId("ui-review-shell")).toBeVisible();
    await expect(page.getByTestId("stock-intraday-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("stock-intraday-mode-pill")).toHaveText("OFF");
    await expect(page.getByTestId("stock-intraday-safety")).toContainText(
      "qualifying opportunities"
    );
    await expect(page.getByTestId("stock-intraday-emergency-stop")).toBeVisible();
    await expect(page.getByTestId("stock-intraday-mode-T212_LIVE_AUTO")).toBeDisabled();
  });

  test("stocks kill switch locks mode", async ({ page }) => {
    await page.goto("/ui-review/stocks-intraday");
    await expect(page.getByTestId("stock-intraday-page")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("stock-intraday-emergency-stop").click();
    await expect(page.getByTestId("stock-intraday-mode-pill")).toHaveText("LOCKED");
  });

  test("stocks layout fits narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ui-review/stocks-intraday");
    await expect(page.getByTestId("stock-intraday-page")).toBeVisible({ timeout: 15_000 });
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="stock-intraday-page"]');
      if (!el) return -1;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
