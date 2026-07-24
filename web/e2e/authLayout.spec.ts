import { expect, test } from "@playwright/test";

/**
 * Regression: public auth pages must never inherit the dashboard sidebar
 * grid column (~248px). Card and submit controls must stay inside the viewport.
 */

const WIDTHS = [320, 360, 375, 390, 430, 768, 1024, 1280, 1440, 1920];

const AUTH_PATHS = [
  { path: "/register", card: "[data-testid='register-card']", submit: "[data-testid='register-submit']" },
  { path: "/ui-review/", card: ".gm-auth-card, [data-testid='signin-card'], form", submit: "button[type='submit'], .gm-auth-submit" },
  { path: "/ui-review/brokers", card: "[data-testid='broker-control-centre'], .gm-broker-centre", submit: null },
  { path: "/ui-review/help", card: ".gm-section, main, [data-testid]", submit: null },
  { path: "/legal/terms", card: ".gm-auth-card", submit: null },
  { path: "/legal/privacy", card: ".gm-auth-card", submit: null },
  { path: "/legal/risk", card: ".gm-auth-card", submit: null }
];

async function assertNoHorizontalClip(
  page: import("@playwright/test").Page,
  selector: string,
  minWidth: number
) {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `missing ${selector}`).toBeTruthy();
  if (!box) return;
  const viewport = page.viewportSize();
  expect(viewport).toBeTruthy();
  if (!viewport) return;
  expect(box.width).toBeGreaterThanOrEqual(minWidth);
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
}

test.describe("Auth / public layout — no sidebar-column clip", () => {
  for (const width of WIDTHS) {
    test(`register card usable @ ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/register", { waitUntil: "networkidle" });

      const shell = page.getByTestId("register-shell");
      await expect(shell).toBeVisible();

      const shellBox = await shell.boundingBox();
      expect(shellBox?.width).toBeGreaterThanOrEqual(width - 2);

      const cols = await shell.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
      // Must be a single track — never "248px …"
      expect(cols.includes("248px")).toBe(false);
      expect(cols.split(" ").filter(Boolean).length).toBe(1);

      const minCard = Math.min(280, width - 32);
      await assertNoHorizontalClip(page, "[data-testid='register-card']", minCard);
      await assertNoHorizontalClip(page, "[data-testid='register-submit']", Math.min(200, width - 48));

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

      // Submit reachable by scrolling
      await page.getByTestId("register-submit").scrollIntoViewIfNeeded();
      await expect(page.getByTestId("register-submit")).toBeVisible();
    });
  }

  test("sign-in shell stays full width on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "networkidle" });
    const shell = page.getByTestId("signed-out-shell");
    await expect(shell).toBeVisible();
    const cols = await shell.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    expect(cols.includes("248px")).toBe(false);
    const card = page.locator(".gm-auth-card").first();
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(360);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(1441);
  });

  test("legal pages are not clipped on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const path of ["/legal/terms", "/legal/privacy", "/legal/risk"]) {
      await page.goto(path, { waitUntil: "networkidle" });
      const card = page.locator(".gm-auth-card").first();
      await expect(card).toBeVisible();
      const box = await card.boundingBox();
      expect(box?.width, path).toBeGreaterThanOrEqual(360);
      expect((box?.x ?? 0) + (box?.width ?? 0), path).toBeLessThanOrEqual(1441);
    }
  });

  test("register fields accept keyboard input without horizontal page scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/register", { waitUntil: "networkidle" });
    await page.getByLabel(/first name/i).fill("Test");
    await page.getByLabel(/last name/i).fill("User");
    await page.getByLabel(/email/i).fill("test.user@example.com");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    );
    expect(overflow).toBe(true);
  });
});

test.describe("Auth layout zoom reflow", () => {
  for (const zoom of [0.8, 0.9, 1, 1.1, 1.25, 1.5, 2]) {
    test(`register at zoom ${zoom}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/register", { waitUntil: "networkidle" });
      await page.evaluate((z) => {
        document.documentElement.style.zoom = String(z);
      }, zoom);
      await page.waitForTimeout(100);
      const card = page.getByTestId("register-card");
      await expect(card).toBeVisible();
      const box = await card.boundingBox();
      expect(box?.width).toBeGreaterThan(200);
      // Card should not collapse to sidebar width
      expect(box?.width).toBeGreaterThan(280);
    });
  }
});

void AUTH_PATHS;
