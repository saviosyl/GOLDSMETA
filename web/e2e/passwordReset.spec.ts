import { test, expect } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4173";

test.describe("Forgot Password UX", () => {
  test("forgot password visible and empty email rejected on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/login`);
    await expect(page.getByTestId("forgot-password")).toBeVisible();
    await page.getByTestId("forgot-password").click();
    await expect(page.getByTestId("signin-error")).toContainText(/email/i);
  });

  test("password-reset-sent page copy is generic at 200% zoom desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE}/password-reset-sent`);
    await page.evaluate(() => {
      document.body.style.zoom = "2";
    });
    await expect(page.getByTestId("password-reset-sent-message")).toContainText(
      /If an account exists for this email/i
    );
    await expect(page.getByTestId("password-reset-back-signin")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 2
    );
    expect(overflow).toBeFalsy();
  });
});
