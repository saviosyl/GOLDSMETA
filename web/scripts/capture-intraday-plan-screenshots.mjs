/**
 * Capture Today's Intraday Plan screenshots at required viewports.
 * Usage: node scripts/capture-intraday-plan-screenshots.mjs [baseUrl]
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const baseURL = process.argv[2] || process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4173";
const outDir = "/opt/cursor/artifacts/screenshots";
fs.mkdirSync(outDir, { recursive: true });

const viewports = [
  { name: "mobile-390x844", width: 390, height: 844 },
  { name: "tablet-1024x768", width: 1024, height: 768 },
  { name: "desktop-1440x900", width: 1440, height: 900 }
];

const browser = await chromium.launch({ headless: true });
const paths = [];

for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  await page.goto(`${baseURL}/ui-review/?scenario=issue50-below-val`, {
    waitUntil: "networkidle"
  });
  await page.getByTestId("todays-intraday-plan").waitFor({ state: "visible" });
  const file = path.join(outDir, `intraday-plan-${vp.name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  paths.push(file);

  // Also capture buy-confirmed colour state on mobile
  if (vp.name === "mobile-390x844") {
    await page.goto(`${baseURL}/ui-review/?scenario=issue50-buy-confirmed`, {
      waitUntil: "networkidle"
    });
    await page.getByTestId("intraday-action-card").waitFor({ state: "visible" });
    const buyFile = path.join(outDir, "intraday-plan-mobile-390x844-buy-now.png");
    await page.screenshot({ path: buyFile, fullPage: false });
    paths.push(buyFile);
  }
  await page.close();
}

await browser.close();
console.log(JSON.stringify({ baseURL, paths }, null, 2));
