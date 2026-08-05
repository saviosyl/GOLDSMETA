import { describe, expect, it } from "vitest";
import {
  buildInvalidationSentence,
  extractPriceFromText,
  formatXauPrice,
  isNonActionableQuality,
  resolveAuthoritativeConfirmation,
  validateTradePlanGeometry
} from "../../src/services/decision/tradePlanGeometry";

describe("validateTradePlanGeometry", () => {
  it("accepts valid BUY ordering", () => {
    const r = validateTradePlanGeometry({
      direction: "BUY",
      entryPrice: 4040,
      stop: 4035,
      tp1: 4045,
      tp2: 4050,
      marketStructureMode: "COMPLETE",
      quickTargetOk: true
    });
    expect(r.actionable).toBe(true);
    expect(r.reasonCodes).toEqual([]);
  });

  it("accepts valid SELL ordering", () => {
    const r = validateTradePlanGeometry({
      direction: "SELL",
      entryPrice: 4040,
      stop: 4045,
      tp1: 4035,
      tp2: 4030,
      marketStructureMode: "COMPLETE",
      quickTargetOk: true
    });
    expect(r.actionable).toBe(true);
  });

  it("rejects BUY entry equals stop", () => {
    const r = validateTradePlanGeometry({
      direction: "BUY",
      entryPrice: 4040,
      stop: 4040,
      tp1: 4045,
      marketStructureMode: "COMPLETE",
      quickTargetOk: true
    });
    expect(r.actionable).toBe(false);
    expect(r.reasonCodes).toContain("ENTRY_EQUALS_STOP");
    expect(r.reasonCodes).toContain("ZERO_RISK");
  });

  it("rejects SELL entry equals stop", () => {
    const r = validateTradePlanGeometry({
      direction: "SELL",
      entryPrice: 4040,
      stop: 4040.02,
      tp1: 4035,
      marketStructureMode: "COMPLETE",
      quickTargetOk: true
    });
    expect(r.actionable).toBe(false);
    expect(r.reasonCodes).toContain("ENTRY_EQUALS_STOP");
  });

  it("rejects BUY stop above entry", () => {
    const r = validateTradePlanGeometry({
      direction: "BUY",
      entryPrice: 4040,
      stop: 4045,
      tp1: 4050,
      marketStructureMode: "COMPLETE",
      quickTargetOk: true
    });
    expect(r.actionable).toBe(false);
    expect(r.reasonCodes).toContain("STOP_WRONG_SIDE");
  });

  it("rejects SELL stop below entry", () => {
    const r = validateTradePlanGeometry({
      direction: "SELL",
      entryPrice: 4040,
      stop: 4035,
      tp1: 4030,
      marketStructureMode: "COMPLETE",
      quickTargetOk: true
    });
    expect(r.actionable).toBe(false);
    expect(r.reasonCodes).toContain("STOP_WRONG_SIDE");
  });

  it("rejects TP1 on wrong side", () => {
    const buy = validateTradePlanGeometry({
      direction: "BUY",
      entryPrice: 4040,
      stop: 4035,
      tp1: 4030,
      marketStructureMode: "COMPLETE",
      quickTargetOk: true
    });
    expect(buy.reasonCodes).toContain("TP1_WRONG_SIDE");
    const sell = validateTradePlanGeometry({
      direction: "SELL",
      entryPrice: 4040,
      stop: 4045,
      tp1: 4050,
      marketStructureMode: "COMPLETE",
      quickTargetOk: true
    });
    expect(sell.reasonCodes).toContain("TP1_WRONG_SIDE");
  });

  it("rejects missing stop", () => {
    const r = validateTradePlanGeometry({
      direction: "BUY",
      entryPrice: 4040,
      stop: null,
      tp1: 4045,
      marketStructureMode: "COMPLETE",
      quickTargetOk: true
    });
    expect(r.reasonCodes).toContain("MISSING_REQUIRED_LEVEL");
    expect(r.actionable).toBe(false);
  });

  it("rejects price already beyond TP1 before confirmation", () => {
    const r = validateTradePlanGeometry({
      direction: "BUY",
      entryPrice: 4040,
      stop: 4035,
      tp1: 4045,
      currentPrice: 4046,
      confirmed: false,
      marketStructureMode: "COMPLETE",
      quickTargetOk: true
    });
    expect(r.reasonCodes).toContain("PRICE_ALREADY_AT_TARGET");
  });

  it("allows price at TP1 after confirmation", () => {
    const r = validateTradePlanGeometry({
      direction: "BUY",
      entryPrice: 4040,
      stop: 4035,
      tp1: 4045,
      currentPrice: 4046,
      confirmed: true,
      marketStructureMode: "COMPLETE",
      quickTargetOk: true
    });
    expect(r.reasonCodes).not.toContain("PRICE_ALREADY_AT_TARGET");
    expect(r.actionable).toBe(true);
  });

  it("rejects malformed displayed invalidation vs numeric stop", () => {
    const r = validateTradePlanGeometry({
      direction: "BUY",
      entryPrice: 4040,
      stop: 4035.1,
      tp1: 4045,
      invalidationText: "Break below 407.816 ends the plan",
      marketStructureMode: "COMPLETE",
      quickTargetOk: true
    });
    expect(r.reasonCodes).toContain("INVALIDATION_STOP_MISMATCH");
  });

  it("treats single-price entry as zoneLow=zoneHigh=entry", () => {
    const r = validateTradePlanGeometry({
      direction: "BUY",
      entryPrice: 4040,
      stop: 4035,
      tp1: 4045,
      marketStructureMode: "COMPLETE",
      quickTargetOk: true
    });
    expect(r.normalized.entryZoneLow).toBe(4040);
    expect(r.normalized.entryZoneHigh).toBe(4040);
    expect(r.actionable).toBe(true);
  });

  it("accepts valid BUY Entry/Stop/TP1 without TP2", () => {
    const r = validateTradePlanGeometry({
      direction: "BUY",
      entryPrice: 4040,
      stop: 4035,
      tp1: 4048,
      tp2: null,
      marketStructureMode: "COMPLETE",
      quickTargetOk: true
    });
    expect(r.actionable).toBe(true);
    expect(r.hardReasonCodes).toEqual([]);
  });

  it("accepts valid SELL Entry/Stop/TP1 without TP2", () => {
    const r = validateTradePlanGeometry({
      direction: "SELL",
      entryPrice: 4040,
      stop: 4046,
      tp1: 4032,
      tp2: null,
      marketStructureMode: "COMPLETE",
      quickTargetOk: true
    });
    expect(r.actionable).toBe(true);
  });

  it("keeps plan actionable when TP2 missing and optional profile incomplete", () => {
    const r = validateTradePlanGeometry({
      direction: "BUY",
      entryPrice: 4040,
      stop: 4035,
      tp1: 4048,
      marketStructureMode: "LIVE_RANGE_ONLY",
      quickTargetOk: false
    });
    expect(r.actionable).toBe(true);
    expect(r.softReasonCodes).toContain("STRUCTURE_INCOMPLETE");
    expect(r.softReasonCodes).toContain("QUICK_TARGET_FAILED");
    expect(r.hardReasonCodes).not.toContain("STRUCTURE_INCOMPLETE");
  });

  it("keeps plan actionable when quick target fails but engine TP1 is valid", () => {
    const r = validateTradePlanGeometry({
      direction: "SELL",
      entryPrice: 4040,
      stop: 4048,
      tp1: 4030,
      marketStructureMode: "COMPLETE",
      quickTargetOk: false
    });
    expect(r.actionable).toBe(true);
    expect(r.softReasonCodes).toContain("QUICK_TARGET_FAILED");
  });

  it("still blocks when no valid TP1", () => {
    const r = validateTradePlanGeometry({
      direction: "BUY",
      entryPrice: 4040,
      stop: 4035,
      tp1: null,
      marketStructureMode: "COMPLETE",
      quickTargetOk: true
    });
    expect(r.actionable).toBe(false);
    expect(r.hardReasonCodes).toContain("MISSING_REQUIRED_LEVEL");
  });

  it("still blocks mismatch as hard", () => {
    const r = validateTradePlanGeometry({
      direction: "BUY",
      entryPrice: 4040,
      stop: 4035,
      tp1: 4048,
      marketStructureMode: "MISMATCH",
      quickTargetOk: true
    });
    expect(r.actionable).toBe(false);
    expect(r.hardReasonCodes).toContain("STRUCTURE_MISMATCH");
  });
});

