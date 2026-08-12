import { describe, expect, it } from "vitest";
import {
  describeRuntimeType,
  moneyFromDigitsSafe,
  safeFiniteNumber,
  safeIdString,
  safeInteger,
  safeWireAccountId
} from "../../../../src/services/broker/ctrader/openApiNumeric";
import { parseExpectedMarginEntries } from "../../../../src/services/broker/ctrader/authoritativeMargin";

/** protobufjs / long.js shaped fixture */
function longLike(digits: string, unsigned = false) {
  const bi = BigInt(digits);
  const low = Number(bi & 0xffffffffn);
  const high = Number((bi >> 32n) & 0xffffffffn);
  return {
    low: low | 0,
    high: high | 0,
    unsigned,
    toString() {
      return digits;
    },
    toNumber() {
      return Number(digits);
    }
  };
}

describe("openApiNumeric int64/uint64 hardening", () => {
  it("accepts number / string / bigint / Long-like for money raw", () => {
    expect(safeFiniteNumber(5_000_000)).toBe(5_000_000);
    expect(safeFiniteNumber("5000000")).toBe(5_000_000);
    expect(safeFiniteNumber(5_000_000n)).toBe(5_000_000);
    expect(safeFiniteNumber(longLike("5000000"))).toBe(5_000_000);
  });

  it("moneyDigits validated before money conversion (Long-like)", () => {
    expect(moneyFromDigitsSafe(longLike("5000000"), 2)).toBe(50_000);
    expect(moneyFromDigitsSafe(longLike("250000"), longLike("2"))).toBe(2_500);
    expect(moneyFromDigitsSafe(longLike("5000000"), -1)).toBeNull();
    expect(moneyFromDigitsSafe(longLike("5000000"), "nope")).toBeNull();
  });

  it("safeIdString never rounds unsafe identifiers", () => {
    expect(safeIdString(48014710)).toBe("48014710");
    expect(safeIdString("53870324")).toBe("53870324");
    expect(safeIdString(longLike("53870324"))).toBe("53870324");
    // Beyond MAX_SAFE_INTEGER — keep exact string, refuse wire Number.
    const huge = "9007199254740993"; // MAX_SAFE_INTEGER + 2
    expect(safeIdString(huge)).toBe(huge);
    expect(safeWireAccountId(huge)).toBeNull();
    expect(safeIdString(Number(huge))).toBeNull(); // already rounded — reject
  });

  it("safeInteger for volume / moneyDigits", () => {
    expect(safeInteger(1700)).toBe(1700);
    expect(safeInteger("1700")).toBe(1700);
    expect(safeInteger(longLike("1700"))).toBe(1700);
    expect(safeInteger(17.5)).toBeNull();
    expect(safeInteger(longLike("9007199254740993"))).toBeNull();
  });

  it("ExpectedMargin parse accepts Long-like volume + margins", () => {
    const quotes = parseExpectedMarginEntries({
      moneyDigits: 2,
      margins: [
        {
          volume: longLike("1700"),
          buyMargin: longLike("250000"),
          sellMargin: longLike("260000")
        }
      ]
    });
    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.volume).toBe(1700);
    expect(quotes[0]!.buyMargin).toBe(2_500);
    expect(quotes[0]!.sellMargin).toBe(2_600);
  });

  it("describeRuntimeType classifies Long-like", () => {
    const d = describeRuntimeType(longLike("41"));
    expect(d.kind).toBe("long_like");
    expect(d.preview).toBe("41");
  });

  it("fail closed on invalid shapes", () => {
    expect(safeFiniteNumber({})).toBeNull();
    expect(safeFiniteNumber({ toString: () => "NaN" })).toBeNull();
    expect(safeIdString(null)).toBeNull();
    expect(moneyFromDigitsSafe(100, null)).toBeNull();
  });
});
