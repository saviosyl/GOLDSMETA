/**
 * GoldMeta V4 — Stage B LIVE SHADOW configuration.
 * Fail-closed: never actionable, never brokers, never mutates V3.
 */
export const V4_STRATEGY_VERSION = "4";
export const V4_PROFILE_VERSION = "profile-4.0.0";
export const V4_CONFIG_VERSION = "v4-config-1.1.0-stage-b";
export const V4_ENGINE_VERSION = "1.1.0-v4-stage-b";

export type V4StrategyFamily = "VALUE_BREAKOUT_RETEST" | "FAILED_AUCTION_REVERSAL";
export type V4DeploymentStage = "RESEARCH" | "LIVE_SHADOW" | "REVIEW" | "MANUAL_FORWARD" | "DEMO_API";

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

/** Stage B: LIVE shadow collect. Actionable paths hard-off. */
export const v4Config = {
  strategyVersion: V4_STRATEGY_VERSION,
  profileVersion: V4_PROFILE_VERSION,
  configVersion: V4_CONFIG_VERSION,
  engineVersion: V4_ENGINE_VERSION,
  deploymentStage:
    (process.env.V4_DEPLOYMENT_STAGE as V4DeploymentStage) || "LIVE_SHADOW",
  mode: "SHADOW" as const,

  flags: {
    /** Compute V4 after V3 is stored; non-fatal. */
    shadowComputeEnabled: envBool("V4_SHADOW_COMPUTE_ENABLED", true),
    /** Persist + advance shadow candidates/plans. */
    shadowLifecycleEnabled: envBool("V4_SHADOW_LIFECYCLE_ENABLED", true),
    /** Persist analysis/candidate/plan docs. */
    shadowPersistEnabled: envBool("V4_SHADOW_PERSIST_ENABLED", true),
    /** HARD OFF — Stage D only. */
    actionableSetupEnabled: false,
    liveSetupCreation: false,
    notificationsEnabled: false,
    /** ML meta-filter — abstain until calibrated. */
    mlMetaFilterEnabled: envBool("V4_ML_META_FILTER_ENABLED", false)
  },

  symbol: "XAUUSD" as const,
  setupTimeframe: "15" as const,
  regimeTimeframe: "60" as const,

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
    /** Shadow validation threshold (not a trade recommendation). */
    minShadowPlanQuality: 70,
    /** Penalty when GC confirmation unavailable. */
    missingGcQualityPenalty: 5
  },

  news: {
    blackoutMinutesBefore: 30,
    blackoutMinutesAfter: 20
  },

  lifecycle: {
    entryExpiryBars: 8,
    maxBarsInTrade: 32,
    maxBarSkewMs: 24 * 60 * 60 * 1000
  },

  acceptance: {
    minHistoricalResolved: 200,
    minShadowResolved: 50,
    minProfitFactor: 1.2,
    minNetExpectancyR: 0
  },

  maxActiveShadowPlans: 1
};

export type V4Config = typeof v4Config;

/** Fail-closed snapshot for diagnostics / UI. */
export function v4FlagSnapshot(): Record<string, unknown> {
  return {
    V4_SHADOW_COMPUTE_ENABLED: v4Config.flags.shadowComputeEnabled,
    V4_SHADOW_LIFECYCLE_ENABLED: v4Config.flags.shadowLifecycleEnabled,
    V4_ACTIONABLE_SETUP_ENABLED: v4Config.flags.actionableSetupEnabled,
    V4_LIVE_SETUP_CREATION: v4Config.flags.liveSetupCreation,
    V4_NOTIFICATIONS_ENABLED: v4Config.flags.notificationsEnabled,
    V4_ML_META_FILTER_ENABLED: v4Config.flags.mlMetaFilterEnabled,
    V4_DEPLOYMENT_STAGE: v4Config.deploymentStage,
    strategyVersion: v4Config.strategyVersion,
    engineVersion: v4Config.engineVersion,
    configVersion: v4Config.configVersion,
    mode: v4Config.mode,
    actionable: false
  };
}
