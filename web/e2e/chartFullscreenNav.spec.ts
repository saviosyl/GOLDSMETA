import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const MOBILE = [
  { w: 375, h: 812 },
  { w: 390, h: 844 },
  { w: 430, h: 932 }
] as const;

async function openPremiumPlan(page: import("@playwright/test").Page) {
  await page.goto("/ui-review/");
  await expect(page.getByTestId("ui-review-shell")).toBeVisible();
  await expect(page.getByTestId("overview-page")).toBeVisible();
  await expect(page.getByTestId("plan-market-card")).toBeVisible({ timeout: 20_000 });
}

test.describe("Chart fit + fullscreen (shared for all roles)", () => {
  test("desktop: Fit + Fullscreen controls and exit", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPremiumPlan(page);
    const chart = page.getByTestId("plan-market-card");
    await expect(chart).toBeVisible();
    await expect(page.getByTestId("chart-fit-view")).toBeVisible();
    await expect(page.getByTestId("chart-fullscreen")).toBeVisible();
    await page.getByTestId("chart-fit-view").click();
    await page.getByTestId("chart-fullscreen").click();
    await expect(chart).toHaveAttribute("data-fullscreen", "1");
    await expect(page.getByTestId("chart-exit-fullscreen")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(chart).toHaveAttribute("data-fullscreen", "0");
  });

  for (const vp of MOBILE) {
    test(`mobile fullscreen fallback @ ${vp.w}x${vp.h}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await openPremiumPlan(page);
      const chart = page.getByTestId("plan-market-card");
      await chart.scrollIntoViewIfNeeded();
      await page.getByTestId("chart-fullscreen").click();
      await expect(chart).toHaveAttribute("data-fullscreen", "1");
      const box = await chart.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.y).toBeLessThanOrEqual(2);
      expect(box!.height).toBeGreaterThan(vp.h * 0.7);
      await page.getByTestId("chart-exit-fullscreen").click();
      await expect(chart).toHaveAttribute("data-fullscreen", "0");
    });
  }
});

test.describe("Mobile bottom nav stays fixed", () => {
  for (const vp of MOBILE) {
    test(`nav pinned to viewport bottom @ ${vp.w}x${vp.h}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await openPremiumPlan(page);
      const nav = page.getByTestId("mobile-bottom-nav");
      await expect(nav).toBeVisible();

      // No legacy floating action bar
      await expect(page.getByTestId("mobile-action-bar")).toHaveCount(0);

      const measure = async () =>
        page.evaluate(() => {
          const el = document.querySelector(
            '[data-testid="mobile-bottom-nav"]'
          ) as HTMLElement | null;
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return {
            top: r.top,
            bottom: r.bottom,
            vh: window.innerHeight,
            position: cs.position,
            cssBottom: cs.bottom,
            transform: cs.transform
          };
        });

      const top = await measure();
      expect(top).toBeTruthy();
      expect(top!.position).toBe("fixed");
      expect(top!.transform === "none" || top!.transform === "matrix(1, 0, 0, 1, 0, 0)").toBe(
        true
      );
      expect(Math.abs(top!.bottom - top!.vh)).toBeLessThanOrEqual(2);

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(100);
      const bottom = await measure();
      expect(bottom).toBeTruthy();
      expect(Math.abs(bottom!.bottom - bottom!.vh)).toBeLessThanOrEqual(2);
      // Must not float mid-page
      expect(bottom!.top).toBeGreaterThan(bottom!.vh * 0.7);

      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(50);
      const again = await measure();
      expect(Math.abs(again!.bottom - again!.vh)).toBeLessThanOrEqual(2);
    });
  }

  test("capture nav + chart artifacts", async ({ page }) => {
    const outDir = path.resolve(process.cwd(), "../docs/audit-chart-nav");
    fs.mkdirSync(outDir, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPremiumPlan(page);
    await page.getByTestId("plan-market-card").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(outDir, "desktop-chart-embedded.png"),
      fullPage: false
    });
    await page.getByTestId("chart-fullscreen").click();
    await page.screenshot({
      path: path.join(outDir, "desktop-chart-fullscreen.png"),
      fullPage: false
    });
    await page.keyboard.press("Escape");

    for (const vp of MOBILE) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await openPremiumPlan(page);
      await page.screenshot({
        path: path.join(outDir, `nav-top-${vp.w}.png`),
        fullPage: false
      });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
      await page.screenshot({
        path: path.join(outDir, `nav-mid-${vp.w}.png`),
        fullPage: false
      });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.screenshot({
        path: path.join(outDir, `nav-bottom-${vp.w}.png`),
        fullPage: false
      });
      await page.getByTestId("plan-market-card").scrollIntoViewIfNeeded();
      await page.getByTestId("chart-fullscreen").click();
      await page.screenshot({
        path: path.join(outDir, `chart-fullscreen-${vp.w}.png`),
        fullPage: false
      });
      await page.getByTestId("chart-exit-fullscreen").click();
    }
  });
});
