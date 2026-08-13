/**
 * One-position-at-a-time SHADOW trading state machine.
 * NO broker orders. BUY enters at Ask / exits at Bid; SELL enters at Bid / exits at Ask.
 */
import {
  GH_COOLDOWN_MS,
  GH_DEFAULT_ENTRY,
  GH_DEFAULT_ENTRY_SLIPPAGE,
  GH_DEFAULT_EXECUTION_BUFFER,
  GH_DEFAULT_EXIT_SLIPPAGE,
  GH_DEFAULT_PROTECTIVE_STOP,
  GH_TAKE_PROFIT_EDGE_FADE,
  GH_TAKE_PROFIT_SIGNAL_USD,
  GOLD_HUNTER_MODEL_VERSION,
  GOLD_HUNTER_STRATEGY_VERSION
} from "./config";
import {
  consecutiveAgreement,
  decideAction,
  type EntryThresholds
} from "./signalPolicy";
import type {
  GhAction,
  GhExitReason,
  GhForecast,
  GhHuntState,
  GhShadowSide,
  GhShadowTrade
} from "./types";

export type ShadowQuote = {
  timestampMs: number;
  bid: number;
  ask: number;
  spread: number;
};

export type OpenShadowTrade = {
  tradeId: string;
  date: string;
  strategyVersion: string;
  modelVersion: string;
  entryTimestampMs: number;
  side: GhShadowSide;
  entryBid: number;
  entryAsk: number;
  entryPrice: number;
  entrySpread: number;
  additionalFriction: number;
  mfe: number;
  mae: number;
  entryProbs: GhForecast["horizons"];
  entryReason: string;
  session: GhForecast["session"];
  regime: GhForecast["regime"];
};

export type ShadowEngineState = {
  status: GhHuntState;
  openTrade: OpenShadowTrade | null;
  recentActions: GhAction[];
  edgeGoneStreak: number;
  edgeFlipStreak: number;
  cooldownUntilMs: number;
  completedTrades: GhShadowTrade[];
  strategyVersion: string;
  modelVersion: string;
};

export type ShadowEvalInput = {
  nowMs: number;
  quote: ShadowQuote | null;
  forecast: GhForecast | null;
  marketClosed?: boolean;
  thresholds?: EntryThresholds;
  maxHoldSec?: number;
  protectiveStopUsd?: number;
};

function newTradeId(nowMs: number, strategyVersion: string): string {
  return `gh_${strategyVersion}_${nowMs}`;
}

function classifyResult(netMove: number): GhShadowTrade["result"] {
  if (Math.abs(netMove) < 1e-9) return "BREAKEVEN";
  return netMove > 0 ? "WIN" : "LOSS";
}

function markToMarket(trade: OpenShadowTrade, quote: ShadowQuote): number {
  if (trade.side === "BUY") return quote.bid - trade.entryPrice;
  return trade.entryPrice - quote.ask;
}

export function createShadowEngine(opts?: {
  strategyVersion?: string;
  modelVersion?: string;
}): ShadowEngineState {
  return {
    status: "HUNTING",
    openTrade: null,
    recentActions: [],
    edgeGoneStreak: 0,
    edgeFlipStreak: 0,
    cooldownUntilMs: 0,
    completedTrades: [],
    strategyVersion: opts?.strategyVersion ?? GOLD_HUNTER_STRATEGY_VERSION,
    modelVersion: opts?.modelVersion ?? GOLD_HUNTER_MODEL_VERSION
  };
}

