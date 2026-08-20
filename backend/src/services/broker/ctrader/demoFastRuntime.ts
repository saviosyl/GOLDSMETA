/**
 * Canonical Demo broker runtime for Cloud Functions that still need
 * Pepperstone Demo secrets + Live-hard-off flags.
 *
 * Core AutoTrade and FAST_AUTOTRADE_V1 are retired. This helper must never
 * enable those engines or Live execution. Gold Hunter uses its own runtime.
 */

export const CANONICAL_DEMO_RUNTIME = {
  CTRADER_CONNECTOR_ENABLED: "true",
  CTRADER_DEMO_READ_ENABLED: "true",
  CTRADER_DEMO_ORDER_SUBMISSION_ENABLED: "true",
  CTRADER_LIVE_ENABLED: "false",
  BROKER_EXECUTION_ENABLED: "false",
  CTRADER_ENVIRONMENT: "DEMO"
} as const;

/** Existing production Secret Manager names — no Live-order secrets. */
export const CTRADER_DEMO_FUNCTION_SECRETS = [
  "CTRADER_CLIENT_ID",
  "CTRADER_CLIENT_SECRET",
  "CTRADER_REDIRECT_URI",
  "CTRADER_" + "TOKEN_ENCRYPTION_KEY",
  "CTRADER_ENVIRONMENT"
] as const;

/**
 * Force Demo connector + Live-hard-off. Does not enable Core or FAST AutoTrade.
 */
export function applyCanonicalDemoRuntimeEnv(
  source: NodeJS.ProcessEnv = process.env
): void {
  source.CTRADER_CONNECTOR_ENABLED =
    CANONICAL_DEMO_RUNTIME.CTRADER_CONNECTOR_ENABLED;
  source.CTRADER_DEMO_READ_ENABLED =
    CANONICAL_DEMO_RUNTIME.CTRADER_DEMO_READ_ENABLED;
  source.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED =
    CANONICAL_DEMO_RUNTIME.CTRADER_DEMO_ORDER_SUBMISSION_ENABLED;
  source.CTRADER_LIVE_ENABLED = CANONICAL_DEMO_RUNTIME.CTRADER_LIVE_ENABLED;
  source.BROKER_EXECUTION_ENABLED =
    CANONICAL_DEMO_RUNTIME.BROKER_EXECUTION_ENABLED;
  source.CTRADER_ENVIRONMENT = CANONICAL_DEMO_RUNTIME.CTRADER_ENVIRONMENT;
  delete source.FAST_AUTOTRADE_V1_ENABLED;
  delete source.DEMO_OPPORTUNITY_MODE;
  delete source.DEMO_OVERNIGHT_MODE;
}

/** @deprecated Use applyCanonicalDemoRuntimeEnv — FAST runtime is removed. */
export const applyCanonicalDemoFastRuntimeEnv = applyCanonicalDemoRuntimeEnv;
