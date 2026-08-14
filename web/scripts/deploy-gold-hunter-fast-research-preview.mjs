#!/usr/bin/env node
/**
 * Isolated GOLD_HUNTER FAST research-monitor preview deploy (Cloudflare Pages).
 * Does NOT deploy production custom domain. noindex/nofollow via env flag.
 * Never logs secret values.
 *
 * Required env:
 *   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 *   VITE_FIREBASE_* (auth shell only — research preview bypasses login)
 *   VITE_API_BASE_URL
 *   VITE_GOLD_HUNTER_FAST_RESEARCH_HEALTH_URL
 */
import { spawnSync } from "child_process";

const run = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.status !== 0) process.exit(res.status ?? 1);
  return res;
};

const runCapture = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (res.status !== 0) {
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    process.exit(res.status ?? 1);
  }
  return res.stdout || "";
};

const healthUrl = (process.env.VITE_GOLD_HUNTER_FAST_RESEARCH_HEALTH_URL || "").trim();
if (!healthUrl) {
  console.error("FAIL: VITE_GOLD_HUNTER_FAST_RESEARCH_HEALTH_URL required");
  process.exit(1);
}

async function resolvePagesProject() {
  const fromEnv = (process.env.CLOUDFLARE_PAGES_PROJECT || "").trim();
  if (fromEnv && fromEnv !== "[REDACTED]") return fromEnv;
  const token = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
  const account = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  if (!token || !account) {
    console.error("FAIL: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID required");
    process.exit(1);
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const body = await res.json();
  if (!body?.success) {
    console.error("FAIL: could not list Cloudflare Pages projects");
    process.exit(1);
  }
  const names = (body.result || []).map((p) => p.name);
  const preferred =
    names.find((n) => /goldmeta/i.test(n)) ||
    names.find((n) => !/^metamech/i.test(n));
  if (!preferred) {
    console.error("FAIL: no GoldMeta Pages project found");
    process.exit(1);
  }
  return preferred;
}

process.env.VITE_GOLD_HUNTER_FAST_RESEARCH_PREVIEW = "true";
// Do not activate the live-shadow preview mode in this build.
process.env.VITE_GOLD_HUNTER_FAST_PREVIEW = "false";

const projectName = await resolvePagesProject();
console.log("== build FAST research monitor preview ==");
run("npm", ["ci"], { env: process.env });
run("npm", ["run", "build"], { env: process.env });

const commit = (process.env.DEPLOY_COMMIT_SHA || "").trim();
const message =
  (process.env.DEPLOY_COMMIT_MESSAGE || "").trim() ||
  "gold-hunter-fast research monitor preview (noindex)";

console.log("== cloudflare pages preview deploy ==");
const deployArgs = [
  "wrangler",
  "pages",
  "deploy",
  "dist",
  "--project-name",
  projectName,
  "--branch",
  "gh-fast-research",
  "--commit-dirty=true",
  "--commit-message",
  message
];
if (commit) deployArgs.push("--commit-hash", commit);

const out = runCapture("npx", deployArgs, { env: process.env });
const match =
  out.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev/i) ||
  out.match(/https:\/\/gh-fast-research\.[a-z0-9-]+\.pages\.dev/i);
console.log("PREVIEW_URL=" + (match?.[0] ?? "(see wrangler output)"));
console.log("Research health host only:", new URL(healthUrl).host);
