/**
 * GoldMeta V4 — profit-first engine configuration (research / shadow).
 * Does not replace production V3 decision outputs.
 */
export const V4_STRATEGY_VERSION = "4";
export const V4_PROFILE_VERSION = "profile-4.0.0";
export const V4_CONFIG_VERSION = "v4-config-1.0.0";
export const V4_ENGINE_VERSION = "1.0.0-v4-stage-a";

export type V4StrategyFamily = "VALUE_BREAKOUT_RETEST" | "FAILED_AUCTION_REVERSAL";
export type V4DeploymentStage = "RESEARCH" | "LIVE_SHADOW" | "REVIEW" | "MANUAL_FORWARD" | "DEMO_API";

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

/** Stage A default: research + optional shadow compute. Never actionable. */
export const v4Config = {
  strategyVersion: V4_STRATEGY_VERSION,
  profileVersion: V4_PROFILE_VERSION,
  configVersion: V4_CONFIG_VERSION,
  engineVersion: V4_ENGINE_VERSION,
  deploymentStage: (process.env.V4_DEPLOYMENT_STAGE as V4DeploymentStage) || "RESEARCH",

  flags: {
    /** Compute V4 in parallel after V3; never mutates V3 decision/setup. */
    shadowComputeEnabled: envBool("V4_SHADOW_COMPUTE_ENABLED", true),
    /** Persist shadow candidates/outcomes. */
    shadowPersistEnabled: envBool("V4_SHADOW_PERSIST_ENABLED", true),
    /** Show V4 as actionable LIVE locked plans — Stage D only; hard off. */
    actionableLiveEnabled: false,
    /** ML meta-filter — abstain until calibrated; never generates direction. */
    mlMetaFilterEnabled: envBool("V4_ML_META_FILTER_ENABLED", false)
  },

  symbol: "XAUUSD" as const,
  setupTimeframe: "15" as const,
  regimeTimeframe: "60" as const,

  /** POC treated as a zone, not a tick. */
  pocZone: {
    minAbsPoints: 0.5,
    atrMult: 0.15,
    tickSize: 0.01
  },

  profileGates: {
    minBars: 8,
    minVolumeObservations: 1,
    maxAgeMs: 6 * 60 * 60 * 1000,
    minValueAreaWidth: 0.5
  },

  confirmation: {
    minBars: 2,
    candidateExpiryBars: 6
  },

  stop: {
    atrMinMult: 0.35,
    spreadSafetyFactor: 3,
    absoluteMinPoints: 1.5,
    maxAtrMult: 2.5,
    neverExactAtValueBoundary: true
  },

  targets: {
    rMultiples: [1, 2, 3] as const,
    minNetRrToTp1AfterCosts: 0.8,
    minNetRrToTp2AfterCosts: 1.4
  },

  costs: {
    /** Conservative estimate labels — not exact broker quotes. */
    estimateOnly: true as const,
    defaultSpreadPointsBySession: {
      ASIA: 0.45,
      LONDON: 0.35,
      OVERLAP: 0.4,
      NEWYORK: 0.35,
      UNKNOWN: 0.5
    } as Record<string, number>,
    slippagePoints: 0.15,
    overnightFinancingPerDayPoints: 0
  },

  quality: {
    weights: {
      marketStructure: 20,
      higherTimeframeAgreement: 15,
      valueProfileContext: 15,
      confirmationQuality: 15,
      pocMigration: 10,
      volatilitySuitability: 10,
      sessionQuality: 5,
      volumeConfirmation: 5,
      rewardGeometry: 5
    },
    minActionableQuality: 70
  },

  news: {
    blackoutMinutesBefore: 30,
    blackoutMinutesAfter: 20
  },

  acceptance: {
    minHistoricalResolved: 200,
    minShadowResolved: 50,
    minProfitFactor: 1.2,
    minNetExpectancyR: 0
  },

  maxActiveLockedPlans: 1
};

export type V4Config = typeof v4Config;
