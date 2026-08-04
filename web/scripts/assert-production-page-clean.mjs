#!/usr/bin/env node
/**
 * Assert a running production (or production-equivalent) page has no fixture labels.
 * Usage: node scripts/assert-production-page-clean.mjs [url]
 */
import { chromium } from "@playwright/test";

const url = process.argv[2] || process.env.PLAYWRIGHT_BASE_URL || "https://goldmeta.metamechsolutions.com/";
const FORBIDDEN = [
  "LABELLED FIXTURE",
  "LABELLED PREVIEW",
  "not live market data",
  "preview fixture",
  "test scenario labels"
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
const status = resp?.status() ?? 0;
const html = await page.content();
const text = await page.locator("body").innerText().catch(() => "");
const hits = FORBIDDEN.filter((n) => html.includes(n) || text.includes(n));
await browser.close();

if (status < 200 || status >= 400) {
  console.error(`FAIL: page HTTP ${status} for ${url}`);
  process.exit(1);
}
if (hits.length) {
  console.error("FAIL: fixture/preview strings found on page:");
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`PASS: no fixture/preview labels on ${url} (HTTP ${status})`);
