/**
 * Capture Premium UI V2 screenshots via Playwright (UI review host).
 * Usage from web/:
 *   UI_REVIEW_BASE=http://127.0.0.1:4177/ui-review node scripts/capture-premium-ui-screenshots.mjs
 * Optional out dir as argv[2].
 */
import { chromium } from "playwright";
import { mkdirSync, copyFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2]
  ? join(process.cwd(), process.argv[2])
  : join(__dirname, "../../docs/ux/premium-v2");
mkdirSync(outDir, { recursive: true });

const base = (process.env.UI_REVIEW_BASE || "http://127.0.0.1:4177/ui-review").replace(/\/$/, "");

const shots = [
  { name: "home-plan-mobile-390.png", path: "/", width: 390, height: 844 },
  { name: "home-plan-mobile-375.png", path: "/", width: 375, height: 812 },
  { name: "home-plan-mobile-320.png", path: "/", width: 320, height: 720 },
  { name: "levels-mobile-390.png", path: "/levels", width: 390, height: 844 },
  { name: "alerts-setup-mobile-390.png", path: "/alerts", width: 390, height: 844 },
  { name: "markets-mobile-390.png", path: "/intelligence", width: 390, height: 844 },
  { name: "journal-mobile-390.png", path: "/journal", width: 390, height: 844 },
  { name: "notifications-mobile-390.png", path: "/", width: 390, height: 844, openBell: true },
  { name: "home-plan-desktop.png", path: "/", width: 1440, height: 900 },
  { name: "levels-desktop.png", path: "/levels", width: 1440, height: 900 },
  { name: "markets-desktop.png", path: "/intelligence", width: 1440, height: 900 },
  { name: "journal-desktop.png", path: "/journal", width: 1440, height: 900 },
  { name: "alerts-setup-desktop.png", path: "/alerts", width: 1440, height: 900 }
];

const browser = await chromium.launch({ headless: true });
for (const shot of shots) {
  const page = await browser.newPage({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: 2
  });
  const url = `${base}${shot.path === "/" ? "" : shot.path}`;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForSelector('[data-testid="ui-review-shell"], [data-testid="app-shell"]', {
      timeout: 15000
    });
    await page.waitForTimeout(900);
    if (shot.openBell) {
      const bell = page.locator('[data-testid="notification-bell"], button[aria-label*="notification" i], button[aria-label*="alert" i]').first();
      if (await bell.count()) {
        await bell.click();
        await page.waitForTimeout(500);
      }
    }
    await page.screenshot({ path: join(outDir, shot.name), fullPage: false });
    console.log("wrote", shot.name);
  } catch (err) {
    console.warn("skip", shot.name, err instanceof Error ? err.message : err);
  }
  await page.close();
}
await browser.close();

// Mirror into artifacts when available
try {
  const art = "/opt/cursor/artifacts/premium-v2";
  mkdirSync(art, { recursive: true });
  for (const shot of shots) {
    try {
      copyFileSync(join(outDir, shot.name), join(art, shot.name));
    } catch {
      /* ignore missing */
    }
  }
  console.log("copied →", art);
} catch {
  /* ignore */
}

console.log("done →", outDir);