describe("resolveAuthoritativeConfirmation", () => {
  it("does not let bearish rejection confirm a BUY plan", () => {
    const r = resolveAuthoritativeConfirmation({
      confirmationState: "REJECTION_CONFIRMED",
      direction: "BUY"
    });
    expect(r.supportsPlan).toBe(false);
    expect(r.state).toBe("CONFIRMATION_FAILED");
  });

  it("lets breakout confirm a BUY plan", () => {
    const r = resolveAuthoritativeConfirmation({
      confirmationState: "BREAKOUT_CONFIRMED",
      direction: "BUY"
    });
    expect(r.supportsPlan).toBe(true);
  });
});

describe("price formatting helpers", () => {
  it("formats 4077.816 as 4,077.82", () => {
    expect(formatXauPrice(4077.816)).toBe("4,077.82");
  });

  it("builds invalidation from exact numeric stop", () => {
    expect(buildInvalidationSentence("BUY", 4035.1)).toContain("4,035.10");
    expect(extractPriceFromText("Break below 4,035.10 ends")).toBe(4035.1);
  });

  it("marks C / STRUCTURE_ONLY as non-actionable quality", () => {
    expect(isNonActionableQuality("C", ["STRUCTURE_ONLY_OR_INCOMPLETE_TRADE_PLAN"])).toBe(true);
    expect(isNonActionableQuality("A", [])).toBe(false);
  });
});
