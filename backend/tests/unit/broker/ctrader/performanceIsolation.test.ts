import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../src/services/broker/ctrader/autoTradeJournal", () => ({
  listAutoTradeJournal: vi.fn()
}));

import { listAutoTradeJournal } from "../../../../src/services/broker/ctrader/autoTradeJournal";
import { buildPerformanceSummary } from "../../../../src/services/broker/ctrader/performanceService";

const mockedList = vi.mocked(listAutoTradeJournal);

describe("performance isolation", () => {
  beforeEach(() => {
    mockedList.mockReset();
  });

  it("never mixes Demo and Live when environment is DEMO", async () => {
    mockedList.mockImplementation(async (_uid, opts) => {
      const rows = [
        {
          environment: "DEMO",
          side: "BUY",
          pnl: 10,
          brokerPnlConfirmed: true,
          closedAt: new Date().toISOString(),
          riskReward: 2,
          confidence: 80,
          session: "London",
          correlationId: "d1",
          entry: 1,
          exitPrice: 2,
          tradeSource: "demo_auto",
          reasonForExit: "TP"
        },
        {
          environment: "LIVE",
          side: "SELL",
          pnl: 999,
          brokerPnlConfirmed: true,
          closedAt: new Date().toISOString(),
          riskReward: 2,
          confidence: 80,
          session: "NewYork",
          correlationId: "l1"
        }
      ];
      return opts?.environment
        ? rows.filter((r) => r.environment === opts.environment)
        : rows;
    });
    const summary = await buildPerformanceSummary({
      uid: "u1",
      environment: "DEMO",
      period: "all"
    });
    expect(mockedList).toHaveBeenCalledWith("u1", {
      environment: "DEMO",
      limit: 500
    });
    expect(summary.totalTrades).toBe(1);
    expect(summary.netPnl).toBe(10);
    expect(summary.cumulativePnl.map((p) => p.pnl)).toEqual([10]);
  });

  it("Live isolation and empty state", async () => {
    mockedList.mockResolvedValue([]);
    const summary = await buildPerformanceSummary({
      uid: "u1",
      environment: "LIVE",
      period: "30d"
    });
    expect(summary.totalTrades).toBe(0);
    expect(summary.cumulativePnl).toEqual([]);
    expect(summary.recentTrades).toEqual([]);
  });

  it("excludes reconciliation-pending trades without broker-confirmed P/L", async () => {
    mockedList.mockResolvedValue([
      {
        environment: "DEMO",
        side: "BUY",
        pnl: 10,
        brokerPnlConfirmed: true,
        closedAt: "2026-08-02T10:00:00.000Z",
        riskReward: 1,
        confidence: 80,
        session: "London",
        correlationId: "confirmed"
      },
      {
        environment: "DEMO",
        side: "SELL",
        pnl: 0,
        brokerPnlConfirmed: false,
        closedAt: "2026-08-02T11:00:00.000Z",
        riskReward: 1,
        confidence: 80,
        session: "London",
        correlationId: "pending"
      },
      {
        environment: "DEMO",
        side: "BUY",
        pnl: 5,
        closedAt: "2026-08-02T12:00:00.000Z",
        riskReward: 1,
        confidence: 80,
        session: "London",
        correlationId: "legacy-unconfirmed"
      }
    ]);
    const summary = await buildPerformanceSummary({
      uid: "u1",
      environment: "DEMO",
      period: "all"
    });
    expect(summary.totalTrades).toBe(1);
    expect(summary.netPnl).toBe(10);
  });

  it("plots cumulative P/L in chronological order only", async () => {
    mockedList.mockResolvedValue([
      {
        environment: "DEMO",
        side: "BUY",
        pnl: 5,
        brokerPnlConfirmed: true,
        closedAt: "2026-08-02T10:00:00.000Z",
        riskReward: 1.5,
        confidence: 70,
        session: "London"
      },
      {
        environment: "DEMO",
        side: "SELL",
        pnl: -2,
        brokerPnlConfirmed: true,
        closedAt: "2026-08-01T10:00:00.000Z",
        riskReward: 1.2,
        confidence: 60,
        session: "NewYork"
      },
      {
        environment: "DEMO",
        side: "BUY",
        pnl: 3,
        brokerPnlConfirmed: true,
        closedAt: "2026-08-03T10:00:00.000Z",
        riskReward: 2,
        confidence: 85,
        session: "London"
      }
    ]);
    const summary = await buildPerformanceSummary({
      uid: "u1",
      environment: "DEMO",
      period: "all"
    });
    expect(summary.cumulativePnl.map((p) => p.pnl)).toEqual([-2, 3, 6]);
    expect(summary.cumulativePnl.map((p) => p.at)).toEqual([
      "2026-08-01T10:00:00.000Z",
      "2026-08-02T10:00:00.000Z",
      "2026-08-03T10:00:00.000Z"
    ]);
  });

  it("supports today / 7d / 30d / all filters", async () => {
    const now = Date.now();
    mockedList.mockResolvedValue([
      {
        environment: "DEMO",
        side: "BUY",
        pnl: 1,
        brokerPnlConfirmed: true,
        closedAt: new Date(now).toISOString(),
        riskReward: 1,
        confidence: 80,
        session: "London"
      },
      {
        environment: "DEMO",
        side: "BUY",
        pnl: 2,
        brokerPnlConfirmed: true,
        closedAt: new Date(now - 3 * 86_400_000).toISOString(),
        riskReward: 1,
        confidence: 80,
        session: "London"
      },
      {
        environment: "DEMO",
        side: "BUY",
        pnl: 3,
        brokerPnlConfirmed: true,
        closedAt: new Date(now - 20 * 86_400_000).toISOString(),
        riskReward: 1,
        confidence: 80,
        session: "London"
      },
      {
        environment: "DEMO",
        side: "BUY",
        pnl: 4,
        brokerPnlConfirmed: true,
        closedAt: new Date(now - 100 * 86_400_000).toISOString(),
        riskReward: 1,
        confidence: 80,
        session: "London"
      }
    ]);
    const today = await buildPerformanceSummary({
      uid: "u",
      environment: "DEMO",
      period: "today"
    });
    const d7 = await buildPerformanceSummary({
      uid: "u",
      environment: "DEMO",
      period: "7d"
    });
    const d30 = await buildPerformanceSummary({
      uid: "u",
      environment: "DEMO",
      period: "30d"
    });
    const all = await buildPerformanceSummary({
      uid: "u",
      environment: "DEMO",
      period: "all"
    });
    expect(today.totalTrades).toBe(1);
    expect(d7.totalTrades).toBe(2);
    expect(d30.totalTrades).toBe(3);
    expect(all.totalTrades).toBe(4);
  });
});
