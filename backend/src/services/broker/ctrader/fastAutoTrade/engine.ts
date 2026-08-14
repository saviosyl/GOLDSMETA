/**
 * FAST_AUTOTRADE_V1 decision engine.
 *
 * regime → bias → setup → trigger → quality → safety → BUY/SELL/WAIT
 *
 * Supporting indicators contribute score. Missing one does not force WAIT.
 * Hard safety vetoes remain hard.
 */

import type { FastAutoTradeConfig } from "./config";
import {
  DEFAULT_FAST_AUTOTRADE_CONFIG,
  entryThresholdForRegime,
  gradeForScore
} from "./config";
import { setupIdentityKey, shouldBlockFlap } from "./stateMachine";
import { FAST_AUTOTRADE_STRATEGY_ID } from "./types";
import type {
  FastAction,
  FastAutoTradeDecision,
  FastAutoTradeInput,
  FastBias,
  FastGeometry,
  FastGrade,
  FastMissedOpportunity,
  FastOhlc,
  FastRegime,
  FastSetupIdentity,
  FastSetupType,
  FastWaitReason
} from "./types";

const present = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function marketOpen(status: string | null): boolean {
  const s = String(status ?? "").toUpperCase();
  if (!s) return true;
  return s.includes("OPEN") || s.includes("TRADEABLE");
}

export function estimateAtr(
  input: FastAutoTradeInput,
  config: FastAutoTradeConfig = DEFAULT_FAST_AUTOTRADE_CONFIG
): number {
  if (present(input.atr) && input.atr > 0) return input.atr;
  const c = input.ohlcv;
  if (c && present(c.high) && present(c.low) && c.high > c.low) {
    return c.high - c.low;
  }
  return Math.max(input.price * config.typicalAtrPricePct, 0.4);
}

export function candleEfficiency(ohlcv: FastOhlc | null): number | null {
  if (!ohlcv || !present(ohlcv.open) || !present(ohlcv.close)) return null;
  if (!present(ohlcv.high) || !present(ohlcv.low)) return null;
  const range = ohlcv.high - ohlcv.low;
  if (!(range > 0)) return 0;
  return Math.abs(ohlcv.close - ohlcv.open) / range;
}

export function classifyFastRegime(
  input: FastAutoTradeInput,
  config: FastAutoTradeConfig = DEFAULT_FAST_AUTOTRADE_CONFIG
): FastRegime {
  const hard = hardSafetyVeto(input);
  if (hard) return "DANGEROUS";

  const atr = estimateAtr(input, config);
  const c = input.ohlcv;
  const range =
    c && present(c.high) && present(c.low) ? c.high - c.low : atr;
  const rangePct = input.price > 0 ? range / input.price : 0;
  const eff = candleEfficiency(c);
  const hint = String(input.marketRegimeHint ?? "").toUpperCase();
  const rangingHint = hint === "RANGING" || hint === "TRANSITION";
  const trendingHint = hint === "TRENDING_UP" || hint === "TRENDING_DOWN";
  const strength = input.trendStrength ?? 0;

  if (range > atr * config.dangerousAtrMult) return "DANGEROUS";
  if (rangePct > 0 && rangePct < config.quietRangePct && strength < 35) {
    return "QUIET";
  }

  const choppy =
    (eff != null && eff <= config.chopEfficiencyMax && rangingHint) ||
    (rangingHint && strength < 40 && (eff == null || eff < 0.4));
  if (choppy) return "CHOP";

  const fast =
    rangePct >= config.fastRegimeRangePct &&
    (eff == null || eff >= config.fastRegimeEfficiency) &&
    (trendingHint || strength >= 48) &&
    (input.spread == null || input.spread <= input.safety.spreadLimit);
  if (fast) return "FAST";
  return "NORMAL";
}

