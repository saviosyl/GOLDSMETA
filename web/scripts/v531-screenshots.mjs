import { chromium } from "@playwright/test";
import fs from "fs";

const out = "/opt/cursor/artifacts/screenshots";
const base = "https://preview-v5-3.goldmeta-web.pages.dev";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const report = [];

async function metrics(page) {
  return page.evaluate(() => {
    const layout = document.querySelector('[data-testid="signin-layout"], [data-testid="ui-review-shell"], [data-testid="public-brand-shell"]');
    const card = document.querySelector('[data-testid="signin-card"]');
    const main = document.querySelector(".gm-main-inner");
    const sidebar = document.querySelector('[data-testid="desktop-sidebar"]');
    const mobile = document.querySelector('[data-testid="mobile-bottom-nav"]');
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      documentWidth: document.documentElement.clientWidth,
      bodyWidth: document.body.getBoundingClientRect().width,
      layoutWidth: layout?.getBoundingClientRect().width ?? null,
      cardWidth: card?.getBoundingClientRect().width ?? null,
      mainWidth: main?.getBoundingClientRect().width ?? null,
      sidebarDisplay: sidebar ? getComputedStyle(sidebar).display : null,
      mobileNavDisplay: mobile ? getComputedStyle(mobile).display : null,
      breakpoint: window.innerWidth >= 1100 ? "desktop" : window.innerWidth >= 768 ? "tablet" : "mobile",
      build: document.documentElement.dataset.build,
      bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      gold: getComputedStyle(document.documentElement).getPropertyValue("--gold").trim()
    };
  });
}

async function shot(name, w, h, path) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(1200);
  const m = await metrics(page);
  report.push({ name, path, ...m });
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  console.log(name, JSON.stringify(m));
  await page.close();
}

await shot("v531-signin-1440", 1440, 900, "/");
await shot("v531-signin-390", 390, 844, "/");
await shot("v531-brand-1440", 1440, 900, "/brand");
await shot("v531-brand-390", 390, 844, "/brand");
await shot("v531-overview-1440", 1440, 900, "/ui-review/");
await shot("v531-overview-390", 390, 844, "/ui-review/");
await shot("v531-intelligence-1440", 1440, 900, "/ui-review/intelligence");
await shot("v531-analytics-1440", 1440, 900, "/ui-review/analytics");
await shot("v531-replay-1440", 1440, 900, "/ui-review/replay");
await shot("v531-settings-1440", 1440, 900, "/ui-review/settings");
await shot("v531-planner-1440", 1440, 900, "/ui-review/planner");
await shot("v531-overview-empty-1440", 1440, 900, "/ui-review/?empty=1");
await shot("v531-intelligence-offline-1440", 1440, 900, "/ui-review/intelligence?offline=1");

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`${base}/ui-review/`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "More" }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/v531-more-390.png`, fullPage: true });
await page.close();

fs.writeFileSync(`${out}/v531-viewport-report.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log("done", report.length);
