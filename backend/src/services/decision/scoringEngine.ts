import { decisionConfig } from "../../config/decisionConfig";
import type { MarketSnapshot, ScoreResult, TrendDirection } from "../../models/types";

const directionSign = (direction: TrendDirection | undefined): number => {
  if (direction === "BULLISH") {
    return 1;
  }
  if (direction === "BEARISH") {
    return -1;
  }
  return 0;
};

const clampScore = (score: number): number => Math.max(-100, Math.min(100, Math.round(score)));

const relationToPoc = (
  price: number | null,
  poc: number | null | undefined
): "ABOVE" | "BELOW" | "NEAR" | "UNKNOWN" => {
  if (!price || poc === null || poc === undefined) {
    return "UNKNOWN";
  }
  const distance = Math.abs(price - poc);
  if (distance / poc < 0.0005) {
    return "NEAR";
  }
  return price > poc ? "ABOVE" : "BELOW";
};

export const scoreSnapshot = (snapshot: MarketSnapshot): ScoreResult => {
  let score = 0;
  const bullishEvidence: string[] = [];
  const bearishEvidence: string[] = [];
  const reasonCodes: string[] = [];
  const weights = decisionConfig.scoringWeights;

  // Higher / primary timeframe trend alignment (components kept independent)
  const components = snapshot.trend?.components ?? [];
  if (components.length > 0) {
    let componentScore = 0;
    for (const component of components) {
      const contribution =
        directionSign(component.direction) * (component.strength / 100) * (weights.trendComponent / components.length);
      componentScore += contribution;
      if (component.direction === "BULLISH") {
        bullishEvidence.push(`${component.name} (${component.sourceTimeframe}) bullish ${component.strength}`);
      } else if (component.direction === "BEARISH") {
        bearishEvidence.push(`${component.name} (${component.sourceTimeframe}) bearish ${component.strength}`);
      }
    }
    score += componentScore;
    reasonCodes.push("TREND_COMPONENTS");
  }

  const trendDirection = snapshot.trend?.direction;
  const trendStrength = snapshot.trend?.strength ?? 0;
  score += directionSign(trendDirection) * weights.trendDirection * (trendStrength / 100);
  if (trendDirection === "BULLISH") {
    bullishEvidence.push(`Aggregate trend bullish strength ${trendStrength}`);
    reasonCodes.push("TREND_BULLISH");
  } else if (trendDirection === "BEARISH") {
    bearishEvidence.push(`Aggregate trend bearish strength ${trendStrength}`);
    reasonCodes.push("TREND_BEARISH");
  }

  // Position relative to POC / VAH / VAL
  const poc = snapshot.levels?.pocAll ?? snapshot.sessionVolumeProfile?.poc ?? null;
  const vah = snapshot.levels?.vahAll ?? snapshot.sessionVolumeProfile?.vah ?? null;
  const val = snapshot.levels?.valAll ?? snapshot.sessionVolumeProfile?.val ?? null;
  const pocRelation = relationToPoc(snapshot.price, poc);

  if (pocRelation === "ABOVE") {
    score += weights.pocPosition;
    bullishEvidence.push("Price trading above POC");
    reasonCodes.push("PRICE_ABOVE_POC");
  } else if (pocRelation === "BELOW") {
    score -= weights.pocPosition;
    bearishEvidence.push("Price trading below POC");
    reasonCodes.push("PRICE_BELOW_POC");
  }

  if (snapshot.price && vah !== null && val !== null) {
    if (snapshot.price >= val && snapshot.price <= vah) {
      reasonCodes.push("INSIDE_VALUE_AREA");
    } else if (snapshot.price > vah) {
      score += weights.valueAreaPosition;
      bullishEvidence.push("Price accepted above VAH");
      reasonCodes.push("ABOVE_VAH");
    } else if (snapshot.price < val) {
      score -= weights.valueAreaPosition;
      bearishEvidence.push("Price accepted below VAL");
      reasonCodes.push("BELOW_VAL");
    }
  }

  // Non-broken level interaction
  const interacting = [
    ...(snapshot.levels?.pocNonBroken ?? []),
    ...(snapshot.levels?.vahNonBroken ?? []),
    ...(snapshot.levels?.valNonBroken ?? [])
  ].find((level) => level.relation === "INTERACTING");
  if (interacting) {
    score += directionSign(trendDirection) * weights.levelInteraction;
    reasonCodes.push("LEVEL_INTERACTION");
    if (trendDirection === "BULLISH") {
      bullishEvidence.push(`Interacting with non-broken level at ${interacting.price}`);
    } else if (trendDirection === "BEARISH") {
      bearishEvidence.push(`Interacting with non-broken level at ${interacting.price}`);
    }
  }

  // Confirmation candle + classification
  const candle = snapshot.confirmationCandle;
  const candleDirection = candle?.direction;
  const candleSign = directionSign(candleDirection);
  if (candle?.confirmed) {
    score += candleSign * weights.confirmationCandle;
    const classification = candle.classification ?? "NONE";
    if (classification === "REJECTION") {
      score += candleSign * weights.rejectionConfirmation;
      reasonCodes.push("REJECTION_CONFIRMATION");
    } else if (classification === "BREAKOUT" || classification === "RETEST") {
      score += candleSign * weights.breakoutRetest;
      reasonCodes.push("BREAKOUT_OR_RETEST");
    }
    if (candleDirection === "BULLISH") {
      bullishEvidence.push(`Confirmed ${classification.toLowerCase()} candle`);
      reasonCodes.push("CANDLE_BULLISH");
    } else if (candleDirection === "BEARISH") {
      bearishEvidence.push(`Confirmed ${classification.toLowerCase()} candle`);
      reasonCodes.push("CANDLE_BEARISH");
    }
  }

  // TPO value migration
  const valueMigration = snapshot.marketProfile?.valueMigration;
  if (valueMigration === "UP") {
    score += weights.valueMigration;
    bullishEvidence.push("Market profile value migration up");
    reasonCodes.push("VALUE_MIGRATION_UP");
  } else if (valueMigration === "DOWN") {
    score -= weights.valueMigration;
    bearishEvidence.push("Market profile value migration down");
    reasonCodes.push("VALUE_MIGRATION_DOWN");
  }

  // Session / HVN acceptance
  const acceptance = snapshot.sessionVolumeProfile?.acceptanceState ?? snapshot.marketProfile?.acceptanceState;
  if (acceptance === "ACCEPTANCE" && candleSign !== 0) {
    score += candleSign * weights.acceptance;
    reasonCodes.push(candleSign > 0 ? "ACCEPTANCE_BULLISH" : "ACCEPTANCE_BEARISH");
  } else if (acceptance === "REJECTION" && candleSign !== 0) {
    score += candleSign * weights.rejectionConfirmation;
    reasonCodes.push("SESSION_REJECTION");
  }

  // Multi-timeframe agreement bonus / conflict penalty
  const bullishComponents = components.filter((c) => c.direction === "BULLISH").length;
  const bearishComponents = components.filter((c) => c.direction === "BEARISH").length;
  if (bullishComponents >= 2 && bearishComponents === 0) {
    score += weights.multiTimeframeAgreement;
    bullishEvidence.push("Multi-timeframe bullish agreement");
    reasonCodes.push("MTF_BULLISH_AGREE");
  } else if (bearishComponents >= 2 && bullishComponents === 0) {
    score -= weights.multiTimeframeAgreement;
    bearishEvidence.push("Multi-timeframe bearish agreement");
    reasonCodes.push("MTF_BEARISH_AGREE");
  } else if (bullishComponents > 0 && bearishComponents > 0) {
    score -= Math.sign(score) * weights.conflictingEvidence;
    reasonCodes.push("MTF_CONFLICT");
  }

  const setupScore = clampScore(score);
  const marketRegime =
    trendDirection === "BULLISH"
      ? "TRENDING_UP"
      : trendDirection === "BEARISH"
        ? "TRENDING_DOWN"
        : trendDirection === "NEUTRAL"
          ? "RANGING"
          : "UNKNOWN";

  return {
    score: setupScore,
    bullishEvidence: [...new Set(bullishEvidence)],
    bearishEvidence: [...new Set(bearishEvidence)],
    reasonCodes: [...new Set(reasonCodes)],
    marketRegime,
    confirmations: reasonCodes.filter((code) =>
      ["CANDLE_BULLISH", "CANDLE_BEARISH", "REJECTION_CONFIRMATION", "BREAKOUT_OR_RETEST", "MTF_BULLISH_AGREE", "MTF_BEARISH_AGREE"].includes(
        code
      )
    ).length
  };
};

export const directionFromScore = (score: number): "BUY" | "SELL" | "WAIT" => {
  if (score >= decisionConfig.thresholds.buy) {
    return "BUY";
  }
  if (score <= decisionConfig.thresholds.sell) {
    return "SELL";
  }
  return "WAIT";
};
