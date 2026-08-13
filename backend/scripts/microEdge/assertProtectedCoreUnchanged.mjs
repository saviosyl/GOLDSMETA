#!/usr/bin/env node
/**
 * Fail if Micro Edge branch changes protected Core paths vs MICRO_BASE_SHA.
 * Usage: MICRO_BASE_SHA=<sha> node scripts/microEdge/assertProtectedCoreUnchanged.mjs
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(__dirname, "protectedCorePaths.json"), "utf8")
);

function resolveBaseSha() {
  const fromEnv =
    (process.env.MICRO_BASE_SHA || "").trim() ||
    (process.env.GITHUB_BASE_SHA || "").trim();
  if (fromEnv) return fromEnv;
  try {
    return readFileSync(join(__dirname, "MICRO_BASE_SHA.txt"), "utf8")
      .trim()
      .split("\n")[0]
      .trim();
  } catch {
    return "";
  }
}

const base = resolveBaseSha();

if (!base) {
  console.error(
    "FAIL: MICRO_BASE_SHA (or GITHUB_BASE_SHA / MICRO_BASE_SHA.txt) is required for Core protection guard."
  );
  process.exit(1);
}

function changedFiles(baseSha) {
  const out = execSync(`git diff --name-only ${baseSha}...HEAD`, {
    encoding: "utf8",
    cwd: join(__dirname, "../../..")
  });
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function matchesGlob(file, glob) {
  // Simple ** support for our protected paths.
  if (glob.endsWith("/**")) {
    const prefix = glob.slice(0, -3);
    return file === prefix || file.startsWith(prefix + "/");
  }
  return file === glob;
}

const files = changedFiles(base);
const hits = files.filter((f) =>
  manifest.protectedGlobs.some((g) => matchesGlob(f, g))
);

if (hits.length) {
  console.error("FAIL: Protected Core paths changed vs", base);
  for (const h of hits) console.error("  -", h);
  process.exit(1);
}

console.log("PASS: protected Core paths unchanged vs", base);
console.log("Changed files scanned:", files.length);
