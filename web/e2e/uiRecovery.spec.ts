import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "../docs/v5-4-3-ui-recovery");
const WIDTHS = [320, 360, 375, 390, 393, 430] as const;

async function overflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const sw = document.documentElement.scrollWidth;
    const cw = document.documentElement.clientWidth;
    return { sw, cw, delta: sw - cw };
  });
}

test.describe("V5.4.3 UI recovery — overflow + viewport", () => {
  test("viewport allows accessibility zoom", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const content = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(content).toContain("width=device-width");
    expect(content).toContain("initial-scale=1");
    expect(content).toContain("viewport-fit=cover");
    expect(content).not.toMatch(/maximum-scale\s*=\s*1/);
    expect(content).not.toMatch(/user-scalable\s*=\s*no/);
  });

  for (const width of WIDTHS) {
    test(`Dashboard horizontal overflow ≤1px @ ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/ui-review/");
      await expect(page.getByTestId("overview-page")).toBeVisible();
      expect((await overflow(page)).delta).toBeLessThanOrEqual(1);
    });
  }

  test("closed modal keeps Dashboard sections and classes", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ui-review/");
    await expect(page.getByTestId("primary-signal-card")).toBeVisible();
    await expect(page.getByTestId("share-market-snapshot")).toBeVisible();
    await expect(page.getByTestId("market-story")).toBeVisible();
    await expect(page.getByTestId("market-level-ladder")).toBeVisible();
    await expect(page.getByTestId("goldmeta-score")).toBeVisible();
    await expect(page.getByTestId("current-plan")).toBeVisible();
    expect(await page.getByTestId("overview-page").getAttribute("class")).toContain(
      "gm-dashboard--v542"
    );
    await expect(page.getByTestId("promo-snapshot-modal")).toHaveCount(0);
  });

  test("capture recovery comparison frames", async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    const shots: Array<{ name: string; w: number; h: number; path: string; prep?: string }> = [
      { name: "dashboard-desktop-1440", w: 1440, h: 900, path: "/ui-review/" },
      { name: "dashboard-tablet-768", w: 768, h: 1024, path: "/ui-review/" },
      { name: "dashboard-mobile-390", w: 390, h: 844, path: "/ui-review/" },
      { name: "dashboard-mobile-430", w: 430, h: 932, path: "/ui-review/" },
      { name: "signin-mobile-390", w: 390, h: 844, path: "/" },
      { name: "settings-mobile-390", w: 390, h: 844, path: "/ui-review/settings" },
      { name: "score-expanded-390", w: 390, h: 844, path: "/ui-review/", prep: "score" },
      { name: "market-map-390", w: 390, h: 844, path: "/ui-review/", prep: "map" }
    ];

    const measurements: Record<string, { sw: number; cw: number; delta: number }> = {};

    for (const shot of shots) {
      await page.setViewportSize({ width: shot.w, height: shot.h });
      await page.goto(shot.path);
      if (shot.path.includes("ui-review")) {
        await expect(page.getByTestId("overview-page").or(page.getByTestId("settings-page")).first()).toBeVisible({
          timeout: 15000
        }).catch(async () => {
          // settings may use different test id
          await page.waitForTimeout(500);
        });
      }
      if (shot.prep === "score") {
        const expand = page.getByTestId("score-expand");
        if (await expand.count()) await expand.click();
      }
      if (shot.prep === "map") {
        await page.getByTestId("market-level-ladder").scrollIntoViewIfNeeded();
      }
      await page.waitForTimeout(300);
      await page.screenshot({
        path: path.join(OUT, `${shot.name}.png`),
        fullPage: false
      });
      measurements[shot.name] = await overflow(page);
    }

    fs.writeFileSync(path.join(OUT, "overflow-measurements.json"), JSON.stringify(measurements, null, 2));
  });
});
