/**
 * Regenerate favicon / PWA icons from the official GitHub-uploaded logo mark.
 * Source of truth: public/brand/logo-official.png (Savio upload).
 * Derived mark: public/brand/mark-official.png
 */
import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";

const root = path.resolve("public");
const markPng = path.join(root, "brand/mark-app-official.png");
if (!fs.existsSync(markPng)) {
  console.error("Missing", markPng, "- run the official logo crop script first.");
  process.exit(1);
}

// Icons are already generated from logo-official.png by the Python crop script.
// This script only verifies presence and refreshes favicon.svg wrapper if needed.
const required = [
  "favicon-16x16.png",
  "favicon-32x32.png",
  "icons/apple-touch-icon.png",
  "icons/pwa-192x192.png",
  "icons/pwa-512x512.png",
  "brand/mark-official.png",
  "brand/logo-official.png",
  "brand/logo-full-official.png"
];
for (const rel of required) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    console.error("Missing required brand asset:", rel);
    process.exit(1);
  }
  console.log("ok", rel);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
const mark = fs.readFileSync(path.join(root, "brand/mark-official.png"));
const b64 = mark.toString("base64");
await page.setContent(`<!doctype html><html><body style="margin:0"><img id="m" src="data:image/png;base64,${b64}" width="64" height="64"/></body></html>`);
await page.locator("#m").screenshot({ path: path.join(root, "favicon-32x32.png") });
await browser.close();
console.log("favicon-32x32 refreshed from official mark");
