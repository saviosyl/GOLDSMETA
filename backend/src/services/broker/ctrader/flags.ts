/**
 * cTrader / Pepperstone execution flags.
 * Production and preview must keep mutation flags false.
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

/** Always false in this phase — hard fail-closed. */
export function isCTraderDemoOrderSubmissionEnabled(
  source?: NodeJS.ProcessEnv
): boolean {
  return envTrue("CTRADER_DEMO_ORDER_SUBMISSION_ENABLED", source);
}

export function isCTraderLiveEnabled(source?: NodeJS.ProcessEnv): boolean {
  return envTrue("CTRADER_LIVE_ENABLED", source);
}

export function isBrokerExecutionEnabled(source?: NodeJS.ProcessEnv): boolean {
  return envTrue("BROKER_EXECUTION_ENABLED", source);
}

export function assertCTraderMutationsDisabled(source?: NodeJS.ProcessEnv): void {
  if (isCTraderDemoOrderSubmissionEnabled(source)) {
    throw new Error("CTRADER_DEMO_ORDER_SUBMISSION_MUST_REMAIN_FALSE");
  }
  if (isCTraderLiveEnabled(source)) {
    throw new Error("CTRADER_LIVE_MUST_REMAIN_FALSE");
  }
  if (isBrokerExecutionEnabled(source)) {
    throw new Error("BROKER_EXECUTION_MUST_REMAIN_FALSE");
  }
}

export function snapshotCTraderFlags(source?: NodeJS.ProcessEnv) {
  return {
    CTRADER_CONNECTOR_ENABLED: isCTraderConnectorEnabled(source),
    CTRADER_DEMO_READ_ENABLED: isCTraderDemoReadEnabled(source),
    CTRADER_DEMO_ORDER_PREVIEW_ENABLED: isCTraderDemoOrderPreviewEnabled(source),
    CTRADER_DEMO_ORDER_SUBMISSION_ENABLED: isCTraderDemoOrderSubmissionEnabled(source),
    CTRADER_LIVE_ENABLED: isCTraderLiveEnabled(source),
    BROKER_EXECUTION_ENABLED: isBrokerExecutionEnabled(source)
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
