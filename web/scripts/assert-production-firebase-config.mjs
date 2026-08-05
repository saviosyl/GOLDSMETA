#!/usr/bin/env node
/**
 * Release gate: refuse production builds/deploys that would serve the
 * "GoldMeta is not configured for this environment" page.
 *
 * Modes:
 *   --env   Require VITE_FIREBASE_* (+ VITE_API_BASE_URL) in the environment
 *           before `vite build` / Pages deploy.
 *   --dist  Scan web/dist assets after build for inlined Firebase web config.
 *   (default runs both when dist/ exists; otherwise --env only)
 *
 * Never prints secret values.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const DIST = new URL("../dist", import.meta.url).pathname;
const args = new Set(process.argv.slice(2));
const wantEnv = args.has("--env") || (!args.has("--dist") && !args.has("--env"));
const wantDist = args.has("--dist") || (!args.has("--dist") && !args.has("--env") && existsSync(DIST));
const strictProduction = args.has("--production") || process.env.GOLD_META_PRODUCTION_GATE === "1";

const REQUIRED_ENV = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_APP_ID",
  "VITE_API_BASE_URL"
];

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
};

const isPresent = (value) => typeof value === "string" && value.trim().length > 0;

const checkEnv = () => {
  console.log("Production Firebase env gate");
  const missing = REQUIRED_ENV.filter((name) => !isPresent(process.env[name]));
  if (missing.length) {
    fail(
      `Missing required build/runtime env: ${missing.join(", ")}. ` +
        `Refusing to build/deploy a bundle that would show "Configuration needed".`
    );
    return;
  }
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID.trim();
  const authDomain = process.env.VITE_FIREBASE_AUTH_DOMAIN.trim();
  if (strictProduction) {
    if (projectId !== "goldmeta-web") {
      fail(`VITE_FIREBASE_PROJECT_ID must be goldmeta-web for production (got length=${projectId.length})`);
    }
    if (authDomain !== "goldmeta-web.firebaseapp.com") {
      fail("VITE_FIREBASE_AUTH_DOMAIN must be goldmeta-web.firebaseapp.com for production");
    }
    if (!process.env.VITE_API_BASE_URL.includes("goldmeta-web")) {
      fail("VITE_API_BASE_URL must target the goldmeta-web Functions API for production");
    }
  }
  if (!process.exitCode) {
    console.log(
      `PASS: required VITE_* present (projectId length=${projectId.length}, authDomain host ok=${authDomain.includes("firebaseapp.com")}).`
    );
  }
};

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|css|html)$/i.test(name)) out.push(p);
  }
  return out;
}

const checkDist = () => {
  console.log("Production Firebase bundle gate");
  if (!existsSync(DIST)) {
    fail("dist/ missing — run npm run build first");
    return;
  }
  const files = walk(DIST);
  const jsFiles = files.filter((f) => f.endsWith(".js"));
  let combined = "";
  for (const file of jsFiles) {
    combined += readFileSync(file, "utf8");
  }
  // Vite minifies to apiKey:`...`,authDomain:`....firebaseapp.com`,projectId:`...`
  const configObject = combined.match(
    /apiKey:\s*[`"']([^`"']+)[`"']\s*,\s*authDomain:\s*[`"']([^`"']+\.firebaseapp\.com)[`"']\s*,\s*projectId:\s*[`"']([^`"']+)[`"']/
  );
  const hasConfigObject = Boolean(configObject);
  const apiKeyValue = configObject?.[1] ?? "";
  const authDomainValue = configObject?.[2] ?? "";
  const projectIdValue = configObject?.[3] ?? "";
  const hasApiKey =
    hasConfigObject && apiKeyValue.trim().length > 0 && apiKeyValue !== "undefined";
  const hasAuthDomain = hasConfigObject && authDomainValue.includes(".firebaseapp.com");
  const hasProjectId = hasConfigObject && projectIdValue.trim().length > 0;
  const hasGoldmetaProject =
    projectIdValue === "goldmeta-web" || authDomainValue === "goldmeta-web.firebaseapp.com";

  if (!hasApiKey || !hasAuthDomain || !hasProjectId) {
    fail(
      "Built assets lack inlined Firebase web config (apiKey/authDomain/projectId). " +
        'This bundle would render "GoldMeta is not configured for this environment."'
    );
    console.error(
      `  scanned js files: ${jsFiles.length}; apiKey=${hasApiKey}; authDomain=${hasAuthDomain}; projectId=${hasProjectId}`
    );
    for (const f of jsFiles.slice(0, 5)) {
      console.error(`  sample: ${relative(DIST, f)}`);
    }
    return;
  }
  if (strictProduction && !hasGoldmetaProject) {
    fail("Production bundle must target Firebase project goldmeta-web");
    return;
  }
  console.log(
    `PASS: Firebase web config present in dist (js files=${jsFiles.length}, projectIdLength=${projectIdValue.length}, goldmeta-web=${hasGoldmetaProject}).`
  );
};

if (wantEnv) checkEnv();
if (wantDist) checkDist();

if (process.exitCode) {
  process.exit(process.exitCode);
}