export function determineFastBias(input: FastAutoTradeInput): FastBias {
  let bull = 0;
  let bear = 0;
  if (input.trendDirection === "BULLISH") bull += 2;
  if (input.trendDirection === "BEARISH") bear += 2;
  if ((input.trendStrength ?? 0) >= 60) {
    if (input.trendDirection === "BULLISH") bull += 1;
    if (input.trendDirection === "BEARISH") bear += 1;
  }
  if (present(input.poc)) {
    if (input.price > input.poc) bull += 1;
    if (input.price < input.poc) bear += 1;
  }
  if (present(input.vwap)) {
    if (input.price > input.vwap) bull += 1;
    if (input.price < input.vwap) bear += 1;
  }
  if (present(input.ema21)) {
    if (input.price > input.ema21) bull += 1;
    if (input.price < input.ema21) bear += 1;
  }
  if (present(input.ema50) && present(input.ema21)) {
    if (input.ema21 > input.ema50) bull += 1;
    if (input.ema21 < input.ema50) bear += 1;
  }
  const c = input.ohlcv;
  if (c && present(c.close) && present(c.open)) {
    if (c.close > c.open) bull += 1;
    if (c.close < c.open) bear += 1;
  }
  if (input.confirmationDirection === "BULLISH") bull += 1;
  if (input.confirmationDirection === "BEARISH") bear += 1;
  if (input.bullishEvidence.length > input.bearishEvidence.length) bull += 1;
  if (input.bearishEvidence.length > input.bullishEvidence.length) bear += 1;
  if (input.v3Decision === "BUY") bull += 1;
  if (input.v3Decision === "SELL") bear += 1;

  if (bull >= bear + 2) return "BULLISH";
  if (bear >= bull + 2) return "BEARISH";
  if (bull > bear) return "BULLISH";
  if (bear > bull) return "BEARISH";
  return "NEUTRAL";
}

function nearLevel(price: number, level: number | null, atr: number): boolean {
  if (!present(level) || !(atr > 0)) return false;
  return Math.abs(price - level) <= atr * 0.55;
}

export function isExtended(
  input: FastAutoTradeInput,
  bias: FastBias,
  atr: number,
  config: FastAutoTradeConfig
): boolean {
  const c = input.ohlcv;
  const range =
    c && present(c.high) && present(c.low) ? c.high - c.low : null;
  if (range != null && range > atr * config.maximumExtensionAtr) return true;
  const anchor = input.vwap ?? input.ema21 ?? input.poc;
  if (present(anchor) && atr > 0) {
    const dist = input.price - anchor;
    if (bias === "BULLISH" && dist > atr * config.maximumExtensionAtr) return true;
    if (bias === "BEARISH" && -dist > atr * config.maximumExtensionAtr) return true;
  }
  return false;
}

export function detectFastSetup(
  input: FastAutoTradeInput,
  bias: FastBias,
  regime: FastRegime,
  config: FastAutoTradeConfig = DEFAULT_FAST_AUTOTRADE_CONFIG
): { setupType: FastSetupType | null; notes: string[] } {
  if (bias === "NEUTRAL") return { setupType: null, notes: [] };
  const atr = estimateAtr(input, config);
  const cls = String(input.confirmationClassification ?? "").toUpperCase();
  const notes: string[] = [];
  const pullbackHold =
    bias === "BULLISH"
      ? nearLevel(input.price, input.val, atr) ||
        nearLevel(input.price, input.poc, atr) ||
        nearLevel(input.price, input.vwap, atr) ||
        nearLevel(input.price, input.ema21, atr) ||
        nearLevel(input.price, input.nearbySupport, atr)
      : nearLevel(input.price, input.vah, atr) ||
        nearLevel(input.price, input.poc, atr) ||
        nearLevel(input.price, input.vwap, atr) ||
        nearLevel(input.price, input.ema21, atr) ||
        nearLevel(input.price, input.nearbyResistance, atr);

  if (cls === "RETEST") {
    notes.push("Breakout retest classification");
    return { setupType: "BREAKOUT_RETEST", notes };
  }
  if (cls === "BREAKOUT") {
    notes.push("Breakout classification");
    return { setupType: "BREAKOUT", notes };
  }
  if (cls === "CONTINUATION" || (cls === "REJECTION" && pullbackHold)) {
    notes.push(pullbackHold ? "Pullback held a reference area" : "Continuation classification");
    return { setupType: "PULLBACK_CONTINUATION", notes };
  }
  if (regime === "FAST" && (input.trendStrength ?? 0) >= 55 && !isExtended(input, bias, atr, config)) {
    notes.push("FAST momentum continuation");
    return { setupType: "MOMENTUM_CONTINUATION", notes };
  }
  if (pullbackHold && (input.trendStrength ?? 0) >= 40) {
    notes.push("Controlled pullback into support/resistance");
    return { setupType: "PULLBACK_CONTINUATION", notes };
  }

  const throughResistance =
    bias === "BULLISH" &&
    present(input.nearbyResistance) &&
    input.price > input.nearbyResistance;
  const throughSupport =
    bias === "BEARISH" &&
    present(input.nearbySupport) &&
    input.price < input.nearbySupport;
  if ((throughResistance || throughSupport) && !isExtended(input, bias, atr, config)) {
    notes.push("Price through nearby structure");
    return { setupType: "BREAKOUT", notes };
  }

  const reversalCls = cls === "REJECTION";
  const htfExtremeOpposite =
    (bias === "BULLISH" && input.htfBias === "BEARISH" && (input.trendStrength ?? 0) >= 70) ||
    (bias === "BEARISH" && input.htfBias === "BULLISH" && (input.trendStrength ?? 0) >= 70);
  if (reversalCls && htfExtremeOpposite && pullbackHold) {
    notes.push("Conservative reversal at level");
    return { setupType: "REVERSAL", notes };
  }

  if (input.v3Decision === "BUY" && bias === "BULLISH") {
    notes.push("V3 BUY used as supporting setup evidence");
    return { setupType: "PULLBACK_CONTINUATION", notes };
  }
  if (input.v3Decision === "SELL" && bias === "BEARISH") {
    notes.push("V3 SELL used as supporting setup evidence");
    return { setupType: "PULLBACK_CONTINUATION", notes };
  }
  return { setupType: null, notes: [] };
}

