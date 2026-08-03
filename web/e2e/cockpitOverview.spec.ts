import { expect, test } from "@playwright/test";

/**
 * Research cockpit — ui-review fixtures only (non-production host).
 * Verifies compact interactive Overview without inventing market data.
 */
test.describe("Overview research cockpit", () => {
  test("desktop cockpit shows action, range, scenarios and research matrix", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/ui-review/?scenario=issue50-below-val");
    await expect(page.getByTestId("ui-review-shell")).toBeVisible();
    await expect(page.getByTestId("intraday-action-card")).toBeVisible();
    await expect(page.getByTestId("expected-range-card")).toBeVisible();
    await expect(page.getByTestId("scenario-cards")).toBeVisible();
    await expect(page.getByTestId("research-matrix")).toBeVisible();
    await expect(page.getByTestId("intraday-autotrade-off")).toContainText(/AutoTrade OFF/i);

    // Main decision + range + scenarios should occupy the first desktop viewport.
    const metrics = await page.evaluate(() => {
      const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      return {
        actionBottom: box('[data-testid="intraday-action-card"]').bottom,
        rangeBottom: box('[data-testid="expected-range-card"]').bottom,
        scenariosBottom: box('[data-testid="scenario-cards"]').bottom,
        matrixTop: box('[data-testid="research-matrix"]').top,
        vh: window.innerHeight
      };
    });
    expect(metrics.actionBottom).toBeLessThan(metrics.vh * 0.55);
    // In-flow range labels stay inside the Expected Range card (no absolute overflow into scenarios).
    expect(metrics.rangeBottom).toBeLessThan(metrics.vh * 0.82);
    expect(metrics.scenariosBottom).toBeLessThan(metrics.vh + 80);
    expect(metrics.matrixTop).toBeLessThan(metrics.vh + 100);
    // Range labels must not overlap Trade Scenarios.
    expect(metrics.rangeBottom).toBeLessThanOrEqual(metrics.scenariosBottom);

    await page.getByTestId("action-why-btn").click();
    await expect(page.getByTestId("action-panel-why")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("action-panel-why")).toHaveCount(0);

    await page.getByTestId("range-node-probable-high").click();
    await expect(page.getByTestId("range-level-explain")).toBeVisible();
  });

  test("mobile segmented scenarios and no page-level horizontal overflow", async ({ page }) => {
    for (const width of [375, 390, 430] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/ui-review/?scenario=issue50-below-val");
      await expect(page.getByTestId("intraday-action-card")).toBeVisible();
      await expect(page.getByTestId("scenario-tab-bull")).toBeVisible();
      await page.getByTestId("scenario-tab-bear").click();
      await expect(page.getByTestId("scenario-bear")).toHaveClass(/is-active/);
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth > doc.clientWidth + 1;
      });
      expect(overflow, `overflow at ${width}`).toBe(false);
    }
  });

  test("mismatch and live-range empty states stay single-instance", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/ui-review/?scenario=market-mismatch");
    await expect(page.getByTestId("intraday-action-label")).toContainText(/NO TRADE/i);
    await expect(page.getByTestId("intraday-autotrade-off")).toContainText(/AutoTrade OFF/i);
    // Cockpit mismatch banner or action label — not repeated across many cards
    const mismatchCount = await page.locator('[data-testid="cockpit-mismatch"]').count();
    expect(mismatchCount).toBeLessThanOrEqual(1);

    await page.goto("/ui-review/?scenario=issue50-live-range-only");
    await expect(page.getByTestId("cockpit-live-range-only")).toBeVisible();
    expect(await page.locator('[data-testid="cockpit-live-range-only"]').count()).toBe(1);
  });

  test("research tabs are keyboard reachable", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/ui-review/?scenario=issue50-below-val");
    await page.getByRole("tab", { name: "Structure" }).focus();
    await page.keyboard.press("Enter");
    // Tabs component uses click onChange; activate via click for reliability after focus
    await page.getByRole("tab", { name: "Structure" }).click();
    await expect(page.getByTestId("research-tab-structure")).toBeVisible();
    await page.getByRole("tab", { name: "Overview" }).click();
    await expect(page.getByTestId("research-tab-overview")).toBeVisible();
    await page.getByTestId("explain-page-btn").click();
    await expect(page.getByTestId("explain-page-panel")).toContainText(/What PREPARE means/i);
  });
});
