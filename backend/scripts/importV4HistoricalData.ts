#!/usr/bin/env tsx
/**
 * CLI: import XAUUSD historical bars for V4 research.
 *
 * Usage:
 *   npx tsx scripts/importV4HistoricalData.ts --file ./data/xauusd_15m.csv
 *   npx tsx scripts/importV4HistoricalData.ts --file ./data/xauusd.json --out ./data/validated.json
 *
 * Does not fabricate results. Does not write to Firestore unless --persist is passed
 * (persist is intentionally not implemented until an authorised archive path is approved).
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import {
  HISTORICAL_CSV_HEADER,
  parseHistoricalCsv,
  parseHistoricalJson,
  validateAndImportHistoricalBars
} from "../src/services/v4/historicalImporter";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0) return process.argv[idx + 1];
  return undefined;
}

const file = arg("--file");
if (!file) {
  console.error(`Missing --file

Expected CSV header:
${HISTORICAL_CSV_HEADER}

Or JSON: { "meta": { "provider": "...", "timezone": "UTC" }, "bars": [ ... ] }

See docs/V4_HISTORICAL_IMPORTER.md`);
  process.exit(1);
}

const abs = resolve(file);
const raw = readFileSync(abs, "utf8");
const rows = abs.endsWith(".csv")
  ? parseHistoricalCsv(raw)
  : parseHistoricalJson(raw).bars;

const result = validateAndImportHistoricalBars(rows, {
  sourceFile: abs,
  provider: arg("--provider")
});

console.log(
  JSON.stringify(
    {
      accepted: result.accepted.length,
      rejected: result.rejected.length,
      duplicateCount: result.duplicateCount,
      gapCount: result.gapCount,
      issueCount: result.issues.length,
      idempotencyKey: result.idempotencyKey,
      meta: result.meta,
      sampleIssues: result.issues.slice(0, 10)
    },
    null,
    2
  )
);

const out = arg("--out");
if (out) {
  const outAbs = resolve(out);
  mkdirSync(dirname(outAbs), { recursive: true });
  writeFileSync(
    outAbs,
    JSON.stringify({ meta: result.meta, bars: result.accepted, issues: result.issues }, null, 2)
  );
  console.error(`Wrote validated bars to ${outAbs}`);
}

if (process.argv.includes("--persist")) {
  console.error(
    "--persist is not enabled: no Firestore archive writer until an authorised data path is approved."
  );
  process.exit(2);
}