export function detectFastTrigger(
  input: FastAutoTradeInput,
  bias: FastBias
): { trigger: string | null; notes: string[] } {
  if (bias === "NEUTRAL") return { trigger: null, notes: [] };
  const notes: string[] = [];
  const cls = String(input.confirmationClassification ?? "").toUpperCase();
  const dir = input.confirmationDirection;
  const c = input.ohlcv;
  const prior = input.priorOhlcv;

  if (bias === "BULLISH" && dir === "BULLISH" && cls && cls !== "NONE") {
    notes.push(`Bullish ${cls.toLowerCase()} trigger`);
    return { trigger: `BULLISH_${cls}`, notes };
  }
  if (bias === "BEARISH" && dir === "BEARISH" && cls && cls !== "NONE") {
    notes.push(`Bearish ${cls.toLowerCase()} trigger`);
    return { trigger: `BEARISH_${cls}`, notes };
  }

  if (c && present(c.open) && present(c.close) && present(c.high) && present(c.low)) {
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);
    if (bias === "BULLISH" && c.close > c.open && range > 0 && lowerWick >= body * 0.6) {
      notes.push("Bullish rejection candle");
      return { trigger: "BULLISH_REJECTION_CANDLE", notes };
    }
    if (bias === "BEARISH" && c.close < c.open && range > 0 && upperWick >= body * 0.6) {
      notes.push("Bearish rejection candle");
      return { trigger: "BEARISH_REJECTION_CANDLE", notes };
    }
    if (
      bias === "BULLISH" &&
      prior &&
      present(prior.open) &&
      present(prior.close) &&
      prior.close < prior.open &&
      c.close > c.open &&
      c.close > prior.open &&
      c.open < prior.close
    ) {
      notes.push("Bullish engulfing");
      return { trigger: "BULLISH_ENGULFING", notes };
    }
    if (
      bias === "BEARISH" &&
      prior &&
      present(prior.open) &&
      present(prior.close) &&
      prior.close > prior.open &&
      c.close < c.open &&
      c.close < prior.open &&
      c.open > prior.close
    ) {
      notes.push("Bearish engulfing");
      return { trigger: "BEARISH_ENGULFING", notes };
    }
    if (bias === "BULLISH" && prior && present(prior.high) && c.close > prior.high) {
      notes.push("Micro structure break — prior high");
      return { trigger: "BULLISH_SWING_BREAK", notes };
    }
    if (bias === "BEARISH" && prior && present(prior.low) && c.close < prior.low) {
      notes.push("Micro structure break — prior low");
      return { trigger: "BEARISH_SWING_BREAK", notes };
    }
  }

  if (present(input.vwap)) {
    if (bias === "BULLISH" && input.price >= input.vwap && (c?.close ?? input.price) >= input.vwap) {
      if (present(c?.open) && c!.open < input.vwap) {
        notes.push("VWAP reclaim");
        return { trigger: "VWAP_RECLAIM", notes };
      }
    }
    if (bias === "BEARISH" && input.price <= input.vwap && (c?.close ?? input.price) <= input.vwap) {
      if (present(c?.open) && c!.open > input.vwap) {
        notes.push("VWAP loss");
        return { trigger: "VWAP_LOSS", notes };
      }
    }
  }

  if (input.v3Decision === "BUY" && bias === "BULLISH") {
    notes.push("V3 BUY used as supporting trigger");
    return { trigger: "V3_BUY_SUPPORT", notes };
  }
  if (input.v3Decision === "SELL" && bias === "BEARISH") {
    notes.push("V3 SELL used as supporting trigger");
    return { trigger: "V3_SELL_SUPPORT", notes };
  }
  return { trigger: null, notes: [] };
}

