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
  const jsPath = html.match(/\/((?:assets|gm|gmv7)\/index-[A-Za-z0-9_-]+\.js)/)?.[1];
  const cssPath = html.match(/\/((?:assets|gm|gmv7)\/index-[A-Za-z0-9_-]+\.css)/)?.[1];
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

  const assetRoot = jsPath.startsWith("gmv7/")
    ? "gmv7"
    : jsPath.startsWith("gm/")
      ? "gm"
      : "assets";
  // Also verify Insights lazy chunk from the main bundle is reachable (release blocker).
  const insightsChunk = jsBody.match(/(?:assets|gm|gmv7)\/InsightsPage-[A-Za-z0-9_-]+\.js/)?.[0];
  if (insightsChunk) {
    const insightsRes = await fetch(`${base}/${insightsChunk}?t=${Date.now()}`, {
      headers: { "Cache-Control": "no-cache" }
    });
    const insightsType = insightsRes.headers.get("content-type") || "";
    if (
      insightsRes.status !== 200 ||
      !(insightsType.includes("javascript") || insightsType.includes("ecmascript"))
    ) {
      fail(`Insights chunk MIME/status: ${insightsChunk} ${insightsRes.status} ${insightsType}`);
    } else {
      console.log(`Insights chunk OK: ${insightsChunk}`);
    }
  } else {
    fail("Main bundle does not reference an InsightsPage chunk");
  }

  const missing = await fetch(`${base}/${assetRoot}/definitely-missing-${Date.now()}.js`, {
    headers: { "Cache-Control": "no-cache" }
  });
  const missingType = missing.headers.get("content-type") || "";
  const missingBody = await missing.text();
  const missingLooksLikeSpaShell =
    missingBody.toLowerCase().includes("<!doctype html>") &&
    (missingBody.includes("root") || missingBody.includes("GoldMeta"));
  // Nearest public/<assetRoot>/404.html must yield a real 404 — never index.html.
  if (missing.status === 200 && missingLooksLikeSpaShell) {
    fail(
      `Missing /${assetRoot}/* returned SPA index.html with HTTP 200 ` +
        `(status=${missing.status} type=${missingType}). ` +
        "Hashed assets must 404 via nearest 404.html — not SPA fallback."
    );
  } else if (missing.status !== 404) {
    fail(
      `Missing /${assetRoot}/* expected HTTP 404, got ${missing.status} type=${missingType}`
    );
  } else if (missingLooksLikeSpaShell) {
    fail(`Missing /${assetRoot}/* 404 body looks like SPA shell (wrong 404.html)`);
  } else {
    console.log(`missing asset OK: status=${missing.status} type=${missingType}`);
  }

  // SPA deep links must still resolve to the app shell.
  for (const route of ["/intelligence", "/autotrade", "/learn"]) {
    const routeRes = await fetch(`${base}${route}?t=${Date.now()}`, {
      headers: { "Cache-Control": "no-cache" }
    });
    const routeType = routeRes.headers.get("content-type") || "";
    const routeBody = await routeRes.text();
    if (
      routeRes.status !== 200 ||
      !routeType.includes("text/html") ||
      !routeBody.toLowerCase().includes("<!doctype html>")
    ) {
      fail(`SPA route ${route} shell: ${routeRes.status} ${routeType}`);
    } else {
      console.log(`SPA route OK: ${route}`);
    }
  }

  if (!process.exitCode) console.log("post-deploy checks passed");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
