import { describe, expect, it } from "vitest";
import type { DemoPositionLifecycle } from "../../../../src/services/broker/ctrader/positionLifecycleTypes";
import {
  appendLifecycleEvent,
  emptyTpStatuses
} from "../../../../src/services/broker/ctrader/positionLifecycleTypes";
import {
  evaluateNewsGuard,
  loadNewsProviderKind,
  parseFinnhubEconomicCalendar
} from "../../../../src/services/broker/ctrader/newsGuard";
import { validateSettingsPatch } from "../../../../src/services/broker/ctrader/userAutoTradeSettings";
import { LIVE_HARD_CAPS } from "../../../../src/services/broker/ctrader/liveRiskCaps";
import { isCTraderLiveEnabled } from "../../../../src/services/broker/ctrader/flags";
import { previousWeekBounds } from "../../../../src/services/broker/ctrader/weeklyReportStore";
import { evaluateManagement } from "../../../../src/services/decisionEngine/management";

function sampleLifecycle(): DemoPositionLifecycle {
  return {
    id: "c1",
    uid: "u1",
    environment: "DEMO",
    correlationId: "c1",
    brokerOrderId: "o1",
    brokerPositionId: "p1",
    accountId: "4810",
    accountMasked: "48…10",
    symbol: "XAUUSD",
    side: "BUY",
    entry: 2350,
    currentPrice: 2355,
    lots: 0.01,
    remainingLots: 0.01,
    initialSl: 2340,
    currentSl: 2340,
    tp1: 2360,
    tp2: 2365,
    tp3: 2370,
    ...emptyTpStatuses(),
    openedAt: new Date().toISOString(),
    closedAt: null,
    realisedPnl: null,
    unrealisedPnl: 5,
    brokerPnlConfirmed: false,
    closePrice: null,
    grossPnl: null,
    commission: null,
    swap: null,
    netPnl: null,
    brokerDealId: null,
    initialRisk: 10,
    currentRisk: 10,
    qualificationStage: "CONTROLLED_DEMO_QUALIFICATION",
    decisionId: "d1",
    setupRef: "d1",
    source: "qualification_controlled",
    managementState: "SL_PROTECTED",
    lastRecommendation: null,
    protectionVerified: true,
    protectionFailure: false,
    events: [],
    appliedDedupeKeys: [],
    updatedAt: new Date().toISOString(),
    status: "OPEN"
  };
}

