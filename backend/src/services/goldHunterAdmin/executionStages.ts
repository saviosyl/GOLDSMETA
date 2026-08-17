/**
 * Gold Hunter execution stage names — diagnosable hang points.
 * Lifecycle transitions only (not per market tick).
 */

export const GH_EXECUTION_STAGES = [
  "QUEUE_DEQUEUED",
  "CONFIG_LOAD_START",
  "CONFIG_LOAD_DONE",
  "IDENTITY_CHECK_START",
  "IDENTITY_CHECK_DONE",
  "CLAIM_LOOKUP_START",
  "CLAIM_LOOKUP_DONE",
  "CANDIDATE_REFRESH_START",
  "CANDIDATE_REFRESH_DONE",
  "SYMBOL_LOAD_START",
  "SYMBOL_LOAD_DONE",
  "QUOTE_LOAD_START",
  "QUOTE_LOAD_DONE",
  "ADMIN_CHECK_START",
  "ADMIN_CHECK_DONE",
  "ORCHESTRATOR_START",
  "FRESHNESS_CHECK_DONE",
  "CONFIG_RELOAD_START",
  "CONFIG_RELOAD_DONE",
  "OPEN_TRADES_LOAD_START",
  "OPEN_TRADES_LOAD_DONE",
  "ACCOUNT_SNAPSHOT_START",
  "ACCOUNT_SNAPSHOT_DONE",
  "CLAIM_CREATE_START",
  "CLAIM_CREATE_DONE",
  "SUBMITTING"
] as const;

export type GoldHunterExecutionStage = (typeof GH_EXECUTION_STAGES)[number];

export type GoldHunterStageTelemetry = {
  opportunityId: string | null;
  setup: "A" | "B" | "C" | null;
  side: "BUY" | "SELL" | null;
  queueEnqueuedAt: string | null;
  queueStartedAt: string | null;
  currentStage: GoldHunterExecutionStage | null;
  stageStartedAt: string | null;
  lastStageCompletedAt: string | null;
  attempt: number;
  claimed: boolean;
  tradeId: string | null;
  terminalState: string | null;
};
