import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const VIEWPORTS = [
  { w: 320, h: 568 },
  { w: 360, h: 800 },
  { w: 375, h: 812 },
  { w: 390, h: 844 },
  { w: 393, h: 852 },
  { w: 430, h: 932 }
] as const;

async function pageOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const sw = document.documentElement.scrollWidth;
    const cw = document.documentElement.clientWidth;
    return { sw, cw, delta: sw - cw };
  });
}

test.describe("V5.4.3 on V5.4.1 — zoom + horizontal overflow", () => {
  test("viewport meta allows accessibility zoom", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const content = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(content).toContain("width=device-width");
    expect(content).toContain("initial-scale=1");
    expect(content).toContain("viewport-fit=cover");
    expect(content).not.toMatch(/maximum-scale\s*=\s*1/);
    expect(content).not.toMatch(/user-scalable\s*=\s*no/);
  });

  for (const vp of VIEWPORTS) {
    test(`no page overflow on Dashboard @ ${vp.w}x${vp.h}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.goto("/ui-review/");
      await expect(page.getByTestId("overview-page")).toBeVisible();
      expect((await pageOverflow(page)).delta).toBeLessThanOrEqual(1);

      // Score lives inside collapsed System status — open it before expanding.
      const system = page.getByTestId("system-status-collapse");
      if (await system.count()) {
        await system.locator("summary").click();
      }
      const toggle = page.getByTestId("score-toggle");
      if (await toggle.isVisible().catch(() => false)) {
        await toggle.click();
        await page.waitForTimeout(100);
      }
      expect((await pageOverflow(page)).delta).toBeLessThanOrEqual(1);

      await page.getByTestId("share-market-snapshot").click();
      await page.waitForSelector('[data-testid="promo-snapshot-modal"]');
      await page.waitForSelector('[data-testid="promo-snapshot-preview"]', { timeout: 15000 });
      expect((await pageOverflow(page)).delta).toBeLessThanOrEqual(1);
      const previewBox = await page.getByTestId("promo-snapshot-preview").boundingBox();
      expect(previewBox?.width ?? 0).toBeLessThanOrEqual(vp.w + 1);
      await page.getByTestId("promo-snapshot-close").click();
    });

    test(`no page overflow on sign-in after refresh @ ${vp.w}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.goto("/");
      await expect(page.getByTestId("signin-card")).toBeVisible();
      expect((await pageOverflow(page)).delta).toBeLessThanOrEqual(1);
      await page.reload({ waitUntil: "networkidle" });
      await expect(page.getByTestId("signin-card")).toBeVisible();
      expect((await pageOverflow(page)).delta).toBeLessThanOrEqual(1);
    });
  }

  test("form controls use ≥16px text on mobile (iOS zoom guard)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByTestId("signin-card")).toBeVisible();
    await page.waitForSelector("input", { timeout: 10_000 });
    const sizes = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll("input, select, textarea")];
      return nodes.map((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    });
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) {
      expect(size).toBeGreaterThanOrEqual(16);
    }
  });

  test("snapshot modal select uses ≥16px on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ui-review/");
    await page.getByTestId("share-market-snapshot").click();
    await page.waitForSelector('[data-testid="promo-snapshot-format"]');
    const size = await page.getByTestId("promo-snapshot-format").evaluate((el) =>
      Number.parseFloat(getComputedStyle(el).fontSize)
    );
    expect(size).toBeGreaterThanOrEqual(16);
  });

  test("Share Market Snapshot opens from V5.4.1 Dashboard", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ui-review/");
    await expect(page.getByTestId("intraday-action-card")).toBeVisible();
    await expect(page.getByTestId("intraday-header-card")).toBeVisible();
    await expect(page.getByTestId("share-market-snapshot")).toBeVisible();
    await page.getByTestId("share-market-snapshot").click();
    await expect(page.getByTestId("promo-snapshot-modal")).toBeVisible();
    await page.waitForSelector('[data-testid="promo-snapshot-preview"]', { timeout: 15000 });
    await expect(page.getByTestId("promo-snapshot-share")).toBeEnabled();
    await expect(page.getByTestId("promo-snapshot-download")).toBeEnabled();
  });

  test("expanded colourful score reaches News row above bottom nav", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ui-review/");
    await page.getByTestId("system-status-collapse").locator("summary").click();
    await expect(page.getByTestId("goldmeta-score")).toBeVisible();
    const toggle = page.getByTestId("score-toggle");
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveText(/Show less/i);
    const news = page.getByTestId("score-row-news");
    await expect(news).toBeVisible();
    await news.scrollIntoViewIfNeeded();
    const box = await news.boundingBox();
    const nav = page.getByTestId("mobile-bottom-nav");
    const navBox = await nav.boundingBox();
    expect(box).toBeTruthy();
    expect(navBox).toBeTruthy();
    // Final score row bottom edge should sit above the fixed nav top
    expect(box!.y + box!.height).toBeLessThanOrEqual(navBox!.y + 1);
  });

  test("capture overflow measurements + frames", async ({ page }) => {
    const outDir = path.resolve(process.cwd(), "../docs/v5-4-3-from-v541");
    fs.mkdirSync(outDir, { recursive: true });
    const measurements: Record<string, { sw: number; cw: number; delta: number }> = {};
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.goto("/ui-review/");
      await expect(page.getByTestId("overview-page")).toBeVisible();
      measurements[`dashboard-${vp.w}x${vp.h}`] = await pageOverflow(page);
    }
    fs.writeFileSync(
      path.join(outDir, "overflow-measurements.json"),
      JSON.stringify(measurements, null, 2)
    );
    for (const width of [390, 430] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 932 });
      await page.goto("/ui-review/");
      await expect(page.getByTestId("intraday-action-label")).toBeVisible();
      await page.screenshot({
        path: path.join(outDir, `dashboard-${width}.png`),
        fullPage: false
      });
      const systemSummary = page.getByTestId("system-status-collapse").locator("summary");
      if (await systemSummary.isVisible().catch(() => false)) {
        await systemSummary.click({ force: true });
      }
      const toggle = page.getByTestId("score-toggle");
      if (await toggle.isVisible().catch(() => false)) await toggle.click({ force: true });
      await page.screenshot({
        path: path.join(outDir, `score-expanded-${width}.png`),
        fullPage: false
      });
    }
  });
});
