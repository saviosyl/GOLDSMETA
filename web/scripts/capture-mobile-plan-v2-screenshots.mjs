/**
 * Capture Mobile Plan V2 screenshots for BUY / SELL / WAIT / NO VALID / NO TRADE.
 * Usage: node scripts/capture-mobile-plan-v2-screenshots.mjs [baseUrl]
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const baseURL = process.argv[2] || process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4173";
const outDir = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../docs/ux/mobile-plan-v2"
);
const artifactDir = "/opt/cursor/artifacts/screenshots";
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(artifactDir, { recursive: true });

const FORBIDDEN = [
  /LABELLED FIXTURE/i,
  /LABELLED PREVIEW/i,
  /not live market data/i,
  /preview fixture/i,
  /test scenario/i
];

const states = [
  { id: "buy", scenario: "issue50-buy-confirmed", assert: /BUY/i },
  { id: "sell", scenario: "issue50-sell-confirmed", assert: /SELL/i },
  { id: "wait", scenario: "issue50-below-val", assert: /WAIT|PREPARE/i },
  { id: "no-valid", scenario: "issue50-live-range-only", assert: /NO VALID PLAN/i },
  { id: "no-trade", scenario: "issue50-mismatch", assert: /NO TRADE/i }
];

const viewports = [
  { name: "mobile-375", width: 375, height: 812 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1024", width: 1024, height: 768 },
  { name: "desktop-1440", width: 1440, height: 900 }
];

const browser = await chromium.launch({ headless: true });
const paths = [];
const checks = [];

for (const state of states) {
  for (const vp of viewports) {
    const page = await browser.newPage({
      viewport: { width: vp.width, height: vp.height }
    });
    await page.goto(`${baseURL}/ui-review/?scenario=${state.scenario}`, {
      waitUntil: "networkidle"
    });
    await page.getByTestId("todays-intraday-plan").waitFor({ state: "visible", timeout: 15000 });
    const bodyText = await page.locator("body").innerText();
    for (const re of FORBIDDEN) {
      if (re.test(bodyText)) {
        throw new Error(`Fixture text in ${state.id}/${vp.name}: ${re}`);
      }
    }
    const cardText = await page.getByTestId("todays-intraday-plan").innerText();
    if (!state.assert.test(cardText)) {
      throw new Error(`State assert failed for ${state.id}: expected ${state.assert} in card`);
    }

    // Contradictions
    if (state.id === "no-valid") {
      if (/PREPARE/i.test(cardText)) {
        throw new Error("NO VALID PLAN card still shows PREPARE");
      }
      const matches = cardText.match(/NO VALID PLAN/gi) || [];
      if (matches.length > 1) {
        throw new Error(`Duplicated NO VALID PLAN messages: ${matches.length}`);
      }
    }

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth > doc.clientWidth + 1;
    });
    if (overflow) {
      throw new Error(`Horizontal overflow on ${state.id}/${vp.name}`);
    }

    const fileName = `plan-v2-${state.id}-${vp.name}.png`;
    const file = path.join(outDir, fileName);
    await page.screenshot({ path: file, fullPage: false });
    fs.copyFileSync(file, path.join(artifactDir, fileName));
    paths.push(file);
    checks.push({ state: state.id, viewport: vp.name, overflow: false, fixtureTextAbsent: true });
    await page.close();
  }
}

// Canonical mobile (390) + desktop (1440) copies with short names for the release checklist
for (const state of states) {
  const mobileSrc = path.join(outDir, `plan-v2-${state.id}-mobile-390.png`);
  const desktopSrc = path.join(outDir, `plan-v2-${state.id}-desktop-1440.png`);
  fs.copyFileSync(mobileSrc, path.join(outDir, `mobile-${state.id}.png`));
  fs.copyFileSync(desktopSrc, path.join(outDir, `desktop-${state.id}.png`));
  fs.copyFileSync(mobileSrc, path.join(artifactDir, `mobile-plan-v2-${state.id}.png`));
  fs.copyFileSync(desktopSrc, path.join(artifactDir, `desktop-plan-v2-${state.id}.png`));
}

await browser.close();
console.log(JSON.stringify({ baseURL, paths, checks, ok: true }, null, 2));
