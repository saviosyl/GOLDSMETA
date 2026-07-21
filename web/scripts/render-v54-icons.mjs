import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";

const root = path.resolve("public");
const mark = fs.readFileSync(path.join(root, "brand/mark-app-v54.svg"), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });

async function render(size, outPath, svg = mark) {
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg.replace('<svg', `<svg width="${size}" height="${size}"`)}</body></html>`);
  await page.setViewportSize({ width: size, height: size });
  await page.locator("svg").screenshot({ path: outPath, omitBackground: true });
  console.log("wrote", outPath);
}

await render(16, path.join(root, "favicon-16x16.png"));
await render(32, path.join(root, "favicon-32x32.png"));
await render(180, path.join(root, "icons/apple-touch-icon.png"));
await render(192, path.join(root, "icons/icon-192.png"));
await render(192, path.join(root, "icons/pwa-192x192.png"));
await render(512, path.join(root, "icons/icon-512.png"));
await render(512, path.join(root, "icons/pwa-512x512.png"));
await render(192, path.join(root, "icons/maskable-icon-192.png"));
await render(512, path.join(root, "icons/maskable-icon-512.png"));
await render(192, path.join(root, "icons/pwa-maskable-192x192.png"));
await render(512, path.join(root, "icons/pwa-maskable-512x512.png"));
await render(256, path.join(root, "brand/mark-dark-256.png"));
await render(256, path.join(root, "brand/mark-light-256.png"));
// favicon.svg copy
fs.copyFileSync(path.join(root, "brand/mark-v54.svg"), path.join(root, "favicon.svg"));
await browser.close();
