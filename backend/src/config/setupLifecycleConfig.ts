/**
 * Versioned XAUUSD intraday setup / risk configuration (server-side).
 * Feature flags support staged rollout (Stage 1–4). No broker execution switches.
 */
export const SETUP_RULE_CONFIG_VERSION = "setup-rules-1.0.0";
/** Alias used by tests and reports. */
export const SETUP_RULES_VERSION = SETUP_RULE_CONFIG_VERSION;
export const BACKEND_VERSION_PHASE3 = "1.3.1-v4-stage-b";

export type UtcSessionName = "ASIA" | "LONDON" | "OVERLAP" | "NEWYORK" | "UNKNOWN";

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

function envEnvs(name: string, fallback: Array<"TEST" | "LIVE">): Array<"TEST" | "LIVE"> {
  const v = process.env[name];
  if (!v || !v.trim()) return fallback;
  return v
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is "TEST" | "LIVE" => s === "LIVE" || s === "TEST");
}

export const setupLifecycleConfig = {
  version: SETUP_RULE_CONFIG_VERSION,
  symbol: "XAUUSD" as const,
  timeframe: "15" as const,

  /**
   * Kill switches / staged rollout (server-controlled).
   * Stage 1: SETUP_TRACKING_ENABLED=false
   * Stage 2 (default): TEST only
   * Stage 3: SETUP_TRACKING_ENVIRONMENTS=TEST,LIVE
   * Override: SETUP_TRACKING_ENABLED, SETUP_TRACKING_ENVIRONMENTS,
   *           NEW_SETUP_CREATION_ENABLED, SETUP_BAR_UPDATES_ENABLED
   */
  flags: {
    /** Master: analysis / decision generation (existing TV pipeline stays on). */
    analysisGenerationEnabled: envBool("ANALYSIS_GENERATION_ENABLED", true),
    /** Create SetupRecord from BUY/SELL decisions. */
    newSetupCreationEnabled: envBool("NEW_SETUP_CREATION_ENABLED", true),
    /** Apply bar follow-up to active setups. */
    setupTrackingEnabled: envBool("SETUP_TRACKING_ENABLED", true),
    /** Stage 3 default: TEST + LIVE. Override via SETUP_TRACKING_ENVIRONMENTS. */
    setupTrackingEnvironments: envEnvs("SETUP_TRACKING_ENVIRONMENTS", ["TEST", "LIVE"]),
    /**
     * LIVE money / broker execution — hard off for Phase 3.
     * BROKER_EXECUTION_ENABLED / BROKER_MODE fail closed: live never enables.
     */
    brokerLiveExecutionEnabled: false,
    /** Explicit mirror of BROKER_EXECUTION_ENABLED — always false in Phase 3. */
    brokerExecutionEnabled: false,
    /** DISABLED | DEMO | LIVE — LIVE never grants execution. */
    brokerMode: ((): "DISABLED" | "DEMO" | "LIVE" => {
      const mode = (process.env.BROKER_MODE ?? "DISABLED").toUpperCase();
      if (mode === "DEMO") return "DEMO";
      if (mode === "LIVE") return "LIVE";
      return "DISABLED";
    })(),
    /** placeDemoOrder only when BROKER_MODE=DEMO (Stage 2: DISABLED). */
    brokerDemoOnlyEnabled: (process.env.BROKER_MODE ?? "DISABLED").toUpperCase() === "DEMO"
  },

  limits: {
    maxActiveSetups: 1,
    setupExpiryBars: 8,
    cooldownBarsAfterStopLoss: 2,
    cooldownBarsAfterResolved: 1,
    entryMaxAtrDrift: 0.35,
    minRiskRewardToTp2: 1.5,
    minConfidenceForTrade: 45,
    maxDecisionAgeMs: 20 * 60 * 1000
  },

  sessions: {
    allowed: ["ASIA", "LONDON", "OVERLAP", "NEWYORK", "UNKNOWN"] as UtcSessionName[],
    blocked: [] as UtcSessionName[],
    minBarsAfterSessionOpen: 0,
    maxBarsBeforeSessionEnd: 0
  },

  /**
   * Same-candle SL/TP ambiguity (tick order unknown).
   * Policy: AMBIGUOUS_INTRABAR → resolve with WORST_CASE ordering
   * (BUY/SELL: SL before any TP). Never assume the win.
   */
  ambiguity: {
    policy: "WORST_CASE_SL_FIRST" as const,
    markStatus: "AMBIGUOUS_INTRABAR" as const
  },

  management: {
    /** Model-only policies; never mutate raw market outcome. */
    atTp1MoveStopToBreakeven: true,
    atTp1PartialClosePct: 50,
    atTp2TrailHint: true
  },

  notifications: {
    enabled: true,
    labelTestAlerts: true
  }
} as const;

export type SetupLifecycleConfig = typeof setupLifecycleConfig;

export const isSetupTrackingAllowed = (
  environment: "LIVE" | "TEST",
  config: SetupLifecycleConfig = setupLifecycleConfig
): boolean =>
  config.flags.setupTrackingEnabled &&
  config.flags.newSetupCreationEnabled &&
  config.flags.setupTrackingEnvironments.includes(environment);

/** Bar follow-up uses tracking flag only (creation may be off while updates continue). */
export const isSetupBarUpdateAllowed = (
  environment: "LIVE" | "TEST",
  config: SetupLifecycleConfig = setupLifecycleConfig
): boolean =>
  config.flags.setupTrackingEnabled &&
  config.flags.setupTrackingEnvironments.includes(environment);
