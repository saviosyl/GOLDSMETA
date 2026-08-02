/**
 * Isolated Trading 212 General Invest paper portfolio.
 * Never creates a dispatchable broker order request.
 */

import { randomBytes } from "node:crypto";

export const T212_PAPER_DISCLAIMER =
  "Paper preview only — no Trading 212 order will be submitted.";

export const DEFAULT_PAPER_RISK = {
  startingCash: 10_000,
  maxInvestmentPerTrade: 1_000,
  maxDailyLoss: 500,
  maxPortfolioExposure: 8_000,
  maxExposurePerStock: 2_000,
  maxOpenPositions: 8,
  feeBps: 5,
  fxCostBps: 3,
  slippageBps: 5,
  stalePriceMaxAgeMs: 5 * 60_000
} as const;

export type T212PaperSide = "BUY" | "SELL_OWNED";

export type T212PaperPosition = {
  ticker: string;
  name: string;
  quantity: number;
  avgCost: number;
  currency: string;
  marketValue: number;
  unrealisedPnl: number;
};

export type T212PaperJournalEntry = {
  id: string;
  side: T212PaperSide;
  ticker: string;
  quantity: number;
  fillPrice: number;
  fees: number;
  fxCost: number;
  slippage: number;
  notional: number;
  realisedPnl: number | null;
  signalRef: string | null;
  timestamp: string;
  note: string;
};

export type T212PaperState = {
  cash: number;
  startingCash: number;
  equity: number;
  investedValue: number;
  realisedPnl: number;
  unrealisedPnl: number;
  positions: T212PaperPosition[];
  journal: T212PaperJournalEntry[];
  emergencyStop: boolean;
  dailyRealisedLoss: number;
  tradesToday: number;
  lastTradeDay: string | null;
  disclaimer: typeof T212_PAPER_DISCLAIMER;
  ordersEnabled: false;
  autoTrade: "OFF";
};

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

