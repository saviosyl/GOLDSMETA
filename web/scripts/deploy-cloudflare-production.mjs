#!/usr/bin/env node
/**
 * Safe production deploy to Cloudflare Pages project `goldmeta-web`.
 * Runs release gates before upload. Never commits or logs secret values.
 *
 * Prerequisites (env):
 *   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 *   VITE_FIREBASE_*, VITE_API_BASE_URL (baked at build time)
 *
 * Usage (from web/):
 *   node scripts/deploy-cloudflare-production.mjs
 */
import { spawnSync } from "child_process";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

const run = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
  return res;
};

const runCapture = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (res.status !== 0) {
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    process.exit(res.status ?? 1);
  }
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  return res.stdout || "";
};

process.env.GOLD_META_PRODUCTION_GATE = "1";

console.log("== gate: production env ==");
run("node", ["scripts/assert-production-firebase-config.mjs", "--env", "--production"]);

console.log("== build ==");
run("npm", ["run", "build"], { env: process.env });

console.log("== gate: production bundle ==");
run("node", ["scripts/assert-production-firebase-config.mjs", "--dist", "--production"]);
run("npm", ["run", "test:production-bundle"]);

if (!existsSync("dist/index.html")) {
  console.error("FAIL: dist/index.html missing after build");
  process.exit(1);
}

const commit = (process.env.DEPLOY_COMMIT_SHA || "").trim() || undefined;
const message =
  (process.env.DEPLOY_COMMIT_MESSAGE || "").trim() ||
  "production deploy (gated Firebase config)";

console.log("== cloudflare pages deploy ==");
const deployArgs = [
  "wrangler",
  "pages",
  "deploy",
  "dist",
  "--project-name",
  "goldmeta-web",
  // Project production_branch is `cursor/production-connection` (custom domain alias).
  // Deploying to `--branch production` only creates a Preview deployment.
  "--branch",
  "cursor/production-connection",
  "--commit-dirty=true"
];
if (commit) {
  deployArgs.push("--commit-hash", commit);
}
deployArgs.push("--commit-message", message);

const deployOut = runCapture("npx", deployArgs);
const deployUrlMatch = deployOut.match(/https:\/\/[a-z0-9]+\.goldmeta-web\.pages\.dev/i);
const deployUrl = deployUrlMatch?.[0] ?? null;

if (deployUrl) {
  console.log(`== warm deploy assets at ${deployUrl} ==`);
  const html = readFileSync("dist/index.html", "utf8");
  const assetDirs = ["gmv7", "gm", "assets"].filter((d) => existsSync(join("dist", d)));
  const files = assetDirs.flatMap((d) =>
    readdirSync(join("dist", d))
      .filter((f) => /\.(js|css)$/i.test(f))
      .map((f) => `${d}/${f}`)
  );
  const refs = Array.from(
    html.matchAll(/(?:gmv7|gm|assets)\/[A-Za-z0-9._-]+\.(?:js|css)/g)
  ).map((m) => m[0]);
  const targets = Array.from(new Set([...refs, ...files, "sw.js", "index.html"]));
  let failures = 0;
  for (const path of targets) {
    try {
      const res = spawnSync(
        "curl",
        ["-sS", "-o", "/dev/null", "-w", "%{http_code} %{content_type}", `${deployUrl}/${path}`],
        { encoding: "utf8" }
      );
      const line = (res.stdout || "").trim();
      console.log(`warm ${path}: ${line}`);
      if (!line.startsWith("200") && path !== "index.html") failures += 1;
    } catch {
      failures += 1;
    }
  }
  if (failures > 0) {
    console.error(`FAIL: ${failures} deploy-alias asset(s) not warm/200 before custom-domain check`);
    process.exit(1);
  }
}

console.log("== wait for custom domain to serve this deployment ==");
// CRITICAL: do not probe new hashed /gmv7/* URLs on the custom domain until its
// index.html references them. Probing early SPA-falls-back to index.html with
// immutable Cache-Control and poisons the CDN for up to a year.
const expectedJs = (() => {
  const html = readFileSync("dist/index.html", "utf8");
  return html.match(/\/((?:assets|gm|gmv7)\/index-[A-Za-z0-9_-]+\.js)/)?.[1] ?? null;
})();
if (!expectedJs) {
  console.error("FAIL: dist/index.html missing hashed JS reference");
  process.exit(1);
}
const customOrigin = "https://goldmeta.metamechsolutions.com";
let switched = false;
for (let attempt = 1; attempt <= 36; attempt += 1) {
  try {
    const res = spawnSync(
      "curl",
      [
        "-sS",
        "-H",
        "Cache-Control: no-cache",
        "-H",
        "Pragma: no-cache",
        `${customOrigin}/?t=${Date.now()}-${attempt}`
      ],
      { encoding: "utf8" }
    );
    const body = res.stdout || "";
    if (body.includes(expectedJs)) {
      console.log(`custom domain serving ${expectedJs} (attempt ${attempt})`);
      switched = true;
      break;
    }
    const seen = body.match(/\/((?:assets|gm|gmv7)\/index-[A-Za-z0-9_-]+\.js)/)?.[1] ?? "unknown";
    console.log(`waiting for custom domain… attempt ${attempt}/36 (saw ${seen})`);
  } catch {
    console.log(`waiting for custom domain… attempt ${attempt}/36 (fetch error)`);
  }
  spawnSync("sleep", ["5"], { stdio: "inherit" });
}
if (!switched) {
  console.error(
    `FAIL: custom domain did not serve ${expectedJs} within timeout. ` +
      "Not running asset probes (would risk CDN HTML poison)."
  );
  process.exit(1);
}

console.log("== post-deploy check ==");
run("node", ["scripts/post-deploy-check.mjs", customOrigin, expectedJs]);
console.log("Production deploy finished.");