export function scoreFastQuality(args: {
  input: FastAutoTradeInput;
  regime: FastRegime;
  bias: FastBias;
  setupType: FastSetupType | null;
  trigger: string | null;
  tradeSpaceOk: boolean;
  extended: boolean;
  config?: FastAutoTradeConfig;
}): { score: number; accepted: string[]; missing: string[]; supporting: string[] } {
  const { input, regime, bias, setupType, trigger, tradeSpaceOk, extended } = args;
  const accepted: string[] = [];
  const missing: string[] = [];
  const supporting: string[] = [];
  let score = 0;

  if (bias !== "NEUTRAL") {
    score += 18;
    accepted.push(`${bias.toLowerCase()} directional bias`);
  }
  if (setupType) {
    score += 16;
    accepted.push(`setup ${setupType}`);
  }
  if (trigger) {
    score += 14;
    accepted.push(`trigger ${trigger}`);
  }
  if (tradeSpaceOk) {
    score += 8;
    accepted.push("enough trade space");
  } else {
    score -= 6;
  }
  if (!extended) {
    score += 6;
    accepted.push("not excessively extended");
  } else {
    score -= 10;
  }

  if (present(input.vwap)) {
    const aligned =
      (bias === "BULLISH" && input.price >= input.vwap) ||
      (bias === "BEARISH" && input.price <= input.vwap);
    if (aligned) {
      score += 5;
      supporting.push("VWAP alignment");
    } else {
      score += 1;
      supporting.push("VWAP present but not aligned");
    }
  } else {
    missing.push("VWAP");
  }

  if (present(input.ema21) || present(input.ema50)) {
    const emaOk =
      (bias === "BULLISH" &&
        ((present(input.ema21) && input.price >= input.ema21) ||
          (present(input.ema50) && input.price >= input.ema50))) ||
      (bias === "BEARISH" &&
        ((present(input.ema21) && input.price <= input.ema21) ||
          (present(input.ema50) && input.price <= input.ema50)));
    if (emaOk) {
      score += 5;
      supporting.push("EMA alignment");
    } else {
      score += 1;
      supporting.push("EMA present");
    }
  } else {
    missing.push("EMA");
  }

  if (present(input.poc) || present(input.vah) || present(input.val)) {
    score += 4;
    supporting.push("value-area reference");
  } else {
    missing.push("POC/VAH/VAL");
  }

  if (input.ohlcv?.volume != null && input.ohlcv.volume > 0) {
    score += 3;
    supporting.push("volume present");
  } else {
    missing.push("volume");
  }

  if (input.htfBias == null || input.htfBias === "NEUTRAL") {
    missing.push("HTF bias");
  } else if (input.htfBias === bias) {
    score += 5;
    supporting.push("higher-timeframe agrees");
  } else {
    score -= 6;
    supporting.push("higher-timeframe disagrees (modifier, not auto-reject)");
  }

  if ((input.trendStrength ?? 0) >= 55) {
    score += 4;
    supporting.push("momentum healthy");
  } else if ((input.trendStrength ?? 0) > 0 && (input.trendStrength ?? 0) < 35) {
    score -= 3;
  }

  if (regime === "FAST") {
    score += 4;
    supporting.push("FAST regime");
  } else if (regime === "CHOP") {
    score -= 8;
  } else if (regime === "QUIET") {
    score -= 3;
  }

  if (typeof input.setupScore === "number" && Number.isFinite(input.setupScore)) {
    const contrib = clamp(Math.abs(input.setupScore) / 20, 0, 5);
    score += contrib;
    supporting.push("V3 setup score used as contributor only");
  }

  if (input.confirmationClassification && input.confirmationClassification !== "NONE") {
    score += 3;
    supporting.push("candle classification present");
  }

  return {
    score: clamp(Math.round(score), 0, 100),
    accepted,
    missing,
    supporting
  };
}