export function createT212InvestPaperPortfolio(
  risk: Partial<typeof DEFAULT_PAPER_RISK> = {}
) {
  const limits = { ...DEFAULT_PAPER_RISK, ...risk };
  const state: T212PaperState = {
    cash: limits.startingCash,
    startingCash: limits.startingCash,
    equity: limits.startingCash,
    investedValue: 0,
    realisedPnl: 0,
    unrealisedPnl: 0,
    positions: [],
    journal: [],
    emergencyStop: false,
    dailyRealisedLoss: 0,
    tradesToday: 0,
    lastTradeDay: null,
    disclaimer: T212_PAPER_DISCLAIMER,
    ordersEnabled: false,
    autoTrade: "OFF"
  };

  function refreshDay() {
    const today = dayKey();
    if (state.lastTradeDay !== today) {
      state.lastTradeDay = today;
      state.tradesToday = 0;
      state.dailyRealisedLoss = 0;
    }
  }

  function revalue(marks: Record<string, number>) {
    let invested = 0;
    let upl = 0;
    for (const p of state.positions) {
      const px = marks[p.ticker] ?? p.avgCost;
      p.marketValue = round2(px * p.quantity);
      p.unrealisedPnl = round2((px - p.avgCost) * p.quantity);
      invested += p.marketValue;
      upl += p.unrealisedPnl;
    }
    state.investedValue = round2(invested);
    state.unrealisedPnl = round2(upl);
    state.equity = round2(state.cash + invested);
  }

  function costs(notional: number) {
    const fees = round2((notional * limits.feeBps) / 10_000);
    const fxCost = round2((notional * limits.fxCostBps) / 10_000);
    const slippage = round2((notional * limits.slippageBps) / 10_000);
    return { fees, fxCost, slippage };
  }

  return {
    getState(marks: Record<string, number> = {}): T212PaperState {
      revalue(marks);
      return {
        ...state,
        positions: state.positions.map((p) => ({ ...p })),
        journal: state.journal.map((j) => ({ ...j }))
      };
    },

    getLimits() {
      return { ...limits };
    },

    engageEmergencyStop() {
      state.emergencyStop = true;
    },

    releaseEmergencyStop() {
      state.emergencyStop = false;
    },

    buy(args: {
      ticker: string;
      name?: string;
      quantity: number;
      price: number;
      currency?: string;
      signalRef?: string | null;
      priceTimestamp?: string | null;
      marketOpen?: boolean;
    }): { ok: boolean; reason?: string; entry?: T212PaperJournalEntry } {
      refreshDay();
      if (state.emergencyStop) return { ok: false, reason: "EMERGENCY_STOP" };
      if (args.marketOpen === false) return { ok: false, reason: "MARKET_CLOSED" };
      if (args.priceTimestamp) {
        const age = Date.now() - Date.parse(args.priceTimestamp);
        if (Number.isFinite(age) && age > limits.stalePriceMaxAgeMs) {
          return { ok: false, reason: "STALE_PRICE" };
        }
      }
      if (!(args.quantity > 0) || !(args.price > 0)) {
        return { ok: false, reason: "INVALID_SIZE" };
      }
      const notional = round2(args.quantity * args.price);
      if (notional > limits.maxInvestmentPerTrade) {
        return { ok: false, reason: "MAX_INVESTMENT_PER_TRADE" };
      }
      if (state.dailyRealisedLoss >= limits.maxDailyLoss) {
        return { ok: false, reason: "MAX_DAILY_LOSS" };
      }
      const existing = state.positions.find((p) => p.ticker === args.ticker);
      const currentExposure = existing ? existing.quantity * args.price : 0;
      if (currentExposure + notional > limits.maxExposurePerStock) {
        return { ok: false, reason: "MAX_EXPOSURE_PER_STOCK" };
      }
      if (!existing && state.positions.length >= limits.maxOpenPositions) {
        return { ok: false, reason: "MAX_OPEN_POSITIONS" };
      }
      const { fees, fxCost, slippage } = costs(notional);
      const totalDebit = round2(notional + fees + fxCost + slippage);
      if (totalDebit > state.cash) return { ok: false, reason: "INSUFFICIENT_CASH" };
      if (state.investedValue + notional > limits.maxPortfolioExposure) {
        return { ok: false, reason: "MAX_PORTFOLIO_EXPOSURE" };
      }

      const fillPrice = round2(args.price * (1 + limits.slippageBps / 10_000));
      if (existing) {
        const newQty = existing.quantity + args.quantity;
        existing.avgCost = round2(
          (existing.avgCost * existing.quantity + fillPrice * args.quantity) / newQty
        );
        existing.quantity = newQty;
      } else {
        state.positions.push({
          ticker: args.ticker,
          name: args.name ?? args.ticker,
          quantity: args.quantity,
          avgCost: fillPrice,
          currency: args.currency ?? "EUR",
          marketValue: round2(fillPrice * args.quantity),
          unrealisedPnl: 0
        });
      }

      state.cash = round2(state.cash - totalDebit);
      state.tradesToday += 1;
      const entry: T212PaperJournalEntry = {
        id: `tp_${randomBytes(4).toString("hex")}`,
        side: "BUY",
        ticker: args.ticker,
        quantity: args.quantity,
        fillPrice,
        fees,
        fxCost,
        slippage,
        notional,
        realisedPnl: null,
        signalRef: args.signalRef ?? null,
        timestamp: new Date().toISOString(),
        note: T212_PAPER_DISCLAIMER
      };
      state.journal.unshift(entry);
      state.journal = state.journal.slice(0, 200);
      revalue({ [args.ticker]: fillPrice });
      return { ok: true, entry };
    },

    sellOwned(args: {
      ticker: string;
      quantity: number;
      price: number;
      signalRef?: string | null;
      priceTimestamp?: string | null;
      marketOpen?: boolean;
    }): { ok: boolean; reason?: string; entry?: T212PaperJournalEntry } {
      refreshDay();
      if (state.emergencyStop) return { ok: false, reason: "EMERGENCY_STOP" };
      if (args.marketOpen === false) return { ok: false, reason: "MARKET_CLOSED" };
      if (args.priceTimestamp) {
        const age = Date.now() - Date.parse(args.priceTimestamp);
        if (Number.isFinite(age) && age > limits.stalePriceMaxAgeMs) {
          return { ok: false, reason: "STALE_PRICE" };
        }
      }
      const pos = state.positions.find((p) => p.ticker === args.ticker);
      if (!pos) return { ok: false, reason: "NO_OWNED_POSITION" };
      if (!(args.quantity > 0) || args.quantity > pos.quantity) {
        return { ok: false, reason: "SELL_EXCEEDS_OWNED" };
      }
      // Naked / short selling is never allowed.
      if (args.quantity > pos.quantity) {
        return { ok: false, reason: "SHORT_SELLING_REJECTED" };
      }

      const notional = round2(args.quantity * args.price);
      const { fees, fxCost, slippage } = costs(notional);
      const fillPrice = round2(args.price * (1 - limits.slippageBps / 10_000));
      const proceeds = round2(fillPrice * args.quantity - fees - fxCost);
      const realised = round2((fillPrice - pos.avgCost) * args.quantity - fees - fxCost);
      state.cash = round2(state.cash + proceeds);
      state.realisedPnl = round2(state.realisedPnl + realised);
      if (realised < 0) {
        state.dailyRealisedLoss = round2(state.dailyRealisedLoss + Math.abs(realised));
      }
      pos.quantity = round2(pos.quantity - args.quantity);
      if (pos.quantity <= 0) {
        state.positions = state.positions.filter((p) => p.ticker !== args.ticker);
      }
      state.tradesToday += 1;
      const entry: T212PaperJournalEntry = {
        id: `tp_${randomBytes(4).toString("hex")}`,
        side: "SELL_OWNED",
        ticker: args.ticker,
        quantity: args.quantity,
        fillPrice,
        fees,
        fxCost,
        slippage,
        notional,
        realisedPnl: realised,
        signalRef: args.signalRef ?? null,
        timestamp: new Date().toISOString(),
        note: T212_PAPER_DISCLAIMER
      };
      state.journal.unshift(entry);
      state.journal = state.journal.slice(0, 200);
      revalue({ [args.ticker]: fillPrice });
      return { ok: true, entry };
    }
  };
}

export type T212InvestPaperPortfolio = ReturnType<typeof createT212InvestPaperPortfolio>;
