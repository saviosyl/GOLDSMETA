/**
 * Capture premium redesign screenshots via Playwright (UI review host).
 * Usage from web/: node scripts/capture-premium-ui-screenshots.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "../../docs/ux/premium-redesign");
mkdirSync(outDir, { recursive: true });

const base = process.env.UI_REVIEW_BASE || "http://127.0.0.1:4173/ui-review";

const shots = [
  { name: "home-plan-mobile-390.png", path: "/", width: 390, height: 844 },
  { name: "home-plan-mobile-375.png", path: "/", width: 375, height: 812 },
  { name: "levels-mobile-390.png", path: "/levels", width: 390, height: 844 },
  { name: "alerts-setup-mobile-390.png", path: "/alerts", width: 390, height: 844 },
  { name: "home-plan-desktop.png", path: "/", width: 1440, height: 900 },
  { name: "levels-desktop.png", path: "/levels", width: 1440, height: 900 }
];

const browser = await chromium.launch({ headless: true });
for (const shot of shots) {
  const page = await browser.newPage({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: 2
  });
  const url = `${base}${shot.path === "/" ? "" : shot.path}`;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(outDir, shot.name), fullPage: false });
    console.log("wrote", shot.name);
  } catch (err) {
    console.warn("skip", shot.name, err instanceof Error ? err.message : err);
  }
  await page.close();
}
await browser.close();
console.log("done →", outDir);
