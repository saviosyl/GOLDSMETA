import { expect, test } from "@playwright/test";

/**
 * PR #46 — Market Structure price-source mismatch / match (ui-review fixtures).
 * No broker orders. AutoTrade remains OFF.
 * Issue #50: primary action uses intraday-action-label (NO TRADE on mismatch).
 */
test.describe("Market Structure Map price sources", () => {
  test("mismatch case blocks ladder and shows Market data mismatch", async ({ page }) => {
    await page.goto("/ui-review/?scenario=market-mismatch");
    await expect(page.getByTestId("ui-review-shell")).toBeVisible();
    await expect(page.getByTestId("overview-page")).toBeVisible();

    await expect(page.getByTestId("market-data-mismatch-title")).toHaveText(
      "Market data mismatch"
    );
    await expect(page.getByTestId("market-data-mismatch-alert")).toContainText(/4045\.1[67]/);
    await expect(page.getByTestId("market-data-mismatch-broker")).toContainText("2408.00");
    await expect(page.getByTestId("market-data-mismatch-detail")).toContainText(
      "Signal blocked until the price sources match"
    );

    // No combined ladder / no LIVE PRICE row on the Market Structure Map
    await expect(page.getByTestId("ladder-live-price")).toHaveCount(0);
    await expect(
      page.getByTestId("market-level-ladder").getByText("LIVE PRICE", { exact: true })
    ).toHaveCount(0);

    // Issue #50: mismatch → NO TRADE (not a BUY/SELL recommendation)
    await expect(page.getByTestId("intraday-action-label")).toContainText(/NO TRADE/i);
    await expect(page.getByTestId("intraday-autotrade-off")).toContainText(/AutoTrade OFF/i);

    // Diagnostics expose conflict codes inside collapsed System status
    await page.getByTestId("system-status-collapse").locator("summary").click();
    await expect(page.getByTestId("system-status-collapse")).toContainText(/PRICE_SOURCE_MISMATCH/);
    await expect(page.getByTestId("system-status-collapse")).toContainText(/CONFLICTED_DATA/);
  });

  test("matching ~4050 case renders ladder without mismatch warning", async ({ page }) => {
    await page.goto("/ui-review/?scenario=market-match");
    await expect(page.getByTestId("ui-review-shell")).toBeVisible();
    await expect(page.getByTestId("market-level-ladder")).toBeVisible();
    await expect(page.getByTestId("market-data-mismatch-title")).toHaveCount(0);

    await expect(page.getByTestId("ladder-live-price")).toBeVisible();
    await expect(page.getByTestId("ladder-live-price")).toContainText(/4045/);
    await expect(page.getByTestId("ladder-row-poc")).toContainText(/4050/);
    await expect(page.getByTestId("ladder-row-vah")).toContainText(/4052|4053/);
    await expect(page.getByTestId("ladder-row-val")).toContainText(/4047/);

    // Verified fresh LIVE source may show LIVE PRICE
    await expect(page.getByTestId("ladder-live-price")).toContainText(/LIVE PRICE/i);
  });

  test("mismatch remains readable on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ui-review/?scenario=market-mismatch");
    await expect(page.getByTestId("market-data-mismatch-title")).toBeVisible();
    await expect(page.getByTestId("market-data-mismatch-alert")).toBeVisible();
    await expect(page.getByTestId("market-data-mismatch-broker")).toBeVisible();
    const box = await page.getByTestId("market-data-mismatch-title").boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeLessThanOrEqual(390);
  });

  test("print stylesheet keeps mismatch copy available", async ({ page }) => {
    await page.goto("/ui-review/?scenario=market-mismatch");
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("market-data-mismatch-title")).toBeVisible();
    await expect(page.getByTestId("market-data-mismatch-detail")).toContainText(
      "Signal blocked until the price sources match"
    );
  });
});
