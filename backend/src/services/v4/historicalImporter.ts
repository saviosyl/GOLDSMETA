/**
 * Idempotent XAUUSD historical bar importer for V4 research.
 * Does not fabricate performance evidence. LIVE shadow collection does not depend on this.
 */

import { createHash } from "crypto";

export type HistoricalTimeframe = "1" | "5" | "15" | "60";

export interface HistoricalBarRecord {
  symbol: "XAUUSD";
  timeframe: HistoricalTimeframe;
  timestamp: string; // ISO-8601 UTC
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  tickVolume: number | null;
  timezone: "UTC";
  provider: string;
}

export interface HistoricalImportMeta {
  symbol: "XAUUSD";
  timezone: "UTC";
  provider: string;
  sourceFile?: string;
  importedAt: string;
}

export interface HistoricalValidationIssue {
  code:
    | "MISSING_FIELD"
    | "BAD_OHLC"
    | "DUPLICATE_TIMESTAMP"
    | "OUT_OF_ORDER"
    | "GAP"
    | "PRICE_JUMP"
    | "BAD_TIMEZONE"
    | "BAD_SYMBOL";
  message: string;
  index?: number;
  timestamp?: string;
}

export interface HistoricalImportResult {
  accepted: HistoricalBarRecord[];
  rejected: Array<{ index: number; issues: HistoricalValidationIssue[] }>;
  issues: HistoricalValidationIssue[];
  duplicateCount: number;
  gapCount: number;
  idempotencyKey: string;
  meta: HistoricalImportMeta;
}

const REQUIRED_FIELDS = [
  "symbol",
  "timeframe",
  "timestamp",
  "open",
  "high",
  "low",
  "close",
  "provider"
] as const;

function isNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return fallback;
  return fallback;
}

function barKey(b: Pick<HistoricalBarRecord, "symbol" | "timeframe" | "timestamp">): string {
  return `${b.symbol}|${b.timeframe}|${b.timestamp}`;
}

/** Expected CSV header (comma-separated). */
export const HISTORICAL_CSV_HEADER =
  "symbol,timeframe,timestamp,open,high,low,close,volume,tickVolume,timezone,provider";

/**
 * Parse a JSON array or NDJSON string into bar objects.
 * Accepts either `{ meta, bars: [...] }` or a bare array.
 */
export function parseHistoricalJson(raw: string): {
  bars: Record<string, unknown>[];
  metaPartial: Partial<HistoricalImportMeta>;
} {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    return { bars: JSON.parse(trimmed) as Record<string, unknown>[], metaPartial: {} };
  }
  if (trimmed.startsWith("{")) {
    const obj = JSON.parse(trimmed) as {
      meta?: Partial<HistoricalImportMeta>;
      bars?: Record<string, unknown>[];
    };
    if (Array.isArray(obj.bars)) {
      return { bars: obj.bars, metaPartial: obj.meta ?? {} };
    }
  }
  // NDJSON
  const bars = trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  return { bars, metaPartial: {} };
}

/** Parse CSV with HISTORICAL_CSV_HEADER. */
export function parseHistoricalCsv(raw: string): Record<string, unknown>[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headerLine = lines[0];
  if (!headerLine) return [];
  const header = headerLine.split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    const row: Record<string, unknown> = {};
    header.forEach((h, i) => {
      const v = (cols[i] ?? "").trim();
      if (["open", "high", "low", "close", "volume", "tickVolume"].includes(h)) {
        row[h] = v === "" || v.toLowerCase() === "null" ? null : Number(v);
      } else {
        row[h] = v;
      }
    });
    return row;
  });
}

