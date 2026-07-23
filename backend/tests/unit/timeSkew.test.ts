import { describe, expect, it } from "vitest";
import { isSentAtAcceptable, isWithinSkew } from "../../src/utils/time";

describe("isSentAtAcceptable", () => {
  const now = Date.parse("2026-07-23T05:00:00.000Z");
  const opts = { maxPastMs: 30 * 60 * 1000, maxFutureMs: 2 * 60 * 1000 };

  it("accepts sentAt near server receipt", () => {
    expect(isSentAtAcceptable("2026-07-23T04:59:50.000Z", opts, now)).toBe(true);
  });

  it("accepts sentAt within the past window (delayed TV delivery)", () => {
    // 26 minutes old — previously rejected by 5m absolute skew
    expect(isSentAtAcceptable("2026-07-23T04:34:00.000Z", opts, now)).toBe(true);
  });

  it("rejects genuinely stale sentAt beyond past window", () => {
    expect(isSentAtAcceptable("2026-07-23T04:00:00.000Z", opts, now)).toBe(false);
  });

  it("rejects future sentAt beyond future tolerance", () => {
    expect(isSentAtAcceptable("2026-07-23T05:05:00.000Z", opts, now)).toBe(false);
  });

  it("accepts small future clock skew", () => {
    expect(isSentAtAcceptable("2026-07-23T05:01:00.000Z", opts, now)).toBe(true);
  });

  it("rejects invalid timestamps", () => {
    expect(isSentAtAcceptable("not-a-date", opts, now)).toBe(false);
  });
});

describe("isWithinSkew (legacy absolute)", () => {
  it("still works for symmetric checks", () => {
    const now = Date.parse("2026-07-23T05:00:00.000Z");
    expect(isWithinSkew("2026-07-23T04:59:00.000Z", 120_000, now)).toBe(true);
    expect(isWithinSkew("2026-07-23T04:50:00.000Z", 120_000, now)).toBe(false);
  });
});
