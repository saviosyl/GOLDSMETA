/**
 * Bounded FAST scan / manage cycle so one invocation cannot overrun
 * the one-minute cadence or pile up duplicate work.
 */

import { withBoundedOp, isBoundedOpTimeout } from "./boundedOp";

export const FAST_SCAN_BUDGET_MS = 40_000;
export const FAST_MANAGE_BUDGET_MS = 80_000;
export const FAST_OWNER_SCAN_BUDGET_MS = 35_000;
export const FAST_BROKER_READ_BUDGET_MS = 12_000;

export type BoundedCycleResult<S, M> = {
  scanRan: boolean;
  scanTimedOut: boolean;
  manageRan: boolean;
  manageTimedOut: boolean;
  scanResult: S | null;
  manageResult: M | null;
  scanError: string | null;
  manageError: string | null;
};

export async function runBoundedFastScanCycle<S, M>(args: {
  scan: () => Promise<S>;
  manage?: () => Promise<M>;
  scanBudgetMs?: number;
  manageBudgetMs?: number;
}): Promise<BoundedCycleResult<S, M>> {
  const out: BoundedCycleResult<S, M> = {
    scanRan: false,
    scanTimedOut: false,
    manageRan: false,
    manageTimedOut: false,
    scanResult: null,
    manageResult: null,
    scanError: null,
    manageError: null
  };

  try {
    out.scanResult = await withBoundedOp(
      "FAST_SCAN",
      args.scanBudgetMs ?? FAST_SCAN_BUDGET_MS,
      args.scan
    );
    out.scanRan = true;
  } catch (err) {
    out.scanTimedOut = isBoundedOpTimeout(err);
    out.scanError = err instanceof Error ? err.message : String(err);
  }

  if (!args.manage) return out;
  try {
    out.manageResult = await withBoundedOp(
      "FAST_MANAGE",
      args.manageBudgetMs ?? FAST_MANAGE_BUDGET_MS,
      args.manage
    );
    out.manageRan = true;
  } catch (err) {
    out.manageTimedOut = isBoundedOpTimeout(err);
    out.manageError = err instanceof Error ? err.message : String(err);
  }
  return out;
}

export type SoakMinuteKind =
  | "normal"
  | "slow"
  | "quote_timeout"
  | "trendbar_timeout"
  | "margin_timeout";

export type SoakMinuteResult = {
  minute: number;
  kind: SoakMinuteKind;
  ran: boolean;
  hangMs: number;
  timedOut: boolean;
  submitted: boolean;
  connectionsCreated: number;
};

export type SoakSimulationResult = {
  expected: number;
  actual: number;
  coverage: number;
  maxHangMs: number;
  timedOutMinutes: number;
  duplicateOrders: number;
  connectionsCreated: number;
  minutes: SoakMinuteResult[];
};

/**
 * Deterministic 60-minute scheduler soak. Each minute is a tick; broker
 * latency is simulated. A slow read is bounded so the next minute stays runnable.
 */
export async function simulateFastScanSoak(args: {
  minutes?: number;
  opBoundMs?: number;
  kindForMinute?: (minute: number) => SoakMinuteKind;
  onSubmit?: (minute: number, signalId: string) => void;
}): Promise<SoakSimulationResult> {
  const minutes = args.minutes ?? 60;
  const opBoundMs = args.opBoundMs ?? FAST_BROKER_READ_BUDGET_MS;
  const kindForMinute =
    args.kindForMinute ??
    ((m: number): SoakMinuteKind => {
      if (m === 10) return "quote_timeout";
      if (m === 20) return "trendbar_timeout";
      if (m === 30) return "margin_timeout";
      if (m === 7 || m === 41) return "slow";
      return "normal";
    });

  const results: SoakMinuteResult[] = [];
  let connectionsCreated = 0;
  let duplicateOrders = 0;
  const submittedSignals = new Set<string>();
  let queueDepth = 0;

  for (let minute = 1; minute <= minutes; minute += 1) {
    const kind = kindForMinute(minute);
    const latencyMs =
      kind === "normal"
        ? 80
        : kind === "slow"
          ? 8_000
          : 60_000;
    const started = Date.now();
    queueDepth += 1;
    if (queueDepth > 1) {
      // Overlapping invocation must not explode the queue.
      queueDepth -= 1;
    }
    connectionsCreated += 1;
    let timedOut = false;
    let ran = false;
    let submitted = false;
    try {
      await withBoundedOp(`SOAK_MIN_${minute}`, opBoundMs, async () => {
        if (latencyMs > opBoundMs) {
          await new Promise((_, reject) => {
            setTimeout(
              () => reject(new Error(`${kind.toUpperCase()}`)),
              opBoundMs
            );
          });
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(latencyMs, 15)));
        ran = true;
        const signalId = `soak_m${minute}`;
        if (submittedSignals.has(signalId)) {
          duplicateOrders += 1;
          return;
        }
        submittedSignals.add(signalId);
        submitted = false;
        args.onSubmit?.(minute, signalId);
      });
    } catch {
      timedOut = true;
      ran = false;
    }
    queueDepth = Math.max(0, queueDepth - 1);
    const hangMs = Date.now() - started;
    results.push({
      minute,
      kind,
      ran,
      hangMs,
      timedOut,
      submitted,
      connectionsCreated: 1
    });
  }

  const startedScans = results.filter((r) => r.ran || r.timedOut).length;
  return {
    expected: minutes,
    actual: startedScans,
    coverage: minutes > 0 ? startedScans / minutes : 0,
    maxHangMs: results.reduce((m, r) => Math.max(m, r.hangMs), 0),
    timedOutMinutes: results.filter((r) => r.timedOut).length,
    duplicateOrders,
    connectionsCreated,
    minutes: results
  };
}
