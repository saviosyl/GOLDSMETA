import { expect, test } from "@playwright/test";

async function waitForScrollable(page: import("@playwright/test").Page) {
  await page.goto("/scroll-demo.html");
  await expect(page.getByTestId("top-marker")).toBeVisible();
  await page.waitForFunction(() => document.documentElement.scrollHeight > window.innerHeight + 200);
}

test.describe("document scrolling hotfix", () => {
  test("mouse wheel scrolls the document", async ({ page }) => {
    await waitForScrollable(page);
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.move(400, 300);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => window.scrollY);
    expect(after).toBeGreaterThan(before + 100);
  });

  test("PageDown and End keys scroll", async ({ page }) => {
    await waitForScrollable(page);
    await page.locator("body").click({ position: { x: 20, y: 20 } });
    await page.keyboard.press("PageDown");
    await page.waitForFunction(() => window.scrollY > 50);
    const mid = await page.evaluate(() => window.scrollY);
    expect(mid).toBeGreaterThan(50);
    await page.keyboard.press("End");
    await page.waitForFunction((prev) => window.scrollY > prev, mid);
    const end = await page.evaluate(() => window.scrollY);
    expect(end).toBeGreaterThan(mid);
    await page.keyboard.press("Home");
    await page.waitForFunction(() => window.scrollY < 20);
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(20);
  });

  test("Space scrolls and bottom content clears fixed nav", async ({ page }) => {
    await waitForScrollable(page);
    await page.keyboard.press("Space");
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(40);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const bottomVisible = await page.getByTestId("bottom-marker").evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const nav = document.querySelector(".nav");
      const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight;
      return rect.bottom <= navTop + 1;
    });
    expect(bottomVisible).toBe(true);
  });

  test("app-shell is not a trapping scrollport", async ({ page }) => {
    await waitForScrollable(page);
    const metrics = await page.evaluate(() => {
      const shell = document.querySelector(".app-shell") as HTMLElement | null;
      if (!shell) return null;
      const style = getComputedStyle(shell);
      return {
        overflow: style.overflow,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        clientHeight: shell.clientHeight,
        scrollHeight: shell.scrollHeight,
        docScrollable: document.documentElement.scrollHeight > window.innerHeight
      };
    });
    expect(metrics?.docScrollable).toBe(true);
    expect(metrics?.overflowX === "visible" || metrics?.overflowX === "clip").toBeTruthy();
    // Shell should not be the active scroll container for vertical wheel.
    expect(metrics!.scrollHeight - metrics!.clientHeight).toBeLessThan(2);
  });
});
