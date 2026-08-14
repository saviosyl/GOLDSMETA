/** Structured Micro-only logging — never logs tokens. */
import { redactSecrets } from "./microCTraderProtocol";

export type MicroLogEvent =
  | "MICRO_DEPTH_SUBSCRIBED"
  | "MICRO_CTRADER_CONNECTING"
  | "MICRO_CTRADER_CONNECTED"
  | "MICRO_CTRADER_DISCONNECTED"
  | "MICRO_XAUUSD_RESOLVED"
  | "MICRO_BACKFILL_STARTED"
  | "MICRO_BACKFILL_PROGRESS"
  | "MICRO_BACKFILL_COMPLETED"
  | "MICRO_BACKFILL_FAILED"
  | "MICRO_QUOTE_STALE"
  | "MICRO_M1_COMPLETED"
  | "MICRO_RATE_LIMITED"
  | "MICRO_OAUTH_START"
  | "MICRO_OAUTH_CONNECTED"
  | "MICRO_OAUTH_DISCONNECTED"
  | "MICRO_BOUNDARY_BACKFILL_DONE"
  | "MICRO_COLLECTOR_OAUTH_MISSING"
  | "MICRO_COLLECTOR_CONNECTED"
  | "MICRO_COLLECTOR_CONNECT_FAILED"
  | "MICRO_COLLECTOR_BAR_POLL_FAILED"
  | "MICRO_COLLECTOR_RECONNECT_EXHAUSTED"
  | "MICRO_COLLECTOR_HEALTH_LISTEN"
  | "MICRO_COLLECTOR_SHUTDOWN"
  | "MICRO_COLLECTOR_STARTED";

export function microLog(
  event: MicroLogEvent,
  context: Record<string, unknown> = {}
): void {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    const key = k.toLowerCase();
    if (
      key.includes("token") ||
      key.includes("secret") ||
      key.includes("password") ||
      key.includes("authorization")
    ) {
      safe[k] = "[REDACTED]";
      continue;
    }
    if (typeof v === "string") safe[k] = redactSecrets(v);
    else safe[k] = v;
  }
  console.log(
    JSON.stringify({
      level: "info",
      message: event,
      timestamp: new Date().toISOString(),
      context: safe
    })
  );
}
