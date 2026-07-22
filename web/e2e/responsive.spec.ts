import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844, expectMobileNav: true },
  { name: "768x1024", width: 768, height: 1024, expectMobileNav: true },
  { name: "1024x768", width: 1024, height: 768, expectMobileNav: true },
  { name: "1280x800", width: 1280, height: 800, expectMobileNav: false },
  { name: "1440x900", width: 1440, height: 900, expectMobileNav: false },
  { name: "1920x1080", width: 1920, height: 1080, expectMobileNav: false }
] as const;

test.describe("V5.4 responsive viewport matrix", () => {
  for (const vp of VIEWPORTS) {
    test(`sign-in metrics @ ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      await expect(page.getByTestId("signin-card")).toBeVisible();

      const metrics = await page.evaluate(() => {
        const doc = document.documentElement;
        const body = document.body;
        const shell = document.querySelector('[data-testid="signed-out-shell"]') as HTMLElement | null;
        const layout = document.querySelector('[data-testid="signin-layout"]') as HTMLElement | null;
        const card = document.querySelector('[data-testid="signin-card"]') as HTMLElement | null;
        return {
          viewport: { w: window.innerWidth, h: window.innerHeight },
          documentWidth: doc.clientWidth,
          bodyWidth: body.getBoundingClientRect().width,
          shellWidth: shell?.getBoundingClientRect().width ?? null,
          layoutWidth: layout?.getBoundingClientRect().width ?? null,
          cardWidth: card?.getBoundingClientRect().width ?? null,
          breakpoint:
            window.innerWidth >= 1100 ? "desktop" : window.innerWidth >= 768 ? "tablet" : "mobile"
        };
      });

      expect(metrics.viewport.w).toBe(vp.width);
      expect(metrics.documentWidth).toBeGreaterThanOrEqual(vp.width - 1);
      expect(metrics.bodyWidth).toBeGreaterThanOrEqual(vp.width - 1);
      expect(metrics.shellWidth ?? 0).toBeGreaterThanOrEqual(vp.width - 1);
      expect(metrics.layoutWidth ?? 0).toBeGreaterThanOrEqual(vp.width - 1);

      if (vp.width >= 1280) {
        // Centred premium card (~440px), not a 270px mobile column
        expect(metrics.cardWidth ?? 0).toBeGreaterThanOrEqual(400);
        expect(metrics.cardWidth ?? 0).toBeLessThanOrEqual(480);
        expect(metrics.breakpoint).toBe("desktop");
      } else if (vp.width < 768) {
        expect(metrics.cardWidth ?? 0).toBeGreaterThan(vp.width - 56);
        expect(metrics.cardWidth ?? 0).toBeLessThanOrEqual(vp.width);
      }

      await expect(page.getByText(/backend decisions/i)).toHaveCount(0);
      await expect(page.getByText(/Firebase/i)).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
      if (vp.width >= 1280) {
        const theme = await page.evaluate(() => ({
          bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
          navy: getComputedStyle(document.documentElement).getPropertyValue("--navy").trim()
        }));
        expect(theme.bg.toLowerCase()).toBe("#f7f8fa");
        expect(theme.navy.toLowerCase()).toBe("#11284a");
      }
    });
  }

  test("review shell desktop shows sidebar, hides mobile nav @ 1440", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/ui-review/");
    await expect(page.getByTestId("ui-review-shell")).toBeVisible();
    await expect(page.getByTestId("desktop-sidebar")).toBeVisible();
    await expect(page.getByTestId("overview-page")).toBeVisible();
    const mobileVisible = await page.getByTestId("mobile-bottom-nav").evaluate((el) => {
      return getComputedStyle(el).display !== "none";
    });
    expect(mobileVisible).toBe(false);
    const mainWidth = await page.locator(".gm-main-inner").evaluate((el) => el.getBoundingClientRect().width);
    expect(mainWidth).toBeGreaterThan(900);
  });

  test("review shell mobile shows bottom nav, hides sidebar @ 390", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ui-review/");
    await expect(page.getByTestId("ui-review-shell")).toBeVisible();
    const sidebarVisible = await page.getByTestId("desktop-sidebar").evaluate((el) => {
      return getComputedStyle(el).display !== "none";
    });
    expect(sidebarVisible).toBe(false);
    await expect(page.getByTestId("mobile-bottom-nav")).toBeVisible();
    await page.getByRole("button", { name: "More" }).click();
    await expect(page.getByTestId("mobile-more-sheet")).toBeVisible();
  });

  test("brand page shows approved branding assets", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/brand");
    await expect(page.getByTestId("brand-concepts-page")).toBeVisible();
    await expect(page.getByTestId("brand-approved-note")).toBeVisible();
    await expect(page.getByAltText("GoldMeta full logo")).toBeVisible();
  });

  test("V5.4.2 primary signal visible in first mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ui-review/");
    await expect(page.getByTestId("overview-page")).toBeVisible();
    await expect(page.getByTestId("primary-signal-card")).toBeVisible();
    await expect(page.getByTestId("primary-decision")).toBeVisible();
    const inFirstViewport = await page.getByTestId("primary-decision").evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    });
    expect(inFirstViewport).toBe(true);
    await expect(page.getByTestId("market-story")).toBeVisible();
    await expect(page.getByTestId("market-level-ladder")).toBeVisible();
    await expect(page.getByTestId("current-plan")).toBeVisible();
    // Email must stay behind account menu, not in Dashboard content
    await expect(page.getByTestId("overview-page")).not.toContainText("review@goldmeta.preview");
    await expect(page.getByTestId("account-menu-button")).toBeVisible();
  });

  test("V5.4.2 desktop dash grid uses available width", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/ui-review/");
    await expect(page.getByTestId("market-story")).toBeVisible();
    const grid = page.locator(".gm-dash-grid");
    await expect(grid).toBeVisible();
    const widths = await grid.evaluate((el) => {
      const style = getComputedStyle(el);
      const map = el.querySelector(".gm-dash-map") as HTMLElement | null;
      const score = el.querySelector(".gm-dash-score") as HTMLElement | null;
      return {
        cols: style.gridTemplateColumns,
        mapW: map?.getBoundingClientRect().width ?? 0,
        scoreW: score?.getBoundingClientRect().width ?? 0,
        total: el.getBoundingClientRect().width
      };
    });
    expect(widths.total).toBeGreaterThan(900);
    expect(widths.mapW).toBeGreaterThan(widths.scoreW);
  });

  test("V5.4.3 Share Market Snapshot opens modal on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ui-review/");
    await expect(page.getByTestId("share-market-snapshot")).toBeVisible();
    await page.getByTestId("share-market-snapshot").click();
    await expect(page.getByTestId("promo-snapshot-modal")).toBeVisible();
    await expect(page.getByTestId("promo-snapshot-status")).toContainText(/Preparing|Snapshot ready|Unable/i);
    await page.waitForSelector('[data-testid="promo-snapshot-preview"]', { timeout: 15_000 });
    await expect(page.getByTestId("promo-snapshot-share")).toBeEnabled();
    await expect(page.getByTestId("promo-snapshot-download")).toBeEnabled();
    const wrap = page.getByTestId("promo-snapshot-preview-wrap");
    const overflowY = await wrap.evaluate((el) => getComputedStyle(el).overflowY);
    expect(["auto", "scroll", "overlay"]).toContain(overflowY);
    await page.getByTestId("promo-snapshot-close").click();
    await expect(page.getByTestId("promo-snapshot-modal")).toHaveCount(0);
  });
});
