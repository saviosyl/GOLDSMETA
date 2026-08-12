#!/usr/bin/env node
/**
 * Fail if Micro Edge source contains broker mutation tokens / interfaces.
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
const hits = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const token of manifest.forbiddenBrokerMutationTokens) {
    if (text.includes(token)) {
      hits.push({ file: relative(root, file), token });
    }
  }
}

if (hits.length) {
  console.error("FAIL: Micro Edge broker mutation ban violated");
  for (const h of hits) console.error(`  ${h.file}: contains ${h.token}`);
  process.exit(1);
}

console.log("PASS: Micro Edge broker mutation ban clean");
