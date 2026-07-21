import { v4Config } from "./config";
import type { V4GateCode, V4QualityScore, V4VolumeProfile } from "./types";
import type { StrategyPatternHit } from "./strategies";
import type { V4CostEstimate, V4StopResult, V4TargetSet } from "./types";
import type { V4Regime } from "./types";

export interface GateContext {
  barConfirmed: boolean;
  marketDataValid: boolean;
  profile: V4VolumeProfile | null;
  profileConflict: boolean;
  regime: V4Regime;
  session: string;
  pattern: StrategyPatternHit | null;
  confirmationBars: number;
  atr: number | null;
  stop: V4StopResult | null;
  targets: V4TargetSet | null;
  costs: V4CostEstimate | null;
  hasActiveLockedPlan: boolean;
  newsBlackout: boolean;
  staleEvent: boolean;
  duplicateEvent: boolean;
  mlDecision: "ACCEPT" | "REJECT" | "ABSTAIN" | "DISABLED";
}

export function evaluateMandatoryGates(ctx: GateContext): {
  passed: boolean;
  failures: V4GateCode[];
  reasons: string[];
} {
  const failures: V4GateCode[] = [];
  const reasons: string[] = [];

  const fail = (code: V4GateCode, reason: string) => {
    failures.push(code);
    reasons.push(reason);
  };

  if (!ctx.barConfirmed) fail("UNCONFIRMED_BAR", "Bar not confirmed — no unfinished candles");
  if (!ctx.marketDataValid) fail("INVALID_MARKET_DATA", "Market data invalid or incomplete");
  if (!ctx.profile?.valid) fail("INVALID_PROFILE", ctx.profile?.invalidReasons.join("; ") || "Invalid profile");
  if (ctx.profileConflict) {
    reasons.push("XAUUSD vs COMEX GC profiles conflict — quality reduced (not hard fail alone)");
  }
  if (ctx.newsBlackout) fail("NEWS_BLACKOUT", "High-impact USD event blackout");
  if (ctx.staleEvent) fail("STALE_EVENT", "Stale event");
  if (ctx.duplicateEvent) fail("DUPLICATE_EVENT", "Duplicate event");
  if (ctx.hasActiveLockedPlan) fail("ACTIVE_LOCKED_SETUP", "One active locked plan maximum");
  if (ctx.atr == null || ctx.atr <= 0) fail("INVALID_ATR", "ATR unavailable");
  if (!ctx.pattern) fail("NO_STRATEGY_PATTERN", "No approved strategy pattern");
  if (ctx.confirmationBars < v4Config.confirmation.minBars) {
    fail("CONFIRMATION_INCOMPLETE", "Multi-bar confirmation incomplete");
  }
  if (ctx.stop?.rejected) {
    fail("NO_TRADE_INVALID_RISK_GEOMETRY", ctx.stop.rejectReason || "Invalid stop geometry");
  }
  if (ctx.targets?.rejected) {
    fail("INSUFFICIENT_REWARD_AFTER_COSTS", ctx.targets.rejectReason || "Targets rejected");
  }
  if (ctx.costs?.netRrTp2 != null && ctx.costs.netRrTp2 < v4Config.targets.minNetRrToTp2AfterCosts) {
    fail("INSUFFICIENT_REWARD_AFTER_COSTS", `Net RR to TP2 after costs ${ctx.costs.netRrTp2}`);
  }
  if (ctx.mlDecision === "REJECT") fail("ML_REJECT", "ML meta-filter rejected setup");
  if (ctx.mlDecision === "ABSTAIN" && v4Config.flags.mlMetaFilterEnabled) {
    fail("ML_ABSTAIN", "ML meta-filter abstained");
  }

  return { passed: failures.length === 0, failures, reasons };
}

/**
 * Quality score ONLY after mandatory gates pass.
 * Not win probability.
 */
export function scoreSetupQuality(input: {
  pattern: StrategyPatternHit;
  regime: V4Regime;
  profile: V4VolumeProfile;
  confirmationBars: number;
  atrPercentile: number | null;
  session: string;
  gcConfirmed: boolean;
  profileConflict: boolean;
  netRrTp2: number | null;
}): V4QualityScore {
  const w = v4Config.quality.weights;
  const components: Record<string, number> = {
    marketStructure: Math.min(w.marketStructure, 12 + input.confirmationBars * 2),
    higherTimeframeAgreement:
      input.regime.includes("UP") && input.pattern.direction === "BUY"
        ? w.higherTimeframeAgreement
        : input.regime.includes("DOWN") && input.pattern.direction === "SELL"
          ? w.higherTimeframeAgreement
          : Math.round(w.higherTimeframeAgreement * 0.4),
    valueProfileContext: input.profile.valid ? w.valueProfileContext : 0,
    confirmationQuality: Math.min(w.confirmationQuality, input.confirmationBars * 5),
    pocMigration:
      (input.pattern.direction === "BUY" && input.profile.pocMigration === "UP") ||
      (input.pattern.direction === "SELL" && input.profile.pocMigration === "DOWN")
        ? w.pocMigration
        : Math.round(w.pocMigration * 0.4),
    volatilitySuitability:
      input.atrPercentile == null
        ? Math.round(w.volatilitySuitability * 0.5)
        : input.atrPercentile > 20 && input.atrPercentile < 85
          ? w.volatilitySuitability
          : Math.round(w.volatilitySuitability * 0.3),
    sessionQuality: ["LONDON", "OVERLAP", "NEWYORK"].includes(input.session)
      ? w.sessionQuality
      : Math.round(w.sessionQuality * 0.4),
    volumeConfirmation: input.gcConfirmed
      ? w.volumeConfirmation
      : input.profileConflict
        ? 0
        : Math.round(w.volumeConfirmation * 0.4),
    rewardGeometry:
      input.netRrTp2 != null && input.netRrTp2 >= v4Config.targets.minNetRrToTp2AfterCosts
        ? w.rewardGeometry
        : 0
  };

  const total = Math.min(
    100,
    Object.values(components).reduce((a, b) => a + b, 0)
  );

  return {
    total: Math.round(total),
    max: 100,
    components,
    disclaimer: "This is a rules-based setup quality score, not the probability of profit."
  };
}
