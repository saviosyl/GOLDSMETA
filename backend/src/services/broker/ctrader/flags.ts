/**
 * cTrader / Pepperstone execution flags.
 *
 * Demo order submission may be enabled via env for controlled Demo Auto start.
 * Live execution stays hard-false until a separate explicit approval.
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
 * Demo (Pepperstone paper) order submission — env-gated.
 * Live remains impossible via {@link isCTraderLiveEnabled}.
 */
export function isCTraderDemoOrderSubmissionEnabled(
  source?: NodeJS.ProcessEnv
): boolean {
  return envTrue("CTRADER_DEMO_ORDER_SUBMISSION_ENABLED", source);
}

/**
 * Live *execution* stays hard-disabled.
 * Live *account selection* and Live settings storage are implemented separately.
 */
export function isCTraderLiveEnabled(_source?: NodeJS.ProcessEnv): boolean {
  return false;
}

/**
 * Generic broker-execution master switch stays hard-false.
 * Demo cTrader uses {@link isCTraderDemoOrderSubmissionEnabled} only.
 */
export function isBrokerExecutionEnabled(_source?: NodeJS.ProcessEnv): boolean {
  return false;
}

/**
 * Fail closed if Live / generic broker execution env tries to enable.
 * Demo submission env is allowed when intentionally starting Demo Auto.
 */
export function assertCTraderLiveMutationsDisabled(
  source: NodeJS.ProcessEnv = process.env
): void {
  if (envTrue("CTRADER_LIVE_ENABLED", source)) {
    throw new Error("CTRADER_LIVE_MUST_REMAIN_FALSE");
  }
  if (envTrue("BROKER_EXECUTION_ENABLED", source)) {
    throw new Error("BROKER_EXECUTION_MUST_REMAIN_FALSE");
  }
  if (isCTraderLiveEnabled(source) || isBrokerExecutionEnabled(source)) {
    throw new Error("CTRADER_LIVE_MUTATION_FLAGS_CORRUPT");
  }
}

/**
 * @deprecated Prefer {@link assertCTraderLiveMutationsDisabled}.
 * Kept for older call sites; no longer rejects Demo submission env.
 */
export function assertCTraderMutationsDisabled(
  source: NodeJS.ProcessEnv = process.env
): void {
  assertCTraderLiveMutationsDisabled(source);
}

export function snapshotCTraderFlags(source?: NodeJS.ProcessEnv) {
  const demoSubmit = isCTraderDemoOrderSubmissionEnabled(source);
  return {
    CTRADER_CONNECTOR_ENABLED: isCTraderConnectorEnabled(source),
    CTRADER_DEMO_READ_ENABLED: isCTraderDemoReadEnabled(source),
    CTRADER_DEMO_ORDER_PREVIEW_ENABLED: isCTraderDemoOrderPreviewEnabled(source),
    CTRADER_DEMO_ORDER_SUBMISSION_ENABLED: demoSubmit,
    CTRADER_LIVE_ENABLED: isCTraderLiveEnabled(source),
    BROKER_EXECUTION_ENABLED: isBrokerExecutionEnabled(source),
    /** True only while Live + generic broker execution remain hard-false. */
    mutationFlagsHardFalse: !isCTraderLiveEnabled(source) && !isBrokerExecutionEnabled(source),
    demoOrderSubmissionEnabled: demoSubmit
  };
}

/**
 * Recommended defaults for AutoTrade / preview when a user has not saved settings.
 * Must NOT override per-user saved AutoTrade settings when those are supplied.
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