export function hardSafetyVeto(input: FastAutoTradeInput): string | null {
  if (input.safety.accountIsLive || input.safety.accountEnvironment === "LIVE") {
    return "FAST_AUTOTRADE_V1_DEMO_ONLY";
  }
  if (input.safety.disconnected) return "WAIT_DANGEROUS";
  if (input.safety.duplicateActiveOrder) return "WAIT_DUPLICATE_SETUP";
  if (input.safety.dailyLossBreached || input.safety.riskLimitBreached) {
    return "WAIT_RISK_LIMIT";
  }
  if (input.safety.maxOpenReached) return "WAIT_RISK_LIMIT";
  if (input.safety.newsBlocked) return "WAIT_NEWS";
  if (input.quoteStale) return "WAIT_STALE_PRICE";
  if (
    input.quoteAgeSeconds != null &&
    input.quoteAgeSeconds > input.safety.maxQuoteAgeSeconds
  ) {
    return "WAIT_STALE_PRICE";
  }
  if (!marketOpen(input.marketStatus)) return "WAIT_MARKET_CLOSED";
  if (input.spread != null && input.spread > input.safety.spreadLimit) {
    return "WAIT_SPREAD";
  }
  if (!(input.price > 0) || input.dataQuality === "INVALID") {
    return "WAIT_MALFORMED_DATA";
  }
  return null;
}

/**
 * Next genuine forward barrier only.
 * BUY: resistance/VAH strictly above price. SELL: support/VAL strictly below.
 * A level already broken and behind price is structure/invalidation, not a target.
 * When several candidates sit ahead, the nearest one is the constraint.
 */
export function forwardTradeBarrier(
  input: FastAutoTradeInput,
  action: "BUY" | "SELL"
): number | null {
  if (action === "BUY") {
    const ahead = [input.nearbyResistance, input.vah].filter(
      (level): level is number => present(level) && level > input.price
    );
    if (!ahead.length) return null;
    return Math.min(...ahead);
  }
  const ahead = [input.nearbySupport, input.val].filter(
    (level): level is number => present(level) && level < input.price
  );
  if (!ahead.length) return null;
  return Math.max(...ahead);
}

/** Broken resistance (BUY) / support (SELL) used as structure, not as a forward target. */
export function brokenStructureLevel(
  input: FastAutoTradeInput,
  action: "BUY" | "SELL"
): number | null {
  if (action === "BUY") {
    const behind = [input.nearbyResistance, input.vah].filter(
      (level): level is number => present(level) && level < input.price
    );
    if (!behind.length) return null;
    return Math.max(...behind);
  }
  const behind = [input.nearbySupport, input.val].filter(
    (level): level is number => present(level) && level > input.price
  );
  if (!behind.length) return null;
  return Math.min(...behind);
}

function isValidInvalidationBehind(
  level: number | null | undefined,
  action: "BUY" | "SELL",
  entry: number
): level is number {
  if (!present(level)) return false;
  return action === "BUY" ? level < entry : level > entry;
}

function nearestInvalidationBehind(
  action: "BUY" | "SELL",
  entry: number,
  levels: Array<number | null | undefined>
): number | null {
  const valid = levels.filter((level): level is number =>
    isValidInvalidationBehind(level, action, entry)
  );
  if (!valid.length) return null;
  return action === "BUY" ? Math.max(...valid) : Math.min(...valid);
}

function firstInvalidationBehind(
  action: "BUY" | "SELL",
  entry: number,
  levels: Array<number | null | undefined>
): number | null {
  for (const level of levels) {
    if (isValidInvalidationBehind(level, action, entry)) return level;
  }
  return null;
}

/**
 * Structural invalidation behind entry. Never uses a level on the wrong side.
 * Breakout / retest: nearest valid structure wins, so a just-broken VAH /
 * resistance (BUY) or VAL / support (SELL) is not displaced by a distant VA.
 */
