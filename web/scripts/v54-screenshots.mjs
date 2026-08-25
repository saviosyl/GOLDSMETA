import { chromium } from "@playwright/test";
import fs from "fs";
const out = "/opt/cursor/artifacts/screenshots";
const base = "https://preview-v5-4.goldmeta-web.pages.dev";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
async function shot(name, w, h, path) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(base + path, { waitUntil: "networkidle", timeout: 90000 });
  await page.evaluate(async () => {
    const regs = await navigator.serviceWorker?.getRegistrations?.() ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  }).catch(() => {});
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  const m = await page.evaluate(() => ({
    build: document.documentElement.dataset.build,
    bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
    navy: getComputedStyle(document.documentElement).getPropertyValue("--navy").trim(),
    gold: getComputedStyle(document.documentElement).getPropertyValue("--gold").trim(),
    w: innerWidth, h: innerHeight
  }));
  console.log(name, m);
  await page.close();
}
await shot("v54-signin-1440", 1440, 900, "/");
await shot("v54-signin-390", 390, 844, "/");
await shot("v54-dashboard-1440", 1440, 900, "/ui-review/");
await shot("v54-dashboard-390", 390, 844, "/ui-review/");
await shot("v54-settings-1440", 1440, 900, "/ui-review/settings");
await shot("v54-analytics-1440", 1440, 900, "/ui-review/analytics");
await shot("v54-replay-1440", 1440, 900, "/ui-review/replay");
await shot("v54-brand-1440", 1440, 900, "/brand");
await browser.close();
