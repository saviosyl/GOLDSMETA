#!/usr/bin/env node
/**
 * Static check: production `web/dist` must not contain Issue #50 preview fixtures.
 * Run after `npm run build` (without VITE_ENABLE_UI_REVIEW).
 */
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, relative } from "path";

const DIST = new URL("../dist", import.meta.url).pathname;
const FORBIDDEN = [
  "LABELLED PREVIEW",
  "issue50-below-val",
  "issue50-buy-confirmed",
  "issue50PreviewMatrix",
  "TEST_PREVIEW",
  "getIssue50PreviewCase"
];

const FORBIDDEN_FILENAMES = [/UiReviewApp/i, /issue50PreviewMatrix/i];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|css|html|json|map)$/i.test(name)) out.push(p);
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error("assert-production-bundle-clean: dist/ missing — run npm run build first");
  process.exit(1);
}

const files = walk(DIST);
const hits = [];
for (const file of files) {
  const rel = relative(DIST, file);
  for (const re of FORBIDDEN_FILENAMES) {
    if (re.test(rel)) hits.push({ file: rel, needle: `filename:${re}` });
  }
  const text = readFileSync(file, "utf8");
  for (const needle of FORBIDDEN) {
    if (text.includes(needle)) {
      hits.push({ file: rel, needle });
    }
  }
}

const jsChunks = files
  .filter((f) => f.endsWith(".js") && f.includes(`${DIST}/assets`))
  .map((f) => ({ file: relative(DIST, f), bytes: statSync(f).size }))
  .sort((a, b) => b.bytes - a.bytes);

console.log("Production bundle fixture-leak check");
console.log(`dist files scanned: ${files.length}`);
console.log("Largest JS chunks:");
for (const c of jsChunks.slice(0, 8)) {
  console.log(`  ${c.bytes}\t${c.file}`);
}

if (hits.length) {
  console.error("FAIL: forbidden preview strings found in production assets:");
  for (const h of hits) console.error(`  ${h.file}: ${h.needle}`);
  process.exit(1);
}

console.log("PASS: no Issue #50 preview fixture payload in production assets.");
