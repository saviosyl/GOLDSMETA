import { expect, test } from "@playwright/test";

/**
 * Non-production ui-review shell must be present in ui-review builds and
 * must not surface Issue #50 labelled preview copy on the default signed-out home.
 */
test.describe("UI review host / production isolation", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("ui-review shell loads on loopback for ui-review builds", async ({ page }) => {
    await page.goto("/ui-review/?scenario=issue50-below-val");
    await expect(page.getByTestId("ui-review-shell")).toBeVisible();
    await expect(page.getByTestId("intraday-action-card")).toBeVisible();
    await expect(page.getByTestId("intraday-autotrade-off")).toContainText(/AutoTrade OFF/i);
    await expect(page.locator("body")).toContainText(/LABELLED|PREVIEW|FIXTURE/i);
  });

  test("signed-out home does not embed Issue #50 preview scenario ids", async ({ page }) => {
    await page.goto("/");
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/issue50-below-val/);
    expect(body).not.toMatch(/issue50-buy-confirmed/);
    expect(body).not.toMatch(/LABELLED PREVIEW/);
  });
});
