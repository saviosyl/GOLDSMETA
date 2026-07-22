import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const MOBILE_WIDTHS = [320, 360, 375, 390, 393, 430] as const;

async function pageOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const sw = document.documentElement.scrollWidth;
    const cw = document.documentElement.clientWidth;
    return { sw, cw, delta: sw - cw };
  });
}

test.describe("V5.4.3 mobile fit — zoom + horizontal overflow", () => {
  test("viewport meta allows accessibility zoom", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const content = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(content).toContain("width=device-width");
    expect(content).toContain("initial-scale=1");
    expect(content).not.toMatch(/maximum-scale\s*=\s*1/);
    expect(content).not.toMatch(/user-scalable\s*=\s*no/);
  });

  for (const width of MOBILE_WIDTHS) {
    test(`no page overflow on Dashboard @ ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/ui-review/");
      await expect(page.getByTestId("overview-page")).toBeVisible();
      const m = await pageOverflow(page);
      expect(m.delta).toBeLessThanOrEqual(1);

      // Expand score if present
      const expand = page.getByTestId("score-expand");
      if (await expand.count()) {
        await expand.click();
        await page.waitForTimeout(100);
      }
      expect((await pageOverflow(page)).delta).toBeLessThanOrEqual(1);

      // Snapshot modal
      await page.getByTestId("share-market-snapshot").click();
      await page.waitForSelector('[data-testid="promo-snapshot-modal"]');
      await page.waitForSelector('[data-testid="promo-snapshot-preview"]', { timeout: 15000 });
      expect((await pageOverflow(page)).delta).toBeLessThanOrEqual(1);
      const previewBox = await page.getByTestId("promo-snapshot-preview").boundingBox();
      expect(previewBox?.width ?? 0).toBeLessThanOrEqual(width + 1);
    });

    test(`no page overflow on sign-in after refresh @ ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
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
});

test.describe("V5.4.3 mobile screenshot artifacts", () => {
  test("capture 320 / 390 / 430 dashboard frames", async ({ page }) => {
    const outDir = path.resolve(process.cwd(), "../docs/v5-4-3-mobile-fit");
    fs.mkdirSync(outDir, { recursive: true });
    for (const width of [320, 390, 430] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/ui-review/");
      await expect(page.getByTestId("primary-decision")).toBeVisible();
      await page.screenshot({
        path: path.join(outDir, `dashboard-${width}.png`),
        fullPage: false
      });
    }
  });
});
