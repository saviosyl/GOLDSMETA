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
    return { sw, cw, delta: sw - cw, ok: sw <= cw };
  });
}

/** Require Plan cockpit ready before measuring overflow (never pass on setup failure). */
async function openPremiumPlan(page: import("@playwright/test").Page) {
  await page.goto("/ui-review/");
  await expect(page.getByTestId("ui-review-shell")).toBeVisible();
  await expect(page.getByTestId("overview-page")).toBeVisible();
  await expect(page.getByTestId("intraday-action-card")).toBeVisible();
}

async function openAdvancedDiagnostics(page: import("@playwright/test").Page) {
  const analysis = page.getByTestId("advanced-analysis-section");
  await expect(analysis).toBeVisible();
  if (!(await analysis.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await analysis.locator("> summary").click();
  }
  const diagnostics = page.getByTestId("advanced-diagnostics-section");
  await expect(diagnostics).toBeVisible();
  if (!(await diagnostics.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await diagnostics.locator("> summary").click();
  }
  return diagnostics;
}

test.describe("Premium Plan — zoom + horizontal overflow", () => {
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
    test(`no page overflow on Plan @ ${vp.w}x${vp.h}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await openPremiumPlan(page);

      const base = await pageOverflow(page);
      expect(base.ok, `scrollWidth ${base.sw} > clientWidth ${base.cw}`).toBe(true);
      expect(base.delta).toBeLessThanOrEqual(1);

      // Optional advanced expand — scoped so nested system-status is unambiguous.
      const diagnostics = await openAdvancedDiagnostics(page);
      const system = diagnostics.getByTestId("system-status-collapse");
      if (await system.count()) {
        if (!(await system.evaluate((el) => (el as HTMLDetailsElement).open))) {
          await system.locator("> summary").click();
        }
        const toggle = diagnostics.getByTestId("score-toggle");
        if (await toggle.isVisible().catch(() => false)) {
          await toggle.click();
          await page.waitForTimeout(50);
        }
      }

      const after = await pageOverflow(page);
      expect(after.ok, `after advanced: scrollWidth ${after.sw} > clientWidth ${after.cw}`).toBe(
        true
      );
      expect(after.delta).toBeLessThanOrEqual(1);
    });

    test(`no page overflow on sign-in after refresh @ ${vp.w}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.goto("/");
      await expect(page.getByTestId("signin-card")).toBeVisible();
      const first = await pageOverflow(page);
      expect(first.ok).toBe(true);
      expect(first.delta).toBeLessThanOrEqual(1);
      await page.reload({ waitUntil: "networkidle" });
      await expect(page.getByTestId("signin-card")).toBeVisible();
      const second = await pageOverflow(page);
      expect(second.ok).toBe(true);
      expect(second.delta).toBeLessThanOrEqual(1);
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

  test("390 and 430 Plan viewports have no horizontal overflow", async ({ page }) => {
    for (const vp of [
      { w: 390, h: 844 },
      { w: 430, h: 932 }
    ] as const) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await openPremiumPlan(page);
      const m = await pageOverflow(page);
      expect(m.ok, `${vp.w}x${vp.h}: scrollWidth ${m.sw} > clientWidth ${m.cw}`).toBe(true);
      expect(m.sw).toBeLessThanOrEqual(m.cw);
    }
  });

  test("expanded score in Advanced diagnostics stays above mobile bottom nav", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPremiumPlan(page);
    const diagnostics = await openAdvancedDiagnostics(page);
    const system = diagnostics.getByTestId("system-status-collapse");
    await expect(system).toBeVisible();
    if (!(await system.evaluate((el) => (el as HTMLDetailsElement).open))) {
      await system.locator("> summary").click();
    }
    await expect(diagnostics.getByTestId("goldmeta-score")).toBeVisible();
    const toggle = diagnostics.getByTestId("score-toggle");
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
      await expect(toggle).toHaveText(/Show less/i);
    }
    const news = diagnostics.getByTestId("score-row-news");
    if (await news.count()) {
      await expect(news).toBeVisible();
      await news.scrollIntoViewIfNeeded();
      const box = await news.boundingBox();
      const nav = page.getByTestId("mobile-bottom-nav");
      const navBox = await nav.boundingBox();
      expect(box).toBeTruthy();
      expect(navBox).toBeTruthy();
      expect(box!.y + box!.height).toBeLessThanOrEqual(navBox!.y + 1);
    }
  });

  test("capture overflow measurements + frames", async ({ page }) => {
    const outDir = path.resolve(process.cwd(), "../docs/v5-4-3-from-v541");
    fs.mkdirSync(outDir, { recursive: true });
    const measurements: Record<string, { sw: number; cw: number; delta: number; ok: boolean }> =
      {};
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await openPremiumPlan(page);
      measurements[`plan-${vp.w}x${vp.h}`] = await pageOverflow(page);
      expect(measurements[`plan-${vp.w}x${vp.h}`]!.ok).toBe(true);
    }
    fs.writeFileSync(
      path.join(outDir, "overflow-measurements.json"),
      JSON.stringify(measurements, null, 2)
    );
    for (const width of [390, 430] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 932 });
      await openPremiumPlan(page);
      await expect(page.getByTestId("intraday-action-label")).toBeVisible();
      await page.screenshot({
        path: path.join(outDir, `dashboard-${width}.png`),
        fullPage: false
      });
      const diagnostics = await openAdvancedDiagnostics(page);
      const system = diagnostics.getByTestId("system-status-collapse");
      if (await system.isVisible().catch(() => false)) {
        if (!(await system.evaluate((el) => (el as HTMLDetailsElement).open))) {
          await system.locator("> summary").click({ force: true });
        }
        const toggle = diagnostics.getByTestId("score-toggle");
        if (await toggle.isVisible().catch(() => false)) await toggle.click({ force: true });
      }
      await page.screenshot({
        path: path.join(outDir, `score-expanded-${width}.png`),
        fullPage: false
      });
    }
  });
});