function selectStructuralStop(
  input: FastAutoTradeInput,
  action: "BUY" | "SELL",
  entry: number,
  setupType: FastSetupType | null | undefined
): number | null {
  const broken = brokenStructureLevel(input, action);
  const m1Extreme = action === "BUY" ? input.ohlcv?.low ?? null : input.ohlcv?.high ?? null;
  const nearby = action === "BUY" ? input.nearbySupport : input.nearbyResistance;
  const valueArea = action === "BUY" ? input.val : input.vah;
  const breakoutSetup = setupType === "BREAKOUT" || setupType === "BREAKOUT_RETEST";
  if (breakoutSetup) {
    return nearestInvalidationBehind(action, entry, [broken, nearby, valueArea, m1Extreme]);
  }
  return firstInvalidationBehind(
    action,
    entry,
    action === "BUY"
      ? [input.nearbySupport, input.val, broken, m1Extreme]
      : [input.nearbyResistance, input.vah, broken, m1Extreme]
  );
}

export function tradeSpaceOk(
  input: FastAutoTradeInput,
  action: "BUY" | "SELL",
  atr: number,
  config: FastAutoTradeConfig
): boolean {
  const need = atr * config.minimumTradeSpaceAtr;
  const barrier = forwardTradeBarrier(input, action);
  if (!present(barrier)) return true;
  if (action === "BUY") return barrier - input.price >= need;
  return input.price - barrier >= need;
}

export function buildFastGeometry(
  input: FastAutoTradeInput,
  action: "BUY" | "SELL",
  regime: FastRegime,
  config: FastAutoTradeConfig = DEFAULT_FAST_AUTOTRADE_CONFIG,
  setupType: FastSetupType | null = null
): FastGeometry | null {
  const atr = estimateAtr(input, config);
  const entry = input.price;
  const swingSl = selectStructuralStop(input, action, entry, setupType);
  let sl: number;
  if (present(swingSl)) {
    sl =
      action === "BUY"
        ? Math.min(swingSl, entry - atr * 0.35)
        : Math.max(swingSl, entry + atr * 0.35);
  } else {
    sl = action === "BUY" ? entry - atr * config.atrStopMultiplier : entry + atr * config.atrStopMultiplier;
  }
  if (action === "BUY" && !(sl < entry)) {
    sl = entry - atr * config.atrStopMultiplier;
  } else if (action === "SELL" && !(sl > entry)) {
    sl = entry + atr * config.atrStopMultiplier;
  }
  const risk = Math.abs(entry - sl);
  if (!(risk > 0)) return null;
  const tpMult = regime === "FAST" ? config.atrTpMultiplierFast : config.atrTpMultiplierNormal;
  const barrier = forwardTradeBarrier(input, action);
  const atrTarget = atr * tpMult;
  const space = present(barrier)
    ? action === "BUY"
      ? barrier - entry
      : entry - barrier
    : atrTarget;
  const rawTpDist = Math.min(atr * tpMult, Math.max(space * 0.7, risk * config.minRiskReward));
  const tpDist = Math.max(rawTpDist, risk * config.minRiskReward);
  const tp = action === "BUY" ? entry + tpDist : entry - tpDist;
  const tp2Dist = tpDist * 1.6;
  const tp2 = action === "BUY" ? entry + tp2Dist : entry - tp2Dist;
  if (action === "BUY" && !(sl < entry && tp > entry)) return null;
  if (action === "SELL" && !(sl > entry && tp < entry)) return null;
  return {
    entry,
    stopLoss: sl,
    takeProfit: tp,
    takeProfit2: tp2,
    riskReward: tpDist / risk
  };
}

function structureAnchor(input: FastAutoTradeInput, setup: FastSetupType, bias: FastBias): string {
  const level =
    bias === "BULLISH"
      ? input.nearbySupport ?? input.val ?? input.poc ?? input.vwap ?? input.price
      : input.nearbyResistance ?? input.vah ?? input.poc ?? input.vwap ?? input.price;
  return `${setup}:${bias}:${Math.round(level * 10) / 10}`;
}

export function candleKey(input: FastAutoTradeInput): string {
  const c = input.ohlcv;
  if (!c) return `${input.timeframe ?? "na"}:${Math.round(input.price * 10) / 10}`;
  return `${input.timeframe ?? "na"}:${c.open ?? ""}:${c.high ?? ""}:${c.low ?? ""}:${c.close ?? ""}`;
}

