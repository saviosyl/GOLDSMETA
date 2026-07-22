import { expect, test } from "@playwright/test";

/**
 * Signal History / Performance coverage via UI review fixtures.
 * Hypothetical only — no broker orders.
 */
test.describe("Signal History outcomes", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("WAIT excluded, PENDING_ENTRY, OPEN, WIN, LOSS, BREAKEVEN, AMBIGUOUS, partial TP, performance, confidence", async ({
    page
  }) => {
    await page.goto("/ui-review/history?scenario=signal-outcomes");
    await expect(page.getByTestId("signal-history-page")).toBeVisible();
    await expect(page.getByTestId("hypothetical-disclaimer")).toBeVisible();

    await expect(page.getByTestId("wait-no-trade-wait-1")).toBeVisible();
    await expect(page.getByTestId("lifecycle-badge-pending-1")).toHaveText("PENDING_ENTRY");
    await expect(page.getByTestId("lifecycle-badge-open-1")).toHaveText("OPEN");
    await expect(page.getByTestId("lifecycle-badge-win-1")).toHaveText("WIN");
    await expect(page.getByTestId("lifecycle-badge-loss-1")).toHaveText("LOSS");
    await expect(page.getByTestId("lifecycle-badge-be-1")).toHaveText("BREAKEVEN");
    await expect(page.getByTestId("lifecycle-badge-amb-1")).toHaveText("AMBIGUOUS");
    await expect(page.getByTestId("lifecycle-badge-partial-1")).toHaveText("WIN");
    await expect(page.getByTestId("outcome-final-partial-1")).toContainText("TP1");
    await expect(page.getByTestId("outcome-final-partial-1")).toContainText("HYPOTHETICAL SIGNAL PERFORMANCE");

    await page.goto("/ui-review/signal-performance?scenario=signal-outcomes");
    await expect(page.getByTestId("signal-performance-page")).toBeVisible();
    await expect(page.getByTestId("signal-perf-grid")).toBeVisible();
    await expect(page.getByTestId("perf-disclaimer")).toContainText("Past hypothetical results");
    await expect(page.getByTestId("signal-perf-grid").getByText("Wins", { exact: true })).toBeVisible();
    await expect(page.getByTestId("signal-perf-grid").getByText("Ambiguous", { exact: true })).toBeVisible();
    await expect(page.getByTestId("confidence-bands")).toBeVisible();
    await expect(page.getByTestId("confidence-band-90-100")).toBeVisible();
    await expect(page.getByTestId("confidence-band-80-89")).toBeVisible();
    await expect(page.getByTestId("confidence-band-70-79")).toBeVisible();
    await expect(page.getByTestId("confidence-band-60-69")).toBeVisible();
    await expect(page.getByTestId("partial-tp-note")).toContainText("weighted exit legs");
  });
});
