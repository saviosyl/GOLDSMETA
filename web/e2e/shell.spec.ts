import { expect, test } from "@playwright/test";

async function waitForScrollable(page: import("@playwright/test").Page) {
  await page.goto("/scroll-demo.html");
  await expect(page.getByTestId("top-marker")).toBeVisible();
  await page.waitForFunction(() => document.documentElement.scrollHeight > window.innerHeight + 200);
}

test.describe("V5.3 redesign shell scroll contracts", () => {
  test("desktop document still scrolls with mouse wheel", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await waitForScrollable(page);
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.move(400, 300);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 100);
  });

  test("mobile document still scrolls with mouse wheel", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await waitForScrollable(page);
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.move(180, 300);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 40);
  });
});
