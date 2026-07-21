#!/usr/bin/env node
/**
 * Verify GoldMeta icon dimensions and production API config.
 * Run from web/: node scripts/verify-brand-assets.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pub = resolve(root, "public");

function pngSize(path) {
  const buf = readFileSync(path);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const expected = [
  ["favicon-16x16.png", 16, 16],
  ["favicon-32x32.png", 32, 32],
  ["icons/apple-touch-icon.png", 180, 180],
  ["icons/pwa-192x192.png", 192, 192],
  ["icons/pwa-512x512.png", 512, 512],
  ["icons/pwa-maskable-192x192.png", 192, 192],
  ["icons/pwa-maskable-512x512.png", 512, 512],
  ["icons/icon-192.png", 192, 192],
  ["icons/icon-512.png", 512, 512],
  ["icons/maskable-icon-192.png", 192, 192],
  ["icons/maskable-icon-512.png", 512, 512]
];

let failed = 0;
for (const [rel, w, h] of expected) {
  const path = resolve(pub, rel);
  if (!existsSync(path)) {
    console.error("MISSING", rel);
    failed += 1;
    continue;
  }
  const size = pngSize(path);
  if (size.width !== w || size.height !== h) {
    console.error("SIZE", rel, size, "expected", w, h);
    failed += 1;
  } else {
    console.log("OK", rel, `${w}x${h}`);
  }
}

const envPath = resolve(root, ".env.production.local");
const env = readFileSync(envPath, "utf8");
if (!env.includes("https://us-central1-goldmeta-web.cloudfunctions.net/api")) {
  console.error("API URL missing/incorrect in .env.production.local");
  failed += 1;
} else {
  console.log("OK production API URL");
}
if (/localhost|127\.0\.0\.1/.test(env.split("\n").find((l) => l.startsWith("VITE_API_BASE_URL")) ?? "")) {
  console.error("localhost API base");
  failed += 1;
}

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log("Brand asset verification passed");
