/**
 * GOLD HUNTER FAST research — bounded reconnect attempt orchestration.
 *
 * Ops integrity only (not strategy). Evidence from run gh_research_mstaod7m_0sy3ew
 * on runtimeSha 63f53bc: after hard-stale reconnect, MICRO_CTRADER_CONNECTING
 * logged at 18:44:46.240Z and transport.connect() never reached
 * MICRO_CTRADER_CONNECTED (initial connect had taken ~11s). 30s deadline is
 * conservatively above that observed healthy connect duration.
 */
export const GH_FAST_RESEARCH_RECONNECT_ATTEMPT_TIMEOUT_MS = 30_000;

export const GH_FAST_RESEARCH_RECONNECT_TIMEOUT_REASON =
  "Live 63f53bc / gh_research_mstaod7m_0sy3ew: hard-stale reconnect logged MICRO_CTRADER_CONNECTING then hung inside transport.connect() with no CONNECTED; initial healthy connect was ~11s. 30s attempt deadline is an ops integrity bound above that — not A/B/C tuning." as const;

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

/** Race a reconnect body against a hard deadline. */
export function raceReconnectAttempt<T>(args: {
  body: Promise<T>;
  timeoutMs: number;
  attemptId: number;
  getPhase: () => ResearchReconnectPhase;
  nowMs?: () => number;
}): Promise<T> {
  const nowMs = args.nowMs ?? (() => Date.now());
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new ResearchReconnectTimeoutError(
          args.getPhase(),
          args.attemptId,
          args.timeoutMs
        )
      );
    }, args.timeoutMs);
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
  });
  return Promise.race([args.body, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
    void nowMs;
  });
}
