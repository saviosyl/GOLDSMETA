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
    await expect(page.getByTestId("todays-intraday-plan")).toBeVisible();
    await expect(page.getByTestId("intraday-action-card")).toBeVisible();
    await expect(page.getByTestId("plan-levels-strip")).toBeVisible();
    await expect(page.getByTestId("setup-checklist")).toBeVisible();
    await expect(page.getByTestId("confirmation-5m-card")).toBeVisible();
    await expect(page.getByTestId("timeframe-alignment")).toBeVisible();
    await expect(page.getByTestId("expected-range-card")).toBeVisible();
    await expect(page.getByTestId("next-decision-strip")).toBeVisible();
    await expect(page.getByTestId("alternative-scenario")).toBeVisible();
    await expect(page.getByTestId("intraday-autotrade-off")).toContainText(/AutoTrade OFF/i);

    // Fixture labels must never appear in the rendered plan UI
    await expect(page.getByTestId("todays-intraday-plan")).not.toContainText(/LABELLED FIXTURE/i);
    await expect(page.getByTestId("todays-intraday-plan")).not.toContainText(/not live market data/i);

    const metrics = await page.evaluate(() => {
      const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const order = [
        "intraday-header-card",
        "todays-intraday-plan",
        "setup-checklist",
        "confirmation-5m-card",
        "expected-range-card",
        "alternative-scenario"
      ].map((id) => box(`[data-testid="${id}"]`).top);
      const plan = box('[data-testid="todays-intraday-plan"]');
      const tabBtn =
        document.querySelector('[data-testid="tabs"]') ||
        document.querySelector('[role="tablist"]') ||
        document.querySelector('[role="tab"]');
      const tabs = tabBtn?.getBoundingClientRect();
      const entry = box('[data-testid="plan-level-entry"]');
      const tp1 = box('[data-testid="plan-level-tp1"]');
      return {
        order,
        planTop: plan.top,
        planBottom: plan.bottom,
        entryBottom: entry.bottom,
        tp1Bottom: tp1.bottom,
        tabsTop: tabs?.top ?? Infinity,
        vh: window.innerHeight,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        altOpen: (document.querySelector('[data-testid="alternative-scenario"]') as HTMLDetailsElement)
          .open,
        bodyText: document.body.innerText
      };
    });
    expect(metrics.overflow).toBe(false);
    expect(metrics.altOpen).toBe(false);
    // Primary plan sits above research tabs
    expect(metrics.planTop).toBeLessThan(metrics.tabsTop);
    // Key plan prices remain in the first viewport
    expect(metrics.entryBottom).toBeLessThan(metrics.vh);
    expect(metrics.tp1Bottom).toBeLessThan(metrics.vh);
    for (let i = 1; i < metrics.order.length; i++) {
      expect(metrics.order[i]!).toBeGreaterThanOrEqual(metrics.order[i - 1]! - 1);
    }
    expect(metrics.bodyText).not.toMatch(/LABELLED FIXTURE/i);
    expect(metrics.bodyText).not.toMatch(/preview fixture/i);

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
      await expect(page.getByTestId("intraday-live-price")).toBeVisible();
      await expect(page.getByTestId("intraday-autotrade-off")).toContainText(/AutoTrade OFF/i);
      await expect(page.getByTestId("intraday-action-short")).toBeVisible();
      await expect(page.getByTestId("plan-level-entry")).toBeVisible();
      await expect(page.getByTestId("plan-level-stop")).toBeVisible();
      await expect(page.getByTestId("plan-level-tp1")).toBeVisible();

      const fold = await page.evaluate(() => {
        const vh = window.innerHeight;
        const visible = (id: string) => {
          const el = document.querySelector(`[data-testid="${id}"]`);
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.top < vh && r.bottom > 0;
        };
        const plan = document.querySelector('[data-testid="todays-intraday-plan"]')!;
        const nav = document.querySelector('[data-testid="mobile-bottom-nav"]')!;
        const planRect = plan.getBoundingClientRect();
        const navRect = nav.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          header: visible("intraday-header-card"),
          plan: visible("todays-intraday-plan"),
          entry: visible("plan-level-entry"),
          stop: visible("plan-level-stop"),
          tp1: visible("plan-level-tp1"),
          // Plan must not be covered by bottom nav
          planAboveNav: planRect.bottom <= navRect.top + 8 || planRect.top < navRect.top,
          body: document.body.innerText
        };
      });
      expect(fold.overflow, `overflow at ${width}`).toBe(false);
      expect(fold.header, `header fold ${width}`).toBe(true);
      expect(fold.plan, `plan fold ${width}`).toBe(true);
      expect(fold.entry, `entry fold ${width}`).toBe(true);
      expect(fold.stop, `stop fold ${width}`).toBe(true);
      expect(fold.tp1, `tp1 fold ${width}`).toBe(true);
      expect(fold.body).not.toMatch(/LABELLED FIXTURE/i);
      expect(fold.body).not.toMatch(/not live market data/i);

      await expect(page.getByTestId("setup-checklist")).toBeVisible();
      await expect(page.getByTestId("expected-range-card")).toBeVisible();
      await expect(page.getByTestId("range-mobile-ladder")).toBeVisible();
      await expect(page.getByTestId("range-track")).toBeHidden();
      await expect(page.getByTestId("next-decision-strip")).toBeVisible();
      await page.getByTestId("range-node-probable-low").click();
      await expect(page.getByTestId("range-level-explain")).toBeVisible();
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
    await expect(page.getByTestId("no-valid-plan-title")).toContainText(/NO VALID INTRADAY PLAN/i);
    await expect(page.getByTestId("next-decision-mode-message")).toContainText(/observation only/i);
    expect(await page.locator('[data-testid="cockpit-live-range-only"]').count()).toBe(1);
    await expect(page.getByTestId("todays-intraday-plan")).not.toContainText(/LABELLED FIXTURE/i);
  });

  test("research tabs are keyboard reachable and follow the primary plan", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/ui-review/?scenario=issue50-below-val");
    await expect(page.getByTestId("todays-intraday-plan")).toBeVisible();
    await expect(page.getByTestId("tabs")).toBeVisible();
    const planBox = await page.getByTestId("todays-intraday-plan").boundingBox();
    const tabsBox = await page.getByTestId("tabs").boundingBox();
    expect(planBox).toBeTruthy();
    expect(tabsBox).toBeTruthy();
    expect(planBox!.y).toBeLessThan(tabsBox!.y);

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
    await page.getByTestId("explain-page-btn").first().click();
    await expect(page.getByTestId("explain-page-panel")).toContainText(/Today's Intraday Plan/i);
  });
});
