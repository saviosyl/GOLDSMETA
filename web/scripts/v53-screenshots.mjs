import { chromium } from "@playwright/test";
import fs from "fs";

const outDir = "/opt/cursor/artifacts/screenshots";
const preview = "https://preview-v5-3.goldmeta-web.pages.dev";
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
async function shot(name, width, height, path) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(path, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
  await page.close();
  console.log("wrote", name);
}

await shot("v53-desktop-1440-signin", 1440, 900, `${preview}/`);
await shot("v53-mobile-390-signin", 390, 844, `${preview}/`);
await shot("v53-desktop-1440-brand", 1440, 900, `${preview}/brand`);
await shot("v53-mobile-390-brand", 390, 844, `${preview}/brand`);
await shot("v53-desktop-1440-scroll", 1440, 900, `${preview}/scroll-demo.html`);
await shot("v53-mobile-390-scroll", 390, 844, `${preview}/scroll-demo.html`);

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${preview}/`, { waitUntil: "networkidle" });
const tokenCheck = await page.evaluate(() => ({
  uiRedesign: document.documentElement.dataset.uiRedesign,
  build: document.documentElement.dataset.build,
  bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
  gold: getComputedStyle(document.documentElement).getPropertyValue("--gold").trim(),
  surface: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim()
}));
fs.writeFileSync(`${outDir}/v53-token-check.json`, JSON.stringify(tokenCheck, null, 2));
console.log(tokenCheck);
await browser.close();
