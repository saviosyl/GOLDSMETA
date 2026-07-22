/**
 * Deterministic intraday ranking engine.
 * Output name: Ranked Intraday Opportunities
 * Candidates must pass absolute requirements — highest relative score alone is not enough.
 */

import type { StockStrategyProfile, StockIntradayRiskLimits } from "../featureFlags";
import type { RankedIntradayOpportunity, StockTradingViewSignal } from "../types";
import type { MarketIndicators, MarketQuote } from "../marketData/marketDataProvider";

export interface RankingCandidateInput {
  symbol: string;
  instrumentKind: "STOCK" | "ETF";
  strategy: StockStrategyProfile;
  quote: MarketQuote;
  indicators: MarketIndicators;
  signal: StockTradingViewSignal | null;
  limits: StockIntradayRiskLimits;
  now?: Date;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

export function rankIntradayOpportunity(input: RankingCandidateInput): RankedIntradayOpportunity {
  const { quote, indicators, signal, limits, strategy, symbol, instrumentKind } = input;
  const now = input.now ?? new Date();
  const dataAgeMs = Math.max(0, now.getTime() - new Date(quote.asOf).getTime());
  const supportReasons: string[] = [];
  const blockReasons: string[] = [];

  const trendScore = scoreTrend(indicators, supportReasons, blockReasons);
  const momentumScore = scoreMomentum(indicators, supportReasons, blockReasons);
  const volumeScore = scoreVolume(indicators, limits, supportReasons, blockReasons);
  const vwapScore = scoreVwap(quote, indicators, supportReasons, blockReasons);
  const relativeStrengthScore = clamp((indicators.relativeStrength ?? 1) * 50);
  const liquidityScore = scoreLiquidity(indicators, limits, supportReasons, blockReasons);
  const spreadScore = scoreSpread(quote, limits, supportReasons, blockReasons);
  const volatilityScore = scoreVolatility(indicators, limits, supportReasons, blockReasons);
  const riskScore = clamp(100 - (blockReasons.length * 15));
  const marketRegimeScore =
    indicators.broadMarketTrend === "BULL" ? 80 : indicators.broadMarketTrend === "BEAR" ? 30 : 55;
  const tradingViewConfirmationScore = scoreTv(signal, strategy, supportReasons, blockReasons);
  const entryQualityScore = clamp(
    (trendScore + momentumScore + vwapScore + volumeScore) / 4
  );

  const overallScore = clamp(
    trendScore * 0.18 +
      momentumScore * 0.14 +
      volumeScore * 0.12 +
      vwapScore * 0.12 +
      relativeStrengthScore * 0.08 +
      liquidityScore * 0.1 +
      spreadScore * 0.08 +
      volatilityScore * 0.06 +
      riskScore * 0.06 +
      marketRegimeScore * 0.03 +
      tradingViewConfirmationScore * 0.03
  );

  const atr = indicators.atr ?? quote.last * 0.01;
  const estimatedEntry = quote.ask ?? quote.last;
  const stop = Number((estimatedEntry - atr * 1.2).toFixed(4));
  const takeProfit = Number((estimatedEntry + atr * 2.2).toFixed(4));
  const expectedRewardRisk =
    estimatedEntry > stop ? (takeProfit - estimatedEntry) / (estimatedEntry - stop) : 0;

  if (indicators.sessionStatus !== "OPEN") {
    blockReasons.push("Market session is not OPEN");
  }
  if (dataAgeMs > 60_000) {
    blockReasons.push("Stale market data");
  }
  if (expectedRewardRisk < limits.minRewardRisk) {
    blockReasons.push(`Reward-to-risk ${expectedRewardRisk.toFixed(2)} below minimum`);
  }
  if ((signal?.confidence ?? overallScore) < limits.minConfidence) {
    blockReasons.push("Confidence below minimum");
  }

  const confidence = clamp(signal?.confidence ?? overallScore);
  const qualifies = blockReasons.length === 0 && overallScore >= limits.minConfidence * 0.85;

  return {
    symbol,
    instrumentKind,
    strategy,
    overallScore: Number(overallScore.toFixed(2)),
    entryQualityScore: Number(entryQualityScore.toFixed(2)),
    trendScore: Number(trendScore.toFixed(2)),
    momentumScore: Number(momentumScore.toFixed(2)),
    volumeScore: Number(volumeScore.toFixed(2)),
    vwapScore: Number(vwapScore.toFixed(2)),
    relativeStrengthScore: Number(relativeStrengthScore.toFixed(2)),
    liquidityScore: Number(liquidityScore.toFixed(2)),
    spreadScore: Number(spreadScore.toFixed(2)),
    volatilityScore: Number(volatilityScore.toFixed(2)),
    riskScore: Number(riskScore.toFixed(2)),
    marketRegimeScore: Number(marketRegimeScore.toFixed(2)),
    tradingViewConfirmationScore: Number(tradingViewConfirmationScore.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    dataAgeMs,
    expectedRewardRisk: Number(expectedRewardRisk.toFixed(3)),
    supportReasons,
    blockReasons,
    qualifies,
    estimatedEntry,
    stop,
    takeProfit,
    trigger: signal?.action ?? "SCANNER",
    timeframe: signal?.timeframe ?? "5m",
    higherTimeframeConfirmation: indicators.ema200 != null && quote.last > indicators.ema200 ? "Above EMA200" : null,
    entryBasis: strategyEntryBasis(strategy),
    stopBasis: "ATR(1.2) below entry",
    profitTargetBasis: "ATR(2.2) above entry",
    invalidationReason: "Close below stop or VWAP loss"
  };
}

/** Rank and filter — only qualifying opportunities are selectable. */
export function selectTopQualifyingOpportunity(
  ranked: RankedIntradayOpportunity[]
): RankedIntradayOpportunity | null {
  const qualifying = ranked.filter((r) => r.qualifies).sort((a, b) => b.overallScore - a.overallScore);
  return qualifying[0] ?? null;
}

function strategyEntryBasis(strategy: StockStrategyProfile): string {
  switch (strategy) {
    case "MOMENTUM_BREAKOUT":
      return "Momentum breakout through resistance with volume";
    case "PULLBACK_IN_TREND":
      return "Pullback hold in established uptrend";
    case "VWAP_RECLAIM":
      return "Price reclaim of session VWAP";
    case "OPENING_RANGE_BREAKOUT":
      return "Opening-range high breakout";
    case "RELATIVE_VOLUME_BREAKOUT":
      return "Relative-volume expansion breakout";
    default:
      return "Strategy entry";
  }
}

function scoreTrend(
  ind: MarketIndicators,
  support: string[],
  block: string[]
): number {
  let score = 50;
  if (ind.ema21 != null && ind.ema50 != null && ind.ema21 > ind.ema50) {
    score += 20;
    support.push("EMA21 above EMA50");
  } else {
    block.push("Trend stack not aligned");
  }
  if (ind.broadMarketTrend === "BULL") {
    score += 15;
    support.push("Broad market bullish");
  }
  return clamp(score);
}

function scoreMomentum(ind: MarketIndicators, support: string[], block: string[]): number {
  const rsi = ind.rsi ?? 50;
  if (rsi >= 45 && rsi <= 70) {
    support.push("RSI in constructive range");
    return clamp(60 + (rsi - 50));
  }
  if (rsi > 75) block.push("RSI overextended");
  return clamp(40);
}

function scoreVolume(
  ind: MarketIndicators,
  limits: StockIntradayRiskLimits,
  support: string[],
  block: string[]
): number {
  const rvol = ind.relativeVolume ?? 0;
  if (rvol >= 1.5) {
    support.push(`Relative volume ${rvol.toFixed(2)}`);
    return clamp(50 + rvol * 15);
  }
  if (rvol < 1) block.push("Relative volume too low");
  void limits;
  return clamp(35 + rvol * 10);
}

function scoreVwap(
  quote: MarketQuote,
  ind: MarketIndicators,
  support: string[],
  block: string[]
): number {
  if (ind.vwap == null) return 50;
  if (quote.last >= ind.vwap) {
    support.push("Price at/above VWAP");
    return 75;
  }
  block.push("Price below VWAP");
  return 35;
}

function scoreLiquidity(
  ind: MarketIndicators,
  limits: StockIntradayRiskLimits,
  support: string[],
  block: string[]
): number {
  const adv = ind.averageDailyVolume ?? 0;
  if (adv >= limits.minLiquidityAdv) {
    support.push("ADV meets liquidity floor");
    return 80;
  }
  block.push("Insufficient average daily volume");
  return 25;
}

function scoreSpread(
  quote: MarketQuote,
  limits: StockIntradayRiskLimits,
  support: string[],
  block: string[]
): number {
  const spread = quote.spreadBps ?? 999;
  if (spread <= limits.maxSpreadBps) {
    support.push(`Spread ${spread} bps within limit`);
    return clamp(90 - spread);
  }
  block.push("Excessive spread");
  return 20;
}

function scoreVolatility(
  ind: MarketIndicators,
  limits: StockIntradayRiskLimits,
  support: string[],
  block: string[]
): number {
  const vol = ind.volatilityPct ?? 0;
  if (vol <= limits.maxVolatilityPct) {
    support.push("Volatility within limits");
    return clamp(85 - vol * 5);
  }
  block.push("Excessive volatility");
  return 25;
}

function scoreTv(
  signal: StockTradingViewSignal | null,
  strategy: StockStrategyProfile,
  support: string[],
  block: string[]
): number {
  if (!signal) return 40;
  if (signal.action !== "ENTRY_LONG") {
    block.push(`Signal action ${signal.action} is not ENTRY_LONG`);
    return 10;
  }
  if (signal.strategyId && signal.strategyId.length > 0) {
    support.push(`TradingView strategy ${signal.strategyId}`);
  }
  void strategy;
  return clamp(50 + (signal.confidence ?? 50) / 2);
}