export function validateAndImportHistoricalBars(
  rows: Record<string, unknown>[],
  options: {
    provider?: string;
    sourceFile?: string;
    maxGapBars?: number;
    maxPriceJumpPct?: number;
  } = {}
): HistoricalImportResult {
  const maxGapBars = options.maxGapBars ?? 3;
  const maxPriceJumpPct = options.maxPriceJumpPct ?? 0.03;
  const issues: HistoricalValidationIssue[] = [];
  const rejected: HistoricalImportResult["rejected"] = [];
  const seen = new Set<string>();
  const accepted: HistoricalBarRecord[] = [];
  let duplicateCount = 0;
  let gapCount = 0;

  const timeframeMs: Record<string, number> = {
    "1": 60_000,
    "5": 5 * 60_000,
    "15": 15 * 60_000,
    "60": 60 * 60_000
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const rowIssues: HistoricalValidationIssue[] = [];

    for (const f of REQUIRED_FIELDS) {
      if (row[f] === undefined || row[f] === null || row[f] === "") {
        rowIssues.push({
          code: "MISSING_FIELD",
          message: `Missing ${f}`,
          index: i
        });
      }
    }

    const symbol = asString(row.symbol);
    if (symbol && symbol !== "XAUUSD") {
      rowIssues.push({ code: "BAD_SYMBOL", message: `Expected XAUUSD, got ${symbol}`, index: i });
    }

    const timezone = asString(row.timezone, "UTC");
    if (timezone !== "UTC") {
      rowIssues.push({
        code: "BAD_TIMEZONE",
        message: `Timezone must be UTC (got ${timezone})`,
        index: i
      });
    }

    const open = row.open;
    const high = row.high;
    const low = row.low;
    const close = row.close;
    if (![open, high, low, close].every(isNumber)) {
      rowIssues.push({ code: "BAD_OHLC", message: "OHLC must be finite numbers", index: i });
    } else if (
      (high as number) < Math.max(open as number, close as number) ||
      (low as number) > Math.min(open as number, close as number) ||
      (high as number) < (low as number)
    ) {
      rowIssues.push({ code: "BAD_OHLC", message: "Inconsistent OHLC", index: i });
    }

    const ts = asString(row.timestamp);
    const parsed = Date.parse(ts);
    if (!Number.isFinite(parsed)) {
      rowIssues.push({
        code: "MISSING_FIELD",
        message: "Invalid timestamp",
        index: i,
        timestamp: ts
      });
    }

    const timeframe = asString(row.timeframe) as HistoricalTimeframe;
    if (!["1", "5", "15", "60"].includes(timeframe)) {
      rowIssues.push({
        code: "MISSING_FIELD",
        message: `Unsupported timeframe ${timeframe}`,
        index: i
      });
    }

    if (rowIssues.length) {
      rejected.push({ index: i, issues: rowIssues });
      issues.push(...rowIssues);
      continue;
    }

    const record: HistoricalBarRecord = {
      symbol: "XAUUSD",
      timeframe,
      timestamp: new Date(parsed).toISOString(),
      open: open as number,
      high: high as number,
      low: low as number,
      close: close as number,
      volume: isNumber(row.volume) ? row.volume : null,
      tickVolume: isNumber(row.tickVolume) ? row.tickVolume : null,
      timezone: "UTC",
      provider: asString(row.provider ?? options.provider, "unknown")
    };

    const key = barKey(record);
    if (seen.has(key)) {
      duplicateCount += 1;
      issues.push({
        code: "DUPLICATE_TIMESTAMP",
        message: `Duplicate ${key}`,
        index: i,
        timestamp: record.timestamp
      });
      continue; // idempotent skip
    }
    seen.add(key);

    const prev = accepted[accepted.length - 1];
    if (prev && prev.timeframe === record.timeframe) {
      const prevTs = Date.parse(prev.timestamp);
      const curTs = Date.parse(record.timestamp);
      if (curTs < prevTs) {
        issues.push({
          code: "OUT_OF_ORDER",
          message: "Timestamp out of order",
          index: i,
          timestamp: record.timestamp
        });
        rejected.push({
          index: i,
          issues: [{ code: "OUT_OF_ORDER", message: "Timestamp out of order", index: i }]
        });
        continue;
      }
      const expected = timeframeMs[record.timeframe] ?? 0;
      if (expected > 0 && curTs - prevTs > expected * maxGapBars) {
        gapCount += 1;
        issues.push({
          code: "GAP",
          message: `Gap of ${curTs - prevTs}ms exceeds ${maxGapBars} bars`,
          index: i,
          timestamp: record.timestamp
        });
      }
      const jump = Math.abs(record.open - prev.close) / Math.max(prev.close, 1e-9);
      if (jump > maxPriceJumpPct) {
        issues.push({
          code: "PRICE_JUMP",
          message: `Price continuity jump ${(jump * 100).toFixed(2)}%`,
          index: i,
          timestamp: record.timestamp
        });
      }
    }

    accepted.push(record);
  }

  const hash = createHash("sha256")
    .update(accepted.map((b) => barKey(b)).join("\n"))
    .digest("hex")
    .slice(0, 24);

  return {
    accepted,
    rejected,
    issues,
    duplicateCount,
    gapCount,
    idempotencyKey: hash,
    meta: {
      symbol: "XAUUSD",
      timezone: "UTC",
      provider: asString(options.provider ?? accepted[0]?.provider, "unknown"),
      sourceFile: options.sourceFile,
      importedAt: new Date().toISOString()
    }
  };
}
