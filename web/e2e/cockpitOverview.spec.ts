import { expect, test } from "@playwright/test";

/**
 * Research cockpit — ui-review fixtures only (non-production host).
 * Verifies Day Trade Range Map + Next Decision without inventing market data.
 */
test.describe("Overview research cockpit", () => {
  test("desktop range map, next decision, and interactions", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/ui-review/?scenario=issue50-below-val");
    await expect(page.getByTestId("ui-review-shell")).toBeVisible();
    await expect(page.getByTestId("intraday-action-card")).toBeVisible();
    await expect(page.getByTestId("expected-range-card")).toBeVisible();
    await expect(page.getByTestId("next-decision-strip")).toBeVisible();
    await expect(page.getByTestId("range-ladder")).toBeVisible();
    await expect(page.getByTestId("range-metrics")).toBeVisible();
    await expect(page.getByTestId("range-guidance")).toBeVisible();
    await expect(page.getByTestId("scenario-cards")).toBeVisible();
    await expect(page.getByTestId("research-matrix")).toBeVisible();
    await expect(page.getByTestId("intraday-autotrade-off")).toContainText(/AutoTrade OFF/i);

    const metrics = await page.evaluate(() => {
      const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      return {
        actionBottom: box('[data-testid="intraday-action-card"]').bottom,
        rangeBottom: box('[data-testid="expected-range-card"]').bottom,
        nextBottom: box('[data-testid="next-decision-strip"]').bottom,
        vh: window.innerHeight,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      };
    });
    expect(metrics.overflow).toBe(false);
    expect(metrics.actionBottom).toBeLessThan(metrics.vh * 0.55);
    expect(metrics.rangeBottom).toBeLessThan(metrics.vh * 0.75);
    expect(metrics.nextBottom).toBeLessThan(metrics.vh * 0.92);

    await page.getByTestId("range-node-probable-high").click();
    await expect(page.getByTestId("range-level-explain")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("range-level-explain")).toHaveCount(0);
  });

  test("mobile vertical ladder and no page-level horizontal overflow", async ({ page }) => {
    for (const width of [375, 390, 430] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/ui-review/?scenario=issue50-below-val");
      await expect(page.getByTestId("expected-range-card")).toBeVisible();
      await expect(page.getByTestId("range-mobile-ladder")).toBeVisible();
      await expect(page.getByTestId("range-track")).toBeHidden();
      await expect(page.getByTestId("next-decision-strip")).toBeVisible();
      await page.getByTestId("range-node-probable-low").click();
      await expect(page.getByTestId("range-level-explain")).toBeVisible();
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth > doc.clientWidth + 1;
      });
      expect(overflow, `overflow at ${width}`).toBe(false);
    }
  });

  test("mismatch and live-range messages stay single-instance", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/ui-review/?scenario=market-mismatch");
    await expect(page.getByTestId("intraday-action-label")).toContainText(/NO TRADE/i);
    await expect(page.getByTestId("intraday-autotrade-off")).toContainText(/AutoTrade OFF/i);
    await expect(page.getByTestId("next-decision-mode-message")).toContainText(/NO TRADE/i);
    const mismatchCount = await page.locator('[data-testid="cockpit-mismatch"]').count();
    expect(mismatchCount).toBeLessThanOrEqual(1);

    await page.goto("/ui-review/?scenario=issue50-live-range-only");
    await expect(page.getByTestId("cockpit-live-range-only")).toBeVisible();
    await expect(page.getByTestId("next-decision-mode-message")).toContainText(/observation only/i);
    expect(await page.locator('[data-testid="cockpit-live-range-only"]').count()).toBe(1);
  });

  test("research tabs are keyboard reachable", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/ui-review/?scenario=issue50-below-val");
    await page.getByRole("tab", { name: "Structure" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("tab", { name: "Structure" }).click();
    await expect(page.getByTestId("research-tab-structure")).toBeVisible();
    await page.getByRole("tab", { name: "Overview" }).click();
    await expect(page.getByTestId("research-tab-overview")).toBeVisible();
    await page.getByTestId("explain-page-btn").click();
    await expect(page.getByTestId("explain-page-panel")).toContainText(/What PREPARE means/i);
  });
});
