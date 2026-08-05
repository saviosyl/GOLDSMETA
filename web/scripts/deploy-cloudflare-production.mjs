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
import { existsSync } from "fs";

const run = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
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
  "--branch",
  "cursor/production-connection",
  "--commit-dirty=true"
];
if (commit) {
  deployArgs.push("--commit-hash", commit);
}
deployArgs.push("--commit-message", message);

run("npx", deployArgs);

console.log("== post-deploy check ==");
run("node", ["scripts/post-deploy-check.mjs", "https://goldmeta.metamechsolutions.com"]);
console.log("Production deploy finished.");
