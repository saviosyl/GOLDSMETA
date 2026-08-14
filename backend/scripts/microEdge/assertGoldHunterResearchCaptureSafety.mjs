#!/usr/bin/env node
/**
 * Static CI gate: GOLD_HUNTER FAST research capture safety.
 *
 * Scans research runtime + research modules for forbidden execution imports
 * and order/trade action tokens. Not comment-bypassable (comments stripped).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

const RESEARCH_DIRS = [
  join(root, "src/services/microEdge/goldHunter/fast/research"),
  join(root, "src/services/microEdge/runtime")
];

const RESEARCH_FILE_FILTER = (rel) =>
  rel.includes("/goldHunter/fast/research/") ||
  rel.endsWith("/runtime/fastResearchCaptureRuntime.ts");

/** Import path / symbol constructions that must not appear. */
const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+["'][^"']*executionAdapter["']/,
  /from\s+["'][^"']*\/engine["']/,
  /from\s+["'][^"']*\/liveBridge["']/,
  /from\s+["'][^"']*services\/autoTrade[^"']*["']/,
  /from\s+["'][^"']*broker\/ctrader[^"']*["']/,
  /from\s+["'][^"']*services\/activeTrade[^"']*["']/,
  /from\s+["'][^"']*services\/decisionEngine[^"']*["']/,
  /import\s*\{[^}]*\bShadowExecutionAdapter\b[^}]*\}/,
  /import\s*\{[^}]*\bForbiddenLiveExecutionAdapter\b[^}]*\}/,
  /import\s*\{[^}]*\bGoldHunterFastEngine\b[^}]*\}/,
  /import\s*\{[^}]*\bGoldHunterFastLiveBridge\b[^}]*\}/,
  /new\s+ShadowExecutionAdapter\b/,
  /new\s+ForbiddenLiveExecutionAdapter\b/,
  /new\s+GoldHunterFastEngine\b/
];

/** Action / order tokens — must not appear in research production sources. */
const FORBIDDEN_TOKENS = [
  "submitOrder",
  "placeOrder",
  "ENTER_BUY",
  "ENTER_SELL",
  "tradeExit"
];

const REQUIRED_PREFIX = "gold-hunter-fast/research-capture";
const FORBIDDEN_PREFIX = "gold-hunter-fast/live-shadow";

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) acc.push(p);
  }
  return acc;
}

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const files = RESEARCH_DIRS.flatMap((d) => walk(d)).filter((f) =>
  RESEARCH_FILE_FILTER(relative(root, f).replace(/\\/g, "/"))
);

if (!files.length) {
  console.error("FAIL: no research capture source files found to scan");
  process.exit(1);
}

const hits = [];
let sawResearchPrefix = false;

for (const file of files) {
  const rel = relative(root, file).replace(/\\/g, "/");
  const text = readFileSync(file, "utf8");
  const code = stripComments(text);

  for (const re of FORBIDDEN_IMPORT_PATTERNS) {
    if (re.test(code)) {
      hits.push({
        file: rel,
        kind: "forbidden_import_or_construction",
        needle: String(re)
      });
    }
  }
  for (const token of FORBIDDEN_TOKENS) {
    if (code.includes(token)) {
      hits.push({ file: rel, kind: "forbidden_token", needle: token });
    }
  }
  if (code.includes(FORBIDDEN_PREFIX)) {
    const lines = code.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes(FORBIDDEN_PREFIX)) continue;
      const window = lines.slice(Math.max(0, i - 2), i + 3).join("\n");
      if (
        /REFUSING|FORBIDDEN|doNotWriteTo|FORBIDDEN_GCS|must not|NEVER|ban/i.test(
          window
        )
      ) {
        continue;
      }
      hits.push({
        file: rel,
        kind: "live_shadow_prefix_use",
        needle: FORBIDDEN_PREFIX
      });
    }
  }
  if (code.includes(REQUIRED_PREFIX)) sawResearchPrefix = true;
}

if (!sawResearchPrefix) {
  hits.push({
    file: "(aggregate)",
    kind: "missing_required_prefix",
    needle: REQUIRED_PREFIX
  });
}

if (hits.length) {
  console.error("FAIL: GOLD_HUNTER FAST research capture safety gate");
  for (const h of hits) {
    console.error(`  ${h.file}: ${h.kind} -> ${h.needle}`);
  }
  process.exit(1);
}

console.log(
  `PASS: research capture safety gate (${files.length} files, prefix=${REQUIRED_PREFIX})`
);