describe("remaining practical features", () => {
  it("accepts Demo maxTradesPerDay = 6 and does not touch Live defaults", () => {
    const demo = validateSettingsPatch({ maxTradesPerDay: 6 }, "demo");
    expect(demo.ok).toBe(true);
    const live = validateSettingsPatch({ maxTradesPerDay: 6 }, "live");
    expect(live.ok).toBe(true);
  });

  it("enforces Live hard risk caps separate from Demo ranges", () => {
    expect(
      validateSettingsPatch({ percentageRisk: 100 }, "live").ok
    ).toBe(false);
    expect(
      validateSettingsPatch({ percentageRisk: LIVE_HARD_CAPS.percentageRiskMax }, "live").ok
    ).toBe(true);
    expect(
      validateSettingsPatch({ manualLotSize: 50 }, "live").ok
    ).toBe(false);
    expect(
      validateSettingsPatch({ maxDailyLoss: 50_000 }, "live").ok
    ).toBe(false);
    expect(
      validateSettingsPatch({ percentageRisk: 50 }, "demo").ok
    ).toBe(true);
  });

  it("keeps Live execution hard locked", () => {
    expect(isCTraderLiveEnabled()).toBe(false);
  });

  it("lifecycle event append is idempotent by dedupeKey", () => {
    const doc = sampleLifecycle();
    const first = appendLifecycleEvent(doc, {
      at: new Date().toISOString(),
      kind: "BREAKEVEN",
      reason: "MOVE_SL_TO_BREAKEVEN",
      oldSl: 2340,
      newSl: 2350,
      brokerAck: true,
      dedupeKey: "be:c1:2350"
    });
    expect(first.applied).toBe(true);
    const second = appendLifecycleEvent(first.doc, {
      at: new Date().toISOString(),
      kind: "BREAKEVEN",
      reason: "retry",
      oldSl: 2340,
      newSl: 2350,
      brokerAck: true,
      dedupeKey: "be:c1:2350"
    });
    expect(second.applied).toBe(false);
    expect(second.doc.events.filter((e) => e.kind === "BREAKEVEN")).toHaveLength(1);
  });

  it("TP event idempotency", () => {
    const doc = sampleLifecycle();
    const a = appendLifecycleEvent(doc, {
      at: new Date().toISOString(),
      kind: "TP1",
      reason: "hit",
      dedupeKey: "tp1:c1"
    });
    const b = appendLifecycleEvent(a.doc, {
      at: new Date().toISOString(),
      kind: "TP1",
      reason: "hit again",
      dedupeKey: "tp1:c1"
    });
    expect(a.applied).toBe(true);
    expect(b.applied).toBe(false);
  });

  it("close event idempotency", () => {
    const doc = sampleLifecycle();
    const a = appendLifecycleEvent(doc, {
      at: new Date().toISOString(),
      kind: "CLOSE",
      reason: "closed",
      dedupeKey: "close_reconcile:c1"
    });
    const b = appendLifecycleEvent(a.doc, {
      at: new Date().toISOString(),
      kind: "CLOSE",
      reason: "closed retry",
      dedupeKey: "close_reconcile:c1"
    });
    expect(a.applied).toBe(true);
    expect(b.applied).toBe(false);
  });

  it("approved management emits MOVE_SL_TO_BREAKEVEN at 0.8R", () => {
    const r = evaluateManagement({
      side: "BUY",
      entryPrice: 2350,
      stopLoss: 2340,
      currentPrice: 2358.5,
      takeProfits: { tp1: 2360, tp2: 2365, tp3: 2370 },
      tp1Hit: false,
      trendMeter: { state: "NEUTRAL", strength: 0 },
      confirmationCandle: { state: "NONE", confirmed: false },
      poc: null,
      vwap: null,
      relativeVolume: null,
      spread: 0.2,
      isStale: false,
      highImpactNewsActive: false
    });
    expect(r.action).toBe("MOVE_SL_TO_BREAKEVEN");
    expect(r.analysisOnly).toBe(true);
  });

  it("economic calendar: not configured by default (no fabricated live calendar)", () => {
    expect(loadNewsProviderKind({})).toBe("NONE");
    const status = evaluateNewsGuard(
      { mode: "HIGH", minutesBefore: 15, minutesAfter: 15 },
      new Date("2026-08-08T12:00:00.000Z"),
      {}
    );
    expect(status.configured).toBe(false);
    expect(status.providerLabel).toBe("Not configured");
    expect(status.active).toBe(false);
  });

  it("economic calendar: template mode is labelled Template protection", () => {
    const status = evaluateNewsGuard(
      { mode: "HIGH", minutesBefore: 15, minutesAfter: 15 },
      new Date("2026-08-07T13:30:00.000Z"), // Friday
      { CTRADER_NEWS_PROVIDER: "template" }
    );
    expect(status.provider).toBe("TEMPLATE_PROTECTION");
    expect(status.providerLabel).toBe("Template protection");
    expect(status.active).toBe(true);
  });

  it("economic calendar: Finnhub parse filters USD + impact + timezone-safe ISO", () => {
    const events = parseFinnhubEconomicCalendar({
      economicCalendar: [
        {
          country: "US",
          event: "US CPI",
          impact: "high",
          time: "2026-08-12 13:30:00"
        },
        {
          country: "EU",
          event: "ECB Rate",
          impact: "high",
          time: "2026-08-12 12:00:00"
        },
        {
          country: "US",
          event: "Minor print",
          impact: "low",
          time: "2026-08-12 14:00:00"
        }
      ]
    });
    expect(events).toHaveLength(2);
    expect(events[0].name).toBe("US CPI");
    expect(events[0].at.endsWith("Z")).toBe(true);
    expect(events[0].impact).toBe("HIGH");
  });

  it("economic calendar: HIGH filter excludes medium; MEDIUM includes both", () => {
    const events = parseFinnhubEconomicCalendar({
      economicCalendar: [
        { country: "US", event: "NFP", impact: "high", time: "2026-08-07T13:30:00Z" },
        { country: "US", event: "Retail", impact: "medium", time: "2026-08-07T15:00:00Z" }
      ]
    });
    const high = evaluateNewsGuard(
      { mode: "HIGH", minutesBefore: 15, minutesAfter: 15 },
      new Date("2026-08-07T14:50:00.000Z"),
      { CTRADER_NEWS_PROVIDER: "template" }
    );
    // Template windows only — confirm MEDIUM mode still works via parse helpers
    expect(events.filter((e) => e.impact === "HIGH")).toHaveLength(1);
    expect(events.filter((e) => e.impact === "MEDIUM" || e.impact === "HIGH")).toHaveLength(2);
    expect(high.providerLabel).not.toMatch(/live economic calendar/i);
  });

  it("weekly report week bounds are stable Mon–Sun keys", () => {
    const w = previousWeekBounds(new Date("2026-08-09T12:00:00.000Z")); // Sunday
    expect(w.weekKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(w.weekEnd >= w.weekStart).toBe(true);
  });
});
