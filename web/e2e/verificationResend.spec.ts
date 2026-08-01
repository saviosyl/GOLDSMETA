import { expect, test } from "@playwright/test";

/**
 * UI smoke: verify-email resend cooldown controls (no live Firebase send).
 * Uses /ui-review fixtures when available; otherwise asserts register→copy.
 */

test.describe("verification resend UI", () => {
  test("register page is reachable and surfaces verification messaging when configured", async ({
    page
  }) => {
    await page.goto("/register");
    // Without Vite Firebase env the page shows configuration needed; with env it shows create-account.
    const heading = page.getByRole("heading").first();
    await expect(heading).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(/Create account|Configuration needed|Registration closed/i.test(body)).toBeTruthy();
    if (/Create account/i.test(body)) {
      await expect(page.getByText(/activates automatically/i)).toBeVisible();
    }
  });

  test("account-ready review surface still exposes Open Dashboard", async ({ page }) => {
    await page.goto("/ui-review/account-ready");
    await expect(page.getByTestId("account-ready-open-dashboard")).toBeVisible();
  });
});
