/**
 * cTrader / Pepperstone execution flags.
 * Mutation / Live flags are HARD-FALSE in this phase — env cannot enable them.
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
 * HARD FALSE — ignore process.env until an explicitly approved future release.
 * Env cannot enable Demo order submission in this phase.
 */
export function isCTraderDemoOrderSubmissionEnabled(
  _source?: NodeJS.ProcessEnv
): boolean {
  return false;
}

/** HARD FALSE — Live cTrader is impossible to activate in this phase. */
export function isCTraderLiveEnabled(_source?: NodeJS.ProcessEnv): boolean {
  return false;
}

/** HARD FALSE for cTrader mutation phase — broker execution remains disabled. */
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

/** Server hard caps — browser may only lower these. */
export const CTRADER_DEMO_SERVER_LIMITS = {
  maxRiskPerTradeEur: 20,
  maxTradesPerDay: 3,
  maxOpenPositions: 1,
  minConfidence: 80,
  maxSignalAgeSeconds: 90,
  confirmedCandleRequired: true,
  stopLossRequired: true,
  environment: "DEMO" as const
} as const;
