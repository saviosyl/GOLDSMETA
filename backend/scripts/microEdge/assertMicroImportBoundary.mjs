#!/usr/bin/env node
/**
 * Fail if backend/src/services/microEdge/** imports Core AutoTrade / cTrader.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const microRoot = join(root, "src/services/microEdge");
const manifest = JSON.parse(
  readFileSync(join(__dirname, "protectedCorePaths.json"), "utf8")
);

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) acc.push(p);
  }
  return acc;
}

const files = walk(microRoot);
if (!files.length) {
  console.error("FAIL: microEdge source tree missing:", microRoot);
  process.exit(1);
}

const importRe =
  /(?:from\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\))/g;
const violations = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  let m;
  while ((m = importRe.exec(text))) {
    const spec = m[1] || m[2] || m[3] || "";
    for (const bad of manifest.forbiddenMicroImports) {
      if (spec.includes(bad)) {
        violations.push({
          file: relative(root, file),
          import: spec,
          rule: bad
        });
      }
    }
  }
}

if (violations.length) {
  console.error("FAIL: Micro Edge import boundary violated");
  for (const v of violations) {
    console.error(`  ${v.file}: import "${v.import}" matches "${v.rule}"`);
  }
  process.exit(1);
}

console.log("PASS: Micro Edge import boundary clean (", files.length, "files)");