function openShadow(
  state: ShadowEngineState,
  side: GhShadowSide,
  quote: ShadowQuote,
  forecast: GhForecast,
  reason: string
): ShadowEngineState {
  if (state.openTrade) return state; // single position — no pyramiding / martingale / grid
  const entryPrice = side === "BUY" ? quote.ask : quote.bid;
  const trade: OpenShadowTrade = {
    tradeId: newTradeId(quote.timestampMs, state.strategyVersion),
    date: new Date(quote.timestampMs).toISOString().slice(0, 10),
    strategyVersion: state.strategyVersion,
    modelVersion: state.modelVersion,
    entryTimestampMs: quote.timestampMs,
    side,
    entryBid: quote.bid,
    entryAsk: quote.ask,
    entryPrice,
    entrySpread: quote.spread,
    additionalFriction:
      GH_DEFAULT_ENTRY_SLIPPAGE +
      GH_DEFAULT_EXIT_SLIPPAGE +
      GH_DEFAULT_EXECUTION_BUFFER,
    mfe: 0,
    mae: 0,
    entryProbs: forecast.horizons,
    entryReason: reason,
    session: forecast.session,
    regime: forecast.regime
  };
  return {
    ...state,
    openTrade: trade,
    status: side === "BUY" ? "SHADOW_BUY" : "SHADOW_SELL",
    recentActions: [],
    edgeGoneStreak: 0,
    edgeFlipStreak: 0
  };
}

function closeShadow(
  state: ShadowEngineState,
  quote: ShadowQuote,
  forecast: GhForecast | null,
  exitReason: GhExitReason
): ShadowEngineState {
  const trade = state.openTrade;
  if (!trade) return state;
  const exitPrice = trade.side === "BUY" ? quote.bid : quote.ask;
  // Bid/Ask entry/exit already embeds spread — subtract only additional friction.
  const grossMove =
    trade.side === "BUY"
      ? exitPrice - trade.entryPrice
      : trade.entryPrice - exitPrice;
  const netMove = grossMove - trade.additionalFriction;
  const durationSeconds = Math.max(
    0,
    Math.round((quote.timestampMs - trade.entryTimestampMs) / 1000)
  );
  const closed: GhShadowTrade = {
    tradeId: trade.tradeId,
    date: trade.date,
    strategyVersion: trade.strategyVersion,
    modelVersion: trade.modelVersion,
    entryTimestampMs: trade.entryTimestampMs,
    exitTimestampMs: quote.timestampMs,
    durationSeconds,
    side: trade.side,
    entryBid: trade.entryBid,
    entryAsk: trade.entryAsk,
    entryPrice: trade.entryPrice,
    exitBid: quote.bid,
    exitAsk: quote.ask,
    exitPrice,
    entrySpread: trade.entrySpread,
    grossMove,
    additionalFriction: trade.additionalFriction,
    netMove,
    mfe: trade.mfe,
    mae: trade.mae,
    entryProbs: trade.entryProbs,
    exitProbs: forecast?.horizons ?? null,
    entryReason: trade.entryReason,
    exitReason,
    session: trade.session,
    regime: trade.regime,
    result: classifyResult(netMove)
  };
  return {
    ...state,
    openTrade: null,
    completedTrades: [...state.completedTrades, closed],
    status: "COOLDOWN",
    cooldownUntilMs: quote.timestampMs + GH_COOLDOWN_MS,
    edgeGoneStreak: 0,
    edgeFlipStreak: 0,
    recentActions: []
  };
}

function oppositeStrong(
  forecast: GhForecast,
  openSide: GhShadowSide,
  thresholds?: EntryThresholds
): boolean {
  const action = decideAction(forecast, thresholds);
  if (openSide === "BUY" && action === "SELL") return true;
  if (openSide === "SELL" && action === "BUY") return true;
  return false;
}

function expectedEdgeForSide(
  forecast: GhForecast,
  side: GhShadowSide
): number {
  const edges =
    side === "BUY"
      ? [
          forecast.horizons[5].expectedNetBuy,
          forecast.horizons[15].expectedNetBuy,
          forecast.horizons[30].expectedNetBuy
        ]
      : [
          forecast.horizons[5].expectedNetSell,
          forecast.horizons[15].expectedNetSell,
          forecast.horizons[30].expectedNetSell
        ];
  return Math.max(...edges);
}

