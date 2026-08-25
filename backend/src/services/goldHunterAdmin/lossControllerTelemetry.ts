/**
 * Authoritative quote-worker loss-controller telemetry for Admin Diagnostics.
 * API process must read this persisted snapshot — not its empty in-process selector.
 */
export type GoldHunterLossControllerTelemetry = {
  updatedAt: string;
  workerRevision: string | null;
  consecutiveLosses: number;
  rollingRealisedR: number;
  rollingSampleCount: number;
  lossStreakGuardActive: boolean;
  lossCircuitBreakerActive: boolean;
  circuitBreakerReason: string | null;
  unknownRealisedRLossCount: number;
  rollingUnknownRTradeCount: number;
  consecutiveUnknownRLosses: number;
  unknownRGuardActive: boolean;
  entryIntegrityHealthy: boolean;
  entryIntegrityRecoveredAtMs: number | null;
  lastEntryIntegrityRecoveryReason: string | null;
  lastClosedTradeId: string | null;
  lastUnknownRTradeId: string | null;
  lastUnknownRReason: string | null;
  /** Always QUOTE_WORKER when written by the persistent quote worker. */
  telemetrySource: "QUOTE_WORKER" | "API_PROCESS_FALLBACK";
};

export function goldHunterWorkerRevision(): string | null {
  const rev =
    process.env.K_REVISION ??
    process.env.GIT_COMMIT_SHA ??
    process.env.SOURCE_SHA ??
    null;
  return rev != null && String(rev).trim().length > 0 ? String(rev) : null;
}