export function evaluateFastReentry(
  input: FastAutoTradeInput,
  identity: FastSetupIdentity,
  config: FastAutoTradeConfig = DEFAULT_FAST_AUTOTRADE_CONFIG
): FastWaitReason | null {
  const prev = input.reentry.lastSetup;
  if (prev) {
    const same =
      setupIdentityKey(prev) === setupIdentityKey(identity) &&
      input.nowMs - Date.parse(prev.timestamp) < config.duplicateSetupWindowMs;
    if (same) return "WAIT_DUPLICATE_SETUP";
  }
  if (
    input.reentry.currentCandleKey &&
    input.reentry.currentCandleKey === candleKey(input) &&
    input.reentry.lastSignalKey === setupIdentityKey(identity)
  ) {
    return "WAIT_SAME_CANDLE";
  }
  if (
    input.reentry.lastExitAtMs != null &&
    input.nowMs - input.reentry.lastExitAtMs < config.reentryDelayMs &&
    prev != null &&
    setupIdentityKey(prev) === setupIdentityKey(identity)
  ) {
    return "WAIT_REENTRY_DELAY";
  }
  return null;
}

function telemetryOf(
  input: FastAutoTradeInput,
  action: FastAction,
  regime: FastRegime,
  setupType: FastSetupType | null,
  score: number,
  grade: FastGrade,
  reason: FastWaitReason | null,
  supporting: string[],
  missing: string[],
  hardVeto: string | null,
  spaceOk: boolean,
  extended: boolean
): FastMissedOpportunity {
  return {
    direction: action,
    setupType,
    score,
    grade,
    regime,
    price: input.price,
    timestamp: new Date(input.nowMs).toISOString(),
    rejectionReason: reason,
    supportingEvidence: supporting,
    missingEvidence: missing,
    hardVeto,
    tradeSpaceOk: spaceOk,
    extended
  };
}