export function evaluateShadow(
  state: ShadowEngineState,
  input: ShadowEvalInput
): ShadowEngineState {
  const { nowMs, quote, forecast, marketClosed } = input;
  const maxHoldSec = input.maxHoldSec ?? GH_DEFAULT_ENTRY.maxHoldSec;
  const stop = input.protectiveStopUsd ?? GH_DEFAULT_PROTECTIVE_STOP;

  if (marketClosed) {
    if (state.openTrade && quote) {
      return closeShadow(state, quote, forecast, "MARKET_CLOSED");
    }
    return { ...state, status: "MARKET_CLOSED" };
  }

  if (
    !quote ||
    !forecast ||
    forecast.dataQuality === "DATA_STALE" ||
    forecast.dataQuality === "INVALID"
  ) {
    if (state.openTrade && quote && forecast?.dataQuality === "DATA_STALE") {
      return closeShadow(state, quote, forecast, "DATA_STALE");
    }
    return { ...state, status: "DATA_STALE" };
  }

  if (state.openTrade) {
    let next = { ...state };
    const trade = { ...state.openTrade };
    const mtm = markToMarket(trade, quote);
    trade.mfe = Math.max(trade.mfe, mtm);
    trade.mae = Math.min(trade.mae, mtm);
    next.openTrade = trade;

    const heldSec = (nowMs - trade.entryTimestampMs) / 1000;

    if (mtm <= -Math.abs(stop)) {
      return closeShadow(next, quote, forecast, "PROTECTIVE_STOP");
    }
    if (heldSec >= maxHoldSec) {
      return closeShadow(next, quote, forecast, "MAX_HOLD");
    }

    if (oppositeStrong(forecast, trade.side, input.thresholds)) {
      next.edgeFlipStreak = state.edgeFlipStreak + 1;
      next.edgeGoneStreak = 0;
      if (next.edgeFlipStreak >= 2) {
        return closeShadow(next, quote, forecast, "EDGE_FLIPPED");
      }
    } else {
      next.edgeFlipStreak = 0;
      const edge = expectedEdgeForSide(forecast, trade.side);
      if (edge <= 0) {
        next.edgeGoneStreak = state.edgeGoneStreak + 1;
        if (next.edgeGoneStreak >= 2) {
          return closeShadow(next, quote, forecast, "EDGE_GONE");
        }
      } else {
        next.edgeGoneStreak = 0;
      }
    }

    if (trade.mfe >= GH_TAKE_PROFIT_SIGNAL_USD) {
      const edge = expectedEdgeForSide(forecast, trade.side);
      if (edge <= GH_TAKE_PROFIT_EDGE_FADE) {
        return closeShadow(next, quote, forecast, "TAKE_PROFIT_SIGNAL");
      }
    }

    next.status = trade.side === "BUY" ? "SHADOW_BUY" : "SHADOW_SELL";
    return next;
  }

  if (nowMs < state.cooldownUntilMs) {
    return { ...state, status: "COOLDOWN" };
  }

  const action = decideAction(forecast, input.thresholds);
  const recent = [...state.recentActions, action].slice(-8);
  const confirm =
    input.thresholds?.consecutiveEvals ?? GH_DEFAULT_ENTRY.consecutiveEvals;
  const agreed = consecutiveAgreement(recent, confirm);

  let status: GhHuntState = "HUNTING";
  if (action === "BUY" || action === "SELL") status = "TARGET_FOUND";
  if (agreed === "BUY" || agreed === "SELL") status = "ARMED";

  let next: ShadowEngineState = { ...state, recentActions: recent, status };

  if (agreed === "BUY") {
    next = openShadow(
      next,
      "BUY",
      quote,
      forecast,
      "MULTI_HORIZON_BUY_AGREEMENT"
    );
  } else if (agreed === "SELL") {
    next = openShadow(
      next,
      "SELL",
      quote,
      forecast,
      "MULTI_HORIZON_SELL_AGREEMENT"
    );
  }

  return next;
}

export function openShadowPnL(
  state: ShadowEngineState,
  quote: ShadowQuote | null
): number | null {
  if (!state.openTrade || !quote) return null;
  return markToMarket(state.openTrade, quote);
}
