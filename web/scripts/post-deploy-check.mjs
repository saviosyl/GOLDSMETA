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
  const jsPath = html.match(/\/((?:assets|gm)\/index-[A-Za-z0-9_-]+\.js)/)?.[1];
  const cssPath = html.match(/\/((?:assets|gm)\/index-[A-Za-z0-9_-]+\.css)/)?.[1];
  if (!jsPath || !cssPath) {
    fail("index.html missing hashed asset references");
    return;
  }
  console.log(`index assets: ${jsPath} ${cssPath}`);

  const cssRes = await fetch(`${base}/${cssPath}?t=${Date.now()}`, {
    headers: { "Cache-Control": "no-cache" }
  });
  const cssType = cssRes.headers.get("content-type") || "";
  if (cssRes.status !== 200 || !cssType.includes("text/css")) {
    fail(`CSS MIME/status: ${cssRes.status} ${cssType}`);
  } else {
    console.log(`CSS OK: ${cssType}`);
  }

  const jsRes = await fetch(`${base}/${jsPath}?t=${Date.now()}`, {
    headers: { "Cache-Control": "no-cache" }
  });
  const jsType = jsRes.headers.get("content-type") || "";
  const jsBody = await jsRes.text();
  if (jsRes.status !== 200 || !(jsType.includes("javascript") || jsType.includes("ecmascript"))) {
    fail(`JS MIME/status: ${jsRes.status} ${jsType}`);
  } else {
    console.log(`JS OK: ${jsType}`);
  }

  // Release gate: live production must never ship an unconfigured Firebase bundle.
  const hasApiKey = /AIza[0-9A-Za-z_-]{20,}/.test(jsBody);
  const hasAuthDomain = jsBody.includes("goldmeta-web.firebaseapp.com");
  const hasProject = /projectId:\s*[`"']goldmeta-web[`"']/.test(jsBody);
  if (!hasApiKey || !hasAuthDomain || !hasProject) {
    fail(
      `Live bundle ${jsPath} is missing Firebase web config ` +
        `(apiKey=${hasApiKey}, authDomain=${hasAuthDomain}, projectId=${hasProject}). ` +
        'This serves "GoldMeta is not configured for this environment."'
    );
  } else {
    console.log(`Firebase config OK in ${jsPath}`);
  }

  const assetRoot = jsPath.startsWith("gm/") ? "gm" : "assets";
  const missing = await fetch(`${base}/${assetRoot}/definitely-missing-${Date.now()}.js`);
  const missingType = missing.headers.get("content-type") || "";
  const missingBody = await missing.text();
  // Prefer 404; if SPA still catches, at least flag HTML-as-JS.
  if (
    missing.status === 200 &&
    missingType.includes("javascript") === false &&
    missingBody.toLowerCase().includes("<!doctype html>")
  ) {
    // Expected while `/* /index.html 200` remains for SPA routing; warn only.
    console.warn(
      `WARN: Missing /${assetRoot}/* SPA-falls-back to HTML with 200 (known Pages SPA rewrite)`
    );
  } else {
    console.log(`missing asset status=${missing.status} type=${missingType}`);
  }

  if (!process.exitCode) console.log("post-deploy checks passed");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
