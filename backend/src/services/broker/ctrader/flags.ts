/**
 * cTrader / Pepperstone execution flags.
 *
 * TEMPORARY PREVIEW LOCKS (not permanent product design):
 * - Demo/Live order submission stay hard-false until a later approved phase
 * - AutoTrade execution stays OFF
 * - Architecture and UI already support per-user Demo + Live account selection
 *
 * Env cannot enable mutation/Live execution while these getters return false.
 */

function envTrue(name: string, source: NodeJS.ProcessEnv = process.env): boolean {
  return String(source[name] ?? "").trim().toLowerCase() === "true";
}

export function isCTraderConnectorEnabled(source?: NodeJS.ProcessEnv): boolean {
  return envTrue("CTRADER_CONNECTOR_ENABLED", source);
}

export function isCTraderDemoReadEnabled(source?: NodeJS.ProcessEnv): boolean {
  return envTrue("CTRADER_DEMO_READ_ENABLED", source);
}

export function isCTraderDemoOrderPreviewEnabled(source?: NodeJS.ProcessEnv): boolean {
  return envTrue("CTRADER_DEMO_ORDER_PREVIEW_ENABLED", source);
}

/**
 * TEMPORARY PREVIEW LOCK — ignore process.env until an explicitly approved phase.
 * Product architecture supports Demo execution later; this getter stays false now.
 */
export function isCTraderDemoOrderSubmissionEnabled(
  _source?: NodeJS.ProcessEnv
): boolean {
  return false;
}

/**
 * TEMPORARY PREVIEW LOCK — Live *execution* disabled.
 * Live *account selection* and Live settings storage are implemented separately.
 */
export function isCTraderLiveEnabled(_source?: NodeJS.ProcessEnv): boolean {
  return false;
}

/** TEMPORARY PREVIEW LOCK — broker order execution remains disabled. */
export function isBrokerExecutionEnabled(_source?: NodeJS.ProcessEnv): boolean {
  return false;
}

/**
 * Fail closed if any *source* env attempts to enable mutation/Live.
 * Runtime getters remain hard-false; this catches misconfiguration early.
 */
export function assertCTraderMutationsDisabled(
  source: NodeJS.ProcessEnv = process.env
): void {
  if (envTrue("CTRADER_DEMO_ORDER_SUBMISSION_ENABLED", source)) {
    throw new Error("CTRADER_DEMO_ORDER_SUBMISSION_MUST_REMAIN_FALSE");
  }
  if (envTrue("CTRADER_LIVE_ENABLED", source)) {
    throw new Error("CTRADER_LIVE_MUST_REMAIN_FALSE");
  }
  if (envTrue("BROKER_EXECUTION_ENABLED", source)) {
    throw new Error("BROKER_EXECUTION_MUST_REMAIN_FALSE");
  }
  if (isCTraderDemoOrderSubmissionEnabled(source) || isCTraderLiveEnabled(source)) {
    throw new Error("CTRADER_MUTATION_FLAGS_CORRUPT");
  }
}

export function snapshotCTraderFlags(source?: NodeJS.ProcessEnv) {
  return {
    CTRADER_CONNECTOR_ENABLED: isCTraderConnectorEnabled(source),
    CTRADER_DEMO_READ_ENABLED: isCTraderDemoReadEnabled(source),
    CTRADER_DEMO_ORDER_PREVIEW_ENABLED: isCTraderDemoOrderPreviewEnabled(source),
    CTRADER_DEMO_ORDER_SUBMISSION_ENABLED: isCTraderDemoOrderSubmissionEnabled(source),
    CTRADER_LIVE_ENABLED: isCTraderLiveEnabled(source),
    BROKER_EXECUTION_ENABLED: isBrokerExecutionEnabled(source),
    mutationFlagsHardFalse: true as const
  };
}

/**
 * Recommended defaults for AutoTrade / preview when a user has not saved settings.
 * Must NOT override per-user saved AutoTrade settings when those are supplied.
 * Classification: recommended default (not structural security, not permanent product caps).
 */
export const CTRADER_RECOMMENDED_DEFAULTS = {
  maxRiskPerTradeEur: 20,
  maxTradesPerDay: 3,
  maxOpenPositions: 1,
  minConfidence: 80,
  maxSignalAgeSeconds: 90,
  confirmedCandleRequired: true,
  stopLossRequired: true
} as const;

/** @deprecated Prefer CTRADER_RECOMMENDED_DEFAULTS — kept for existing imports. */
export const CTRADER_DEMO_SERVER_LIMITS = {
  ...CTRADER_RECOMMENDED_DEFAULTS,
  environment: "DEMO" as const
} as const;
