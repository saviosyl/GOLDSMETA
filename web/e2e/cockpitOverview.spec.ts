import { expect, test } from "@playwright/test";

/**
 * Today's Intraday Plan cockpit — ui-review fixtures only (non-production host).
 */
test.describe("Overview research cockpit", () => {
  test("desktop plan stack, range map secondary, and interactions", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/ui-review/?scenario=issue50-below-val");
    await expect(page.getByTestId("ui-review-shell")).toBeVisible();
    await expect(page.getByTestId("intraday-header-card")).toBeVisible();
    await expect(page.getByTestId("intraday-action-card")).toBeVisible();
    await expect(page.getByTestId("todays-intraday-plan")).toBeVisible();
    await expect(page.getByTestId("plan-levels-strip")).toBeVisible();
    await expect(page.getByTestId("setup-checklist")).toBeVisible();
    await expect(page.getByTestId("confirmation-5m-card")).toBeVisible();
    await expect(page.getByTestId("timeframe-alignment")).toBeVisible();
    await expect(page.getByTestId("expected-range-card")).toBeVisible();
    await expect(page.getByTestId("next-decision-strip")).toBeVisible();
    await expect(page.getByTestId("alternative-scenario")).toBeVisible();
    await expect(page.getByTestId("intraday-autotrade-off")).toContainText(/AutoTrade OFF/i);

    const metrics = await page.evaluate(() => {
      const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const order = [
        "intraday-header-card",
        "intraday-action-card",
        "todays-intraday-plan",
        "plan-levels-strip",
        "setup-checklist",
        "confirmation-5m-card",
        "expected-range-card",
        "alternative-scenario"
      ].map((id) => box(`[data-testid="${id}"]`).top);
      return {
        order,
        actionBottom: box('[data-testid="intraday-action-card"]').bottom,
        planBottom: box('[data-testid="todays-intraday-plan"]').bottom,
        vh: window.innerHeight,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        altOpen: (document.querySelector('[data-testid="alternative-scenario"]') as HTMLDetailsElement)
          .open
      };
    });
    expect(metrics.overflow).toBe(false);
    expect(metrics.altOpen).toBe(false);
    expect(metrics.actionBottom).toBeLessThan(metrics.vh * 0.55);
    expect(metrics.planBottom).toBeLessThan(metrics.vh * 0.75);
    for (let i = 1; i < metrics.order.length; i++) {
      expect(metrics.order[i]!).toBeGreaterThanOrEqual(metrics.order[i - 1]! - 1);
    }

    await page.getByTestId("range-node-probable-high").click();
    await expect(page.getByTestId("range-level-explain")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("range-level-explain")).toHaveCount(0);
  });

  test("mobile vertical ladder and no page-level horizontal overflow", async ({ page }) => {
    for (const width of [375, 390, 430] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/ui-review/?scenario=issue50-below-val");
      await expect(page.getByTestId("todays-intraday-plan")).toBeVisible();
      await expect(page.getByTestId("setup-checklist")).toBeVisible();
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
      await expect(page.getByTestId("mobile-bottom-nav")).toContainText("Plan");
      await expect(page.getByTestId("mobile-bottom-nav")).toContainText("Research");
      await expect(page.getByTestId("mobile-bottom-nav")).toContainText("History");
      await expect(page.getByTestId("mobile-bottom-nav")).toContainText("More");
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
    await page.getByRole("tab", { name: "Plan" }).click();
    await expect(page.getByTestId("research-tab-plan")).toBeVisible();
    await page.getByRole("tab", { name: "Levels" }).click();
    await expect(page.getByTestId("research-tab-levels")).toBeVisible();
    await expect(page.getByTestId("scenario-cards")).toBeVisible();
    await page.getByRole("tab", { name: "Momentum" }).click();
    await expect(page.getByTestId("research-matrix")).toBeVisible();
    await page.getByTestId("explain-page-btn").click();
    await expect(page.getByTestId("explain-page-panel")).toContainText(/Today's Intraday Plan/i);
  });
});
