/**
 * Durable Stocks Intraday job processor.
 * Survives HTTP request completion, cold starts, and duplicate trigger delivery
 * via claim lease + status transitions.
 */

import { randomUUID } from "crypto";
import { logger } from "../logging/logger";
import type { StockIntradayService } from "./stockIntradayService";
import type { StockIntradayStorePort, StockIntradayJob } from "./stockIntradayStore";
import { STOCK_JOB_LEASE_MS } from "./stockIntradayStore";

export interface ProcessStockIntradayJobOptions {
  store: StockIntradayStorePort;
  service: StockIntradayService;
  workerId?: string;
  leaseMs?: number;
}

/**
 * Process a single durable job. Safe under duplicate Firestore trigger delivery:
 * only one claimer wins the lease.
 */
export async function processStockIntradayJob(
  userId: string,
  jobId: string,
  options: ProcessStockIntradayJobOptions
): Promise<StockIntradayJob | null> {
  const workerId = options.workerId ?? `stock-worker-${randomUUID()}`;
  const leaseMs = options.leaseMs ?? STOCK_JOB_LEASE_MS;
  const { store, service } = options;

  const existing = await store.getJob(userId, jobId);
  if (!existing) {
    logger.warn("Stock intraday job not found", { userId, jobId });
    return null;
  }
  if (existing.state === "COMPLETED" || existing.state === "DEAD_LETTER") {
    return existing;
  }

  const claimed = await store.claimJob(userId, jobId, workerId, leaseMs);
  if (!claimed) {
    return store.getJob(userId, jobId);
  }

  try {
    await service.executeDurableJob(claimed);
    return await store.completeJob(userId, jobId);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown stock job error";
    logger.error("Stock intraday job failed", { userId, jobId, error: message });
    return await store.failJob(userId, jobId, message);
  }
}
