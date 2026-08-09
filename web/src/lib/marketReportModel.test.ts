import { describe, expect, it } from "vitest";
import { buildPromoSnapshotModel } from "./promoSnapshot";
import { buildMarketReportModel } from "./marketReportModel";
import { buildMarketReportReviewCases } from "../fixtures/marketReportReviewFixtures";

describe("buildMarketReportModel", () => {
  const cases = buildMarketReportReviewCases();

  it("builds WAIT report with readiness, story, scenarios, and no fake plan", () => {
    const wait = cases.find((c) => c.id === "WAIT")!;
    const snap = buildPromoSnapshotModel(wait.input);
    const report = buildMarketReportModel(snap, snap.reportContext);
    expect(report.decision).toBe("WAIT");
    expect(report.scoreTotal).toBe(64);
    expect(report.planReadiness?.length).toBeGreaterThan(0);
    expect(report.planReadinessOverall).toMatch(/NOT READY|READY/);
    expect(report.tradePlan).toBeNull();
    expect(report.storyCards).toHaveLength(4);
    expect(report.storyCards.every((c) => c.detail.length > 0)).toBe(true);
    expect(report.decisionSubtext).toBe("No confirmed entry yet.");
    expect(report.planReadiness?.some((r) => r.label === "Market Structure")).toBe(true);
    expect(report.planReadiness?.some((r) => r.label === "Trade Confirmation")).toBe(true);
    expect(report.whyItems.some((i) => /structure confirmation missing/i.test(i.text))).toBe(
      false
    );
    expect(
      report.whyItems.some((i) => /trade confirmation|5m|still missing|still waiting/i.test(i.text))
    ).toBe(true);
    expect(report.scenarios.length).toBeGreaterThanOrEqual(1);
    expect(report.structureLevels.some((l) => l.kind === "current")).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/gm_/i);
  });

  it("builds BUY report with trade plan and no readiness panel data required", () => {
    const buy = cases.find((c) => c.id === "BUY")!;
    const snap = buildPromoSnapshotModel(buy.input);
    const report = buildMarketReportModel(snap, snap.reportContext);
    expect(report.decision).toBe("BUY");
    expect(report.decisionSubtext).toBe("Validated BUY plan active.");
    expect(report.tradePlan).not.toBeNull();
    expect(report.tradePlan?.entry).toBeTruthy();
    expect(report.planReadiness).toBeNull();
    expect(report.candles?.length).toBeGreaterThanOrEqual(8);
    expect(report.candles?.every((c) => c.time != null)).toBe(true);
    expect(report.timeframes?.length).toBeGreaterThan(0);
  });

  it("builds SELL report with trade plan", () => {
    const sell = cases.find((c) => c.id === "SELL")!;
    const snap = buildPromoSnapshotModel(sell.input);
    const report = buildMarketReportModel(snap, snap.reportContext);
    expect(report.decision).toBe("SELL");
    expect(report.decisionSubtext).toBe("Validated SELL plan active.");
    expect(report.tradePlan?.direction.toUpperCase()).toContain("SELL");
    expect(report.biasPosition).toBeLessThan(0.5);
  });

  it("hides candles when fewer than 8 bars are provided", () => {
    const wait = cases.find((c) => c.id === "WAIT")!;
    const snap = buildPromoSnapshotModel({
      ...wait.input,
      reportContext: { ...wait.input.reportContext!, candles: [{ open: 1, high: 2, low: 0.5, close: 1.5 }] }
    });
    const report = buildMarketReportModel(snap, snap.reportContext);
    expect(report.candles).toBeNull();
  });
});