export function evaluateFastAutoTrade(
  input: FastAutoTradeInput,
  config: FastAutoTradeConfig = DEFAULT_FAST_AUTOTRADE_CONFIG
): FastAutoTradeDecision {
  const regime = classifyFastRegime(input, config);
  const bias = determineFastBias(input);
  const veto = hardSafetyVeto(input);
  const setup = detectFastSetup(input, bias, regime, config);
  const trig = detectFastTrigger(input, bias);
  const atr = estimateAtr(input, config);
  const intended: FastAction =
    bias === "BULLISH" ? "BUY" : bias === "BEARISH" ? "SELL" : "WAIT";
  const extended = isExtended(input, bias, atr, config);
  const spaceOk =
    intended === "WAIT" ? false : tradeSpaceOk(input, intended, atr, config);
  const scored = scoreFastQuality({
    input,
    regime,
    bias,
    setupType: setup.setupType,
    trigger: trig.trigger,
    tradeSpaceOk: spaceOk,
    extended,
    config
  });
  const grade = gradeForScore(scored.score, config);
  const accepted = [...scored.accepted, ...setup.notes, ...trig.notes];
  const supporting = scored.supporting;
  const missing = scored.missing;

  const fail = (
    action: FastAction,
    waitReason: FastWaitReason,
    hard: string | null,
    extraRejected: string[] = []
  ): FastAutoTradeDecision => ({
    strategyId: FAST_AUTOTRADE_STRATEGY_ID,
    action: "WAIT",
    regime,
    bias,
    setupType: setup.setupType,
    trigger: trig.trigger,
    qualityScore: scored.score,
    grade,
    waitReason,
    hardVeto: hard,
    accepted,
    rejected: [waitReason, ...extraRejected],
    missing,
    supporting,
    identity: null,
    geometry: null,
    lifecycleState: "SCANNING",
    signalId: null,
    tradeSpaceOk: spaceOk,
    extended,
    telemetry: telemetryOf(
      input,
      action,
      regime,
      setup.setupType,
      scored.score,
      grade,
      waitReason,
      supporting,
      missing,
      hard,
      spaceOk,
      extended
    )
  });

  if (veto) {
    const reason = (veto === "FAST_AUTOTRADE_V1_DEMO_ONLY"
      ? "FAST_AUTOTRADE_V1_DEMO_ONLY"
      : veto) as FastWaitReason;
    return fail(intended, reason, veto);
  }
  if (input.requireCompletedM1) {
    if (input.m1Availability === "STALE") {
      return fail(intended, "WAIT_M1_STALE", "WAIT_M1_STALE");
    }
    const m1OhlcReady =
      input.m1Availability === "OK" &&
      input.timeframe === "1" &&
      present(input.ohlcv?.open) &&
      present(input.ohlcv?.high) &&
      present(input.ohlcv?.low) &&
      present(input.ohlcv?.close);
    if (!m1OhlcReady) {
      return fail(intended, "WAIT_M1_UNAVAILABLE", "WAIT_M1_UNAVAILABLE");
    }
  }
  if (regime === "DANGEROUS") return fail(intended, "WAIT_DANGEROUS", "DANGEROUS");
  if (regime === "CHOP" && scored.score < config.chopEntryScore) {
    return fail(intended, "WAIT_CHOP", null);
  }
  if (bias === "NEUTRAL") return fail("WAIT", "WAIT_NEUTRAL_BIAS", null);
  if (!setup.setupType) return fail(intended, "WAIT_NO_SETUP", null);
  if (!trig.trigger) return fail(intended, "WAIT_TRIGGER_NOT_CONFIRMED", null);
  if (extended) return fail(intended, "WAIT_EXTENDED", null);
  if (!spaceOk) return fail(intended, "WAIT_NO_TRADE_SPACE", null);
  if ((input.trendStrength ?? 100) < 22 && setup.setupType !== "REVERSAL") {
    return fail(intended, "WAIT_LOW_MOMENTUM", null);
  }

  const threshold = entryThresholdForRegime(regime, config);
  if (scored.score < threshold || grade === "BELOW") {
    return fail(intended, "WAIT_LOW_QUALITY", null);
  }
  if (regime !== "FAST" && grade === "B+") {
    return fail(intended, "WAIT_LOW_QUALITY", null, ["B+_NOT_PERMITTED_OUTSIDE_FAST"]);
  }
  if (setup.setupType === "REVERSAL" && scored.score < config.aMin) {
    return fail(intended, "WAIT_LOW_QUALITY", null, ["REVERSAL_NEEDS_A"]);
  }

  if (intended !== "BUY" && intended !== "SELL") {
    return fail("WAIT", "WAIT_NEUTRAL_BIAS", null);
  }
  const identity: FastSetupIdentity = {
    direction: intended,
    setupType: setup.setupType,
    structureAnchor: structureAnchor(input, setup.setupType, bias),
    triggerCandle: candleKey(input),
    timestamp: new Date(input.nowMs).toISOString()
  };
  const reentry = evaluateFastReentry(input, identity, config);
  if (reentry) return fail(intended, reentry, null);

  if (
    shouldBlockFlap({
      lastAction: input.reentry.lastAction,
      lastActionAtMs: input.reentry.lastActionAtMs,
      nextAction: intended,
      nowMs: input.nowMs,
      flapGuardMs: config.flapGuardMs
    })
  ) {
    return fail(intended, "WAIT_FLAP_GUARD", null);
  }

  const geometry = buildFastGeometry(input, intended, regime, config, setup.setupType);
  if (!geometry) return fail(intended, "WAIT_NO_TRADE_SPACE", null);

  const signalId = `fast_${intended}_${setup.setupType}_${identity.structureAnchor}_${identity.triggerCandle}`.replace(
    /[^A-Za-z0-9:_-]/g,
    "_"
  );

  return {
    strategyId: FAST_AUTOTRADE_STRATEGY_ID,
    action: intended,
    regime,
    bias,
    setupType: setup.setupType,
    trigger: trig.trigger,
    qualityScore: scored.score,
    grade,
    waitReason: null,
    hardVeto: null,
    accepted,
    rejected: [],
    missing,
    supporting,
    identity,
    geometry,
    lifecycleState: "ENTRY_PENDING",
    signalId,
    tradeSpaceOk: spaceOk,
    extended,
    telemetry: telemetryOf(
      input,
      intended,
      regime,
      setup.setupType,
      scored.score,
      grade,
      null,
      supporting,
      missing,
      null,
      spaceOk,
      extended
    )
  };
}
