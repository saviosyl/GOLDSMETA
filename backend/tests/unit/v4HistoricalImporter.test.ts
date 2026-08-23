import { describe, expect, it } from "vitest";
import {
  HISTORICAL_CSV_HEADER,
  parseHistoricalCsv,
  validateAndImportHistoricalBars
} from "../../src/services/v4/historicalImporter";

describe("V4 historical importer", () => {
  it("imports valid CSV idempotently and flags duplicates", () => {
    const csv = `${HISTORICAL_CSV_HEADER}
XAUUSD,15,2025-01-01T10:00:00.000Z,2650,2651,2649,2650.5,100,100,UTC,test
XAUUSD,15,2025-01-01T10:15:00.000Z,2650.5,2652,2650,2651,110,110,UTC,test
XAUUSD,15,2025-01-01T10:15:00.000Z,2650.5,2652,2650,2651,110,110,UTC,test`;
    const rows = parseHistoricalCsv(csv);
    const first = validateAndImportHistoricalBars(rows, { provider: "test" });
    expect(first.accepted).toHaveLength(2);
    expect(first.duplicateCount).toBe(1);
    const second = validateAndImportHistoricalBars(rows, { provider: "test" });
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it("rejects bad OHLC and non-UTC timezone", () => {
    const rows = [
      {
        symbol: "XAUUSD",
        timeframe: "15",
        timestamp: "2025-01-01T10:00:00.000Z",
        open: 10,
        high: 9,
        low: 8,
        close: 9.5,
        volume: 1,
        tickVolume: 1,
        timezone: "UTC",
        provider: "test"
      },
      {
        symbol: "XAUUSD",
        timeframe: "15",
        timestamp: "2025-01-01T10:15:00.000Z",
        open: 10,
        high: 11,
        low: 9,
        close: 10.5,
        volume: 1,
        tickVolume: 1,
        timezone: "Europe/London",
        provider: "test"
      }
    ];
    const result = validateAndImportHistoricalBars(rows);
    expect(result.accepted).toHaveLength(0);
    expect(result.issues.some((i) => i.code === "BAD_OHLC")).toBe(true);
    expect(result.issues.some((i) => i.code === "BAD_TIMEZONE")).toBe(true);
  });
});
