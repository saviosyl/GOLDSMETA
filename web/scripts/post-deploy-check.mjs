#!/usr/bin/env node
/**
 * Post-deploy check for Cloudflare Pages production assets.
 * Verifies index references hashed assets and JS/CSS MIME types.
 *
 * Usage:
 *   node scripts/post-deploy-check.mjs https://goldmeta.metamechsolutions.com
 */
const base = (process.argv[2] || "https://goldmeta.metamechsolutions.com").replace(/\/$/, "");

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
};

const main = async () => {
  const htmlRes = await fetch(`${base}/?t=${Date.now()}`, {
    headers: { "Cache-Control": "no-cache" }
  });
  const html = await htmlRes.text();
  const js = html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/)?.[1];
  const css = html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.css)/)?.[1];
  if (!js || !css) {
    fail("index.html missing hashed asset references");
    return;
  }
  console.log(`index assets: ${js} ${css}`);

  const cssRes = await fetch(`${base}/assets/${css}`);
  const cssType = cssRes.headers.get("content-type") || "";
  if (cssRes.status !== 200 || !cssType.includes("text/css")) {
    fail(`CSS MIME/status: ${cssRes.status} ${cssType}`);
  } else {
    console.log(`CSS OK: ${cssType}`);
  }

  const jsRes = await fetch(`${base}/assets/${js}`);
  const jsType = jsRes.headers.get("content-type") || "";
  if (jsRes.status !== 200 || !(jsType.includes("javascript") || jsType.includes("ecmascript"))) {
    fail(`JS MIME/status: ${jsRes.status} ${jsType}`);
  } else {
    console.log(`JS OK: ${jsType}`);
  }

  const missing = await fetch(`${base}/assets/definitely-missing-${Date.now()}.js`);
  const missingType = missing.headers.get("content-type") || "";
  const missingBody = await missing.text();
  // Prefer 404; if SPA still catches, at least flag HTML-as-JS.
  if (missing.status === 200 && missingType.includes("javascript") === false && missingBody.includes("<!doctype html>")) {
    fail("Missing /assets/* still SPA-falls-back to HTML with 200");
  } else {
    console.log(`missing asset status=${missing.status} type=${missingType}`);
  }

  if (!process.exitCode) console.log("post-deploy checks passed");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
