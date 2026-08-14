/**
 * GOLD HUNTER FAST research — bounded reconnect / connection attempt orchestration.
 *
 * Ops integrity only (not strategy). Evidence from run gh_research_mstaod7m_0sy3ew
 * on runtimeSha 63f53bc: after hard-stale reconnect, MICRO_CTRADER_CONNECTING
 * logged at 18:44:46.240Z and transport.connect() never reached
 * MICRO_CTRADER_CONNECTED (initial healthy connect ~11s). 30s is an overall
 * attempt deadline covering disconnect + scope + connect/auth + subscribe +
 * attach — not A/B/C tuning.
 */
export const GH_FAST_RESEARCH_RECONNECT_ATTEMPT_TIMEOUT_MS = 30_000;

/** Best-effort bound for stop()/cleanup disconnect waits. */
export const GH_FAST_RESEARCH_STOP_DISCONNECT_TIMEOUT_MS = 5_000;

export const GH_FAST_RESEARCH_RECONNECT_TIMEOUT_REASON =
  "Live 63f53bc / gh_research_mstaod7m_0sy3ew: hard-stale reconnect logged MICRO_CTRADER_CONNECTING then hung inside transport.connect() with no CONNECTED; open vs auth sub-phase not separable from available logs; initial healthy connect was ~11s. 30s overall attempt deadline (all phases share remaining budget) is an ops integrity bound — not A/B/C tuning." as const;

/** Stepped backoff for connect_failed / timed_out retries (not stale-feed path). */
export const GH_FAST_RESEARCH_CONNECT_FAILURE_BACKOFF_MS = [
  2_500,
  5_000,
  15_000,
  30_000,
  60_000
] as const;

export type ResearchReconnectPhase =
  | "IDLE"
  | "DETACHING"
  | "DISCONNECTING_OLD_SESSION"
  | "VERIFYING_SCOPE"
  | "CONNECTING_SESSION"
  | "SUBSCRIBING"
  | "ATTACHING"
  | "WAITING_FOR_FRESH_DATA"
  | "COMPLETE"
  | "FAILED"
  | "TIMED_OUT";

export function connectFailureBackoffMs(attemptIndex: number): number {
  const steps = GH_FAST_RESEARCH_CONNECT_FAILURE_BACKOFF_MS;
  if (attemptIndex <= 0) return steps[0]!;
  if (attemptIndex >= steps.length) return steps[steps.length - 1]!;
  return steps[attemptIndex]!;
}

export function remainingBudgetMs(
  deadlineAtMs: number,
  nowMs: () => number = () => Date.now()
): number {
  return Math.max(0, deadlineAtMs - nowMs());
}

export class ResearchReconnectTimeoutError extends Error {
  readonly code = "RESEARCH_RECONNECT_TIMED_OUT" as const;
  readonly phase: ResearchReconnectPhase;
  readonly attemptId: number;
  constructor(phase: ResearchReconnectPhase, attemptId: number, timeoutMs: number) {
    super(
      `RESEARCH_RECONNECT_TIMED_OUT phase=${phase} attemptId=${attemptId} timeoutMs=${timeoutMs}`
    );
    this.name = "ResearchReconnectTimeoutError";
    this.phase = phase;
    this.attemptId = attemptId;
  }
}

export class ResearchReconnectObsoleteError extends Error {
  readonly code = "RESEARCH_RECONNECT_OBSOLETE" as const;
  readonly attemptId: number;
  constructor(attemptId: number) {
    super(`RESEARCH_RECONNECT_OBSOLETE attemptId=${attemptId}`);
    this.name = "ResearchReconnectObsoleteError";
    this.attemptId = attemptId;
  }
}

/**
 * Race a body against a hard timeout. Optional onTimeout runs for cleanup
 * (cancel/close) without waiting for the body — Promise.race alone does not
 * cancel the underlying work.
 */
export function raceReconnectAttempt<T>(args: {
  body: Promise<T>;
  timeoutMs: number;
  attemptId: number;
  getPhase: () => ResearchReconnectPhase;
  nowMs?: () => number;
  onTimeout?: () => void | Promise<void>;
}): Promise<T> {
  const nowMs = args.nowMs ?? (() => Date.now());
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => {
      const phase = args.getPhase();
      const err = new ResearchReconnectTimeoutError(
        phase,
        args.attemptId,
        args.timeoutMs
      );
      reject(err);
      if (args.onTimeout) {
        void Promise.resolve()
          .then(() => args.onTimeout?.())
          .catch(() => {
            /* best-effort cleanup */
          });
      }
    }, Math.max(0, args.timeoutMs));
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
  });
  return Promise.race([args.body, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
    void nowMs;
  });
}

/** Bound work against an absolute deadline (remaining budget). */
export function raceUntilDeadline<T>(args: {
  body: Promise<T>;
  deadlineAtMs: number;
  attemptId: number;
  getPhase: () => ResearchReconnectPhase;
  nowMs?: () => number;
  onTimeout?: () => void | Promise<void>;
}): Promise<T> {
  const nowMs = args.nowMs ?? (() => Date.now());
  const rem = remainingBudgetMs(args.deadlineAtMs, nowMs);
  if (rem <= 0) {
    const err = new ResearchReconnectTimeoutError(
      args.getPhase(),
      args.attemptId,
      0
    );
    if (args.onTimeout) {
      void Promise.resolve()
        .then(() => args.onTimeout?.())
        .catch(() => undefined);
    }
    return Promise.reject(err);
  }
  return raceReconnectAttempt({
    body: args.body,
    timeoutMs: rem,
    attemptId: args.attemptId,
    getPhase: args.getPhase,
    nowMs,
    onTimeout: args.onTimeout
  });
}
