import { expect, test } from "@playwright/test";

/**
 * Market Structure Map price-source mismatch / match (ui-review fixtures).
 * Navigates via the current premium Plan → Advanced analysis → Structure tab.
 * No broker orders. Live execution remains locked.
 */
test.describe("Market Structure Map price sources", () => {
  async function ensureStructureOpen(page: import("@playwright/test").Page) {
    await expect(page.getByTestId("ui-review-shell")).toBeVisible();
    await expect(page.getByTestId("overview-page")).toBeVisible();
    await expect(page.getByTestId("cockpit-main")).toBeVisible();

    // Structure lives under Advanced analysis in the premium Plan cockpit.
    const advanced = page.getByTestId("advanced-analysis-section");
    await expect(advanced).toBeVisible();
    const advancedOpen = await advanced.evaluate((el) => (el as HTMLDetailsElement).open);
    if (!advancedOpen) {
      await advanced.locator("> summary").click();
    }

    const structureTab = page.getByTestId("research-tab-btn-structure");
    await expect(structureTab).toBeVisible();
    await structureTab.click();

    const structurePanel = page.getByTestId("research-tab-structure");
    await expect(structurePanel).toBeVisible();

    const details = structurePanel.getByTestId("market-structure-collapse");
    await expect(details).toBeVisible();
    const open = await details.evaluate((el) => (el as HTMLDetailsElement).open);
    if (!open) {
      await details.locator("summary").filter({ hasText: "Market Structure Map" }).click();
    }
    await expect(details).toHaveAttribute("open", "");
  }

  async function openSystemStatusDiagnostics(page: import("@playwright/test").Page) {
    const diagnostics = page.getByTestId("advanced-diagnostics-section");
    await expect(diagnostics).toBeVisible();
    const open = await diagnostics.evaluate((el) => (el as HTMLDetailsElement).open);
    if (!open) {
      await diagnostics.locator("> summary").click();
    }
    const system = diagnostics.getByTestId("system-status-collapse");
    await expect(system).toBeVisible();
    const systemOpen = await system.evaluate((el) => (el as HTMLDetailsElement).open);
    if (!systemOpen) {
      await system.locator("> summary").click();
    }
    return system;
  }

  test("mismatch case blocks ladder and shows Market data mismatch", async ({ page }) => {
    await page.goto("/ui-review/?scenario=market-mismatch");
    await ensureStructureOpen(page);

    await expect(page.getByTestId("market-data-mismatch-title")).toHaveText("Market data mismatch");
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

    // Premium hero may show HOLD (bias/wait) or NO TRADE — never BUY/SELL on mismatch.
    await expect(page.getByTestId("intraday-action-label")).toHaveText(/^(HOLD|NO TRADE)$/i);
    // Cockpit alert still states NO TRADE when price sources disagree.
    await expect(page.getByTestId("cockpit-mismatch")).toContainText(/NO TRADE/i);
    // Premium status wording (idle / qualifying / OFF) — never require obsolete header card.
    await expect(page.getByTestId("dashboard-autotrade-off").first()).toContainText(
      /AutoTrade|idle|Qualifying|OFF|Demo/i
    );

    const system = await openSystemStatusDiagnostics(page);
    await expect(system).toContainText(/PRICE_SOURCE_MISMATCH/);
    await expect(system).toContainText(/CONFLICTED_DATA/);
  });

  test("matching ~4050 case renders ladder without mismatch warning", async ({ page }) => {
    await page.goto("/ui-review/?scenario=market-match");
    await ensureStructureOpen(page);
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
    await ensureStructureOpen(page);
    await expect(page.getByTestId("market-data-mismatch-title")).toBeVisible();
    await expect(page.getByTestId("market-data-mismatch-alert")).toBeVisible();
    await expect(page.getByTestId("market-data-mismatch-broker")).toBeVisible();
    const box = await page.getByTestId("market-data-mismatch-title").boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeLessThanOrEqual(390);
  });

  test("print stylesheet keeps mismatch copy available", async ({ page }) => {
    await page.goto("/ui-review/?scenario=market-mismatch");
    await ensureStructureOpen(page);
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("market-data-mismatch-title")).toBeVisible();
    await expect(page.getByTestId("market-data-mismatch-detail")).toContainText(
      "Signal blocked until the price sources match"
    );
  });
});
