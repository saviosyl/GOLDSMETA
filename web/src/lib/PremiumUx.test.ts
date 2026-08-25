import { describe, expect, it, beforeEach } from "vitest";
import {
  detectBrowserTimezone,
  formatLocalTimestamp,
  loadTimezonePreference,
  resolveDisplayTimezone,
  saveTimezonePreference
} from "../lib/timezone";
import { classifyOverallScore, classifyScoreComponent, sortScoreComponents } from "../lib/scoreStatus";
import { buildMarketLevelLadder, nearestLevels } from "../lib/marketLadder";
import { buildOvernightReview, isInQuietHours, DEFAULT_ALERT_PREFS } from "../lib/overnight";

describe("timezone helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("detects browser timezone", () => {
    expect(detectBrowserTimezone()).toBeTruthy();
  });

  it("shows local time primary and UTC secondary", () => {
    saveTimezonePreference({ mode: "iana", iana: "Europe/Dublin" });
    const formatted = formatLocalTimestamp("2026-07-21T05:15:00.000Z");
    expect(formatted.timeZone).toBe("Europe/Dublin");
    expect(formatted.primary).toMatch(/21 Jul 2026/);
    expect(formatted.secondaryUtc).toMatch(/05:15 UTC/);
    // IST (UTC+1 in July): 06:15 local
    expect(formatted.primary).toMatch(/06:15/);
  });

  it("supports UTC display mode", () => {
    saveTimezonePreference({ mode: "utc" });
    expect(resolveDisplayTimezone(loadTimezonePreference())).toBe("UTC");
    const formatted = formatLocalTimestamp("2026-07-21T05:15:00.000Z");
    expect(formatted.secondaryUtc).toMatch(/05:15 UTC/);
  });
});

describe("score status mapping", () => {
  it("maps strong / partial / weak thresholds", () => {
    expect(classifyScoreComponent(12, 12).status).toBe("strong");
    expect(classifyScoreComponent(5.6, 8).status).toBe("partial");
    expect(classifyScoreComponent(2, 12).status).toBe("weak");
  });

  it("marks not-evaluated zero scores as unavailable not failed", () => {
    const result = classifyScoreComponent(0, 14, "Not evaluated — no validated plan geometry yet.");
    expect(result.status).toBe("unavailable");
    expect(result.label).toBe("Unavailable");
  });

  it("bands overall score", () => {
    expect(classifyOverallScore(30).band).toBe("red");
    expect(classifyOverallScore(61).band).toBe("amber");
    expect(classifyOverallScore(80).band).toBe("light-green");
    expect(classifyOverallScore(90).band).toBe("strong-green");
  });

  it("sorts important components first", () => {
    const sorted = sortScoreComponents([
      { label: "News" },
      { label: "Trend" },
      { label: "Market Structure" },
      { label: "Confirmation" }
    ]);
    expect(sorted.map((c) => c.label).slice(0, 3)).toEqual([
      "Market Structure",
      "Confirmation",
      "Trend"
    ]);
  });
});

describe("market level ladder", () => {
  it("sorts highest price first and marks live price", () => {
    const rows = buildMarketLevelLadder({
      livePrice: 4018.44,
      poc: 4011.98,
      vah: 3999.84,
      val: 3986.11,
      barHigh: 4081.06,
      barLow: 3959.9
    });
    expect(rows[0]?.price).toBeGreaterThanOrEqual(rows[rows.length - 1]?.price ?? 0);
    expect(rows.some((r) => r.kind === "live")).toBe(true);
    expect(rows.find((r) => r.kind === "poc")?.tone).toBe("poc");
  });

  it("does not fabricate missing levels", () => {
    const rows = buildMarketLevelLadder({ livePrice: 2000 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("live");
  });

  it("finds nearest resistance and support", () => {
    const rows = buildMarketLevelLadder({
      livePrice: 100,
      poc: 99,
      vah: 101.5,
      val: 98.5
    });
    const near = nearestLevels(rows);
    expect(near.resistance?.price).toBe(101.5);
    expect(near.support?.price).toBe(99);
  });
});

describe("overnight and quiet hours", () => {
  it("builds overnight review from recent setups", () => {
    const now = new Date("2026-07-22T08:00:00.000Z");
    const review = buildOvernightReview(
      [
        {
          setupId: "a",
          direction: "BUY",
          status: "ACTIVE_SHADOW",
          createdAt: "2026-07-22T02:00:00.000Z",
          levels: { entryPrice: 2380 }
        },
        {
          setupId: "b",
          direction: "SELL",
          status: "REJECTED",
          createdAt: "2026-07-20T02:00:00.000Z"
        }
      ],
      now,
      "UTC"
    );
    expect(review.candidatesCreated).toBe(1);
    expect(review.disclaimer).toMatch(/NOT AN EXECUTED TRADE/i);
    expect(review.disclaimer).not.toMatch(/guaranteed|winning trade|easy profit/i);
  });

  it("detects quiet hours wrapping midnight", () => {
    const prefs = { ...DEFAULT_ALERT_PREFS, quietHoursEnabled: true, quietStart: "22:00", quietEnd: "07:00" };
    // 23:30 UTC
    expect(isInQuietHours(new Date("2026-07-21T23:30:00.000Z"), prefs, "UTC")).toBe(true);
    // 12:00 UTC
    expect(isInQuietHours(new Date("2026-07-21T12:00:00.000Z"), prefs, "UTC")).toBe(false);
  });
});
