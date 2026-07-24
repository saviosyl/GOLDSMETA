/**
 * GoldMeta internal paper-execution simulator.
 * Independent of Trading 212 / cTrader.
 * GOLDMETA SIMULATION — NOT A BROKER ACCOUNT
 */

import { randomBytes } from "node:crypto";

export const PAPER_LABEL = "GOLDMETA SIMULATION — NOT A BROKER ACCOUNT";

export interface PaperQuote {
  bid: number;
  ask: number;
  timestamp: string;
  source: "LIVE" | "HISTORICAL_FIXTURE";
}

export interface PaperPosition {
  id: string;
  direction: "LONG" | "SHORT";
  volume: number;
  entry: number;
  stopLoss: number | null;
  takeProfit: number | null;
  unrealisedPnl: number;
}

export interface PaperState {
  label: typeof PAPER_LABEL;
  cash: number;
  equity: number;
  positions: PaperPosition[];
  realisedPnl: number;
  tradesToday: number;
  emergencyStop: boolean;
  dailyLossLock: boolean;
}

export function createPaperSimulator(startCash = 10_000) {
  const state: PaperState = {
    label: PAPER_LABEL,
    cash: startCash,
    equity: startCash,
    positions: [],
    realisedPnl: 0,
    tradesToday: 0,
    emergencyStop: false,
    dailyLossLock: false
  };

  return {
    label: PAPER_LABEL,
    getState(): PaperState {
      return { ...state, positions: [...state.positions] };
    },
    engageEmergencyStop() {
      state.emergencyStop = true;
    },
    openMarket(args: {
      direction: "LONG" | "SHORT";
      volume: number;
      quote: PaperQuote;
      stopLoss: number | null;
      takeProfit: number | null;
      slippage: number;
      maxTradesPerDay: number;
    }): { ok: boolean; reason?: string; position?: PaperPosition } {
      if (state.emergencyStop) return { ok: false, reason: "EMERGENCY_STOP" };
      if (state.dailyLossLock) return { ok: false, reason: "DAILY_LOSS_LOCK" };
      if (state.tradesToday >= args.maxTradesPerDay) {
        return { ok: false, reason: "DAILY_TRADE_LIMIT" };
      }
      if (state.positions.length > 0) return { ok: false, reason: "MAX_ONE_POSITION" };
      const slip = Math.max(0, args.slippage);
      const entry =
        args.direction === "LONG"
          ? args.quote.ask + slip
          : args.quote.bid - slip;
      const pos: PaperPosition = {
        id: `paper_${randomBytes(4).toString("hex")}`,
        direction: args.direction,
        volume: args.volume,
        entry,
        stopLoss: args.stopLoss,
        takeProfit: args.takeProfit,
        unrealisedPnl: 0
      };
      state.positions.push(pos);
      state.tradesToday += 1;
      return { ok: true, position: pos };
    },
    markToMarket(quote: PaperQuote) {
      for (const p of state.positions) {
        const mid = (quote.bid + quote.ask) / 2;
        const delta = p.direction === "LONG" ? mid - p.entry : p.entry - mid;
        p.unrealisedPnl = Number((delta * p.volume * 100).toFixed(2));
      }
      const upl = state.positions.reduce((s, p) => s + p.unrealisedPnl, 0);
      state.equity = Number((state.cash + upl).toFixed(2));
    }
  };
}
