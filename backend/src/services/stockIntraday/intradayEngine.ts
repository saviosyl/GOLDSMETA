/**
 * Autonomous intraday engine — scheduled + TradingView-triggered scans,
 * open-position monitoring, and end-of-day sweeps.
 *
 * All broker submission flags remain false in this delivery.
 * SHADOW mode runs the full workflow and records hypothetical trades.
 *
 * Scheduler cadence is intentionally coarse (see stockIntradaySchedulerTick)
 * to respect provider rate limits and Firebase cost.
 */

import { nowIso } from "../../utils/time";
import type { StockIntradayService } from "./stockIntradayService";
import type { StockIntradayStorePort, StockJobKind } from "./stockIntradayStore";
import { logger } from "../logging/logger";

/** Minimum gap between automatic scan ticks per user (ms). */
export const STOCK_SCAN_MIN_INTERVAL_MS = 5 * 60 * 1000;
/** Minimum gap between position-monitor ticks per user (ms). */
export const STOCK_MONITOR_MIN_INTERVAL_MS = 2 * 60 * 1000;

export type EngineTickKind =
  | "SCHEDULED_SCAN"
  | "MONITOR_POSITIONS"
  | "MARKET_CLOSE_SWEEP"
  | "RECONCILE"
  | "MARKET_DATA_HEALTH";

export interface EngineTickResult {
  userId: string;
  kind: EngineTickKind;
  enqueued: boolean;
  skippedReason?: string;
  jobId?: string;
}

/**
 * Enqueue a durable engine job if the user's mode warrants work and
 * rate-limit windows allow it. Never places broker orders.
 */
export async function enqueueEngineTick(args: {
  store: StockIntradayStorePort;
  userId: string;
  kind: EngineTickKind;
  payload?: Record<string, unknown>;
}): Promise<EngineTickResult> {
  const { store, userId, kind } = args;
  const risk = await store.getRiskState(userId);
  const gate = await store.getRestartGate(userId);

  if (risk.mode === "OFF") {
    return { userId, kind, enqueued: false, skippedReason: "MODE_OFF" };
  }
  if (risk.killSwitchActive || risk.emergencyStopActive) {
    return { userId, kind, enqueued: false, skippedReason: "KILL_SWITCH" };
  }
  if (kind === "SCHEDULED_SCAN" && (risk.paused || gate.entriesPaused)) {
    return { userId, kind, enqueued: false, skippedReason: "ENTRIES_PAUSED" };
  }
  // Paper/Live stay architecture-only; SHADOW may run autonomous workflow.
  if (risk.mode !== "SHADOW" && kind === "SCHEDULED_SCAN") {
    return { userId, kind, enqueued: false, skippedReason: "AUTO_SCAN_SHADOW_ONLY" };
  }

  const jobKind = mapKind(kind);
  const job = await store.createJob({
    jobId: `eng_${kind.toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId,
    kind: jobKind,
    signalId: null,
    alertId: null,
    maxAttempts: 3,
    payload: {
      trigger: "scheduler",
      kind,
      at: nowIso(),
      ...(args.payload ?? {})
    }
  });

  logger.info("Stock intraday engine tick enqueued", {
    userId,
    kind,
    jobId: job.jobId,
    mode: risk.mode
  });

  return { userId, kind, enqueued: true, jobId: job.jobId };
}

function mapKind(kind: EngineTickKind): StockJobKind {
  switch (kind) {
    case "SCHEDULED_SCAN":
      return "SCHEDULED_SCAN";
    case "MONITOR_POSITIONS":
    case "MARKET_DATA_HEALTH":
      return "MONITOR_POSITIONS";
    case "MARKET_CLOSE_SWEEP":
      return "MARKET_CLOSE_SWEEP";
    case "RECONCILE":
      return "RECONCILE";
    default:
      return "SCHEDULED_SCAN";
  }
}

/**
 * High-level scheduler entry used by Cloud Scheduler / onSchedule.
 * Enqueues monitor + scan jobs only — processing is via Firestore trigger / retry tick.
 * Test helper `processEnqueued` optionally drains jobs in-process.
 */
export async function runStockIntradaySchedulerForUser(
  service: StockIntradayService,
  store: StockIntradayStorePort,
  userId: string,
  options?: { processEnqueued?: boolean }
): Promise<EngineTickResult[]> {
  const results: EngineTickResult[] = [];
  results.push(
    await enqueueEngineTick({ store, userId, kind: "MONITOR_POSITIONS" })
  );
  results.push(
    await enqueueEngineTick({ store, userId, kind: "SCHEDULED_SCAN" })
  );
  results.push(
    await enqueueEngineTick({ store, userId, kind: "MARKET_DATA_HEALTH" })
  );
  if (options?.processEnqueued) {
    for (const r of results) {
      if (r.enqueued && r.jobId) {
        await service.processDurableJobById(userId, r.jobId);
      }
    }
  }
  return results;
}

/** Capabilities checklist for documentation / status. */
export const INTRADAY_ENGINE_CAPABILITIES = [
  "Scheduled watchlist scans",
  "TradingView-triggered scans",
  "Entry evaluation",
  "Open-position monitoring",
  "Stop-loss evaluation",
  "Take-profit evaluation",
  "Trailing-stop evaluation",
  "Break-even evaluation",
  "Strategy invalidation",
  "Maximum holding-time exit",
  "Entry cutoff before market close",
  "End-of-day forced close",
  "Broker reconciliation",
  "Market-data health checks"
] as const;
