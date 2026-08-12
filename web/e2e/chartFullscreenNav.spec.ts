import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const MOBILE = [
  { w: 375, h: 812 },
  { w: 390, h: 844 },
  { w: 430, h: 932 }
] as const;

async function openPremiumPlan(
  page: import("@playwright/test").Page,
  opts?: { staff?: boolean }
) {
  const q = opts?.staff ? "?staff=1" : "";
  await page.goto(`/ui-review/${q}`);
  await expect(page.getByTestId("ui-review-shell")).toBeVisible();
  await expect(page.getByTestId("overview-page")).toBeVisible();
  await expect(page.getByTestId("plan-market-card")).toBeVisible({ timeout: 20_000 });
}

async function swipeVertOnChart(
  page: import("@playwright/test").Page,
  dy: number
): Promise<{ before: number; after: number; touchAction: string }> {
  const host = page.getByTestId("xauusd-chart-host");
  await host.scrollIntoViewIfNeeded();
  const box = await host.boundingBox();
  expect(box).toBeTruthy();
  const x = box!.x + box!.width / 2;
  const y = box!.y + Math.min(40, box!.height / 3);

  // Prefer CDP touch for real gesture synthesis on Chromium.
  const client = await page.context().newCDPSession(page);
  const before = await page.evaluate(() => window.scrollY);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }]
  });
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - (dy * i) / steps }]
    });
  }
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: []
  });
  await page.waitForTimeout(80);
  return page.evaluate((b) => {
    const el = document.querySelector(
      '[data-testid="xauusd-chart-host"]'
    ) as HTMLElement | null;
    return {
      before: b,
      after: window.scrollY,
      touchAction: el ? getComputedStyle(el).touchAction : ""
    };
  }, before);
}

test.describe("Chart fit + fullscreen", () => {
  test("desktop: Fit + Fullscreen controls, focus, ESC exit", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPremiumPlan(page);
    const chart = page.getByTestId("plan-market-card");
    await expect(chart).toBeVisible();
    await expect(page.getByTestId("chart-fit-view")).toBeVisible();
    const fsBtn = page.getByTestId("chart-fullscreen");
    await fsBtn.focus();
    await expect(fsBtn).toBeFocused();
    await page.getByTestId("chart-fit-view").click();
    await fsBtn.click();
    await expect(chart).toHaveAttribute("data-fullscreen", "1");
    await expect(page.getByTestId("chart-exit-fullscreen")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect
      .poll(async () =>
        chart.evaluate((el) => el.contains(document.activeElement))
      )
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(chart).toHaveAttribute("data-fullscreen", "0");
    await expect(page.getByTestId("chart-fullscreen")).toBeFocused();
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

    test(`embedded chart vertical swipe scrolls page @ ${vp.w}x${vp.h}`, async ({
      page
    }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await openPremiumPlan(page);
      // Ensure document can scroll.
      await page.evaluate(() => {
        document.documentElement.style.minHeight = "2000px";
        document.body.style.minHeight = "2000px";
      });
      const host = page.getByTestId("xauusd-chart-host");
      await expect(host).toHaveAttribute("data-touch-mode", "pan-y");
      const result = await swipeVertOnChart(page, 220);
      expect(result.touchAction).toMatch(/pan-y/);
      expect(result.after).toBeGreaterThan(result.before);
    });
  }

  test("normal USER and OWNER staff review share chart controls", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openPremiumPlan(page, { staff: false });
    await expect(page.getByTestId("chart-fit-view")).toBeVisible();
    await expect(page.getByTestId("chart-fullscreen")).toBeVisible();
    await expect(page.getByTestId("chart-level-legend")).toBeVisible();

    await openPremiumPlan(page, { staff: true });
    await expect(page.getByTestId("chart-fit-view")).toBeVisible();
    await expect(page.getByTestId("chart-fullscreen")).toBeVisible();
    await page.getByTestId("chart-fullscreen").click();
    await expect(page.getByTestId("plan-market-card")).toHaveAttribute(
      "data-fullscreen",
      "1"
    );
    await expect(page.getByTestId("chart-live-price")).toBeVisible();
  });
});

test.describe("Mobile bottom nav stays fixed", () => {
  for (const vp of MOBILE) {
    test(`nav pinned to viewport bottom @ ${vp.w}x${vp.h}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await openPremiumPlan(page);
      const nav = page.getByTestId("mobile-bottom-nav");
      await expect(nav).toBeVisible();
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
      expect(Math.abs(bottom!.bottom - bottom!.vh)).toBeLessThanOrEqual(2);
      expect(bottom!.top).toBeGreaterThan(bottom!.vh * 0.7);
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
