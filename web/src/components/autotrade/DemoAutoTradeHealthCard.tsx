/**
 * Compact DEMO AUTOTRADE HEALTH card — owner can see in ~5s whether Demo Auto will trade.
 * Never invents healthy telemetry: unknown engines show WAITING FOR DATA.
 */

import type { DemoAutoAuthorityApi } from "../../lib/broker/demoAutoAuthority";
import type { QualificationPublicView } from "../../lib/broker/qualificationTypes";

function ageLabel(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 5) return "LIVE";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.round(seconds / 60)}m`;
}

function maskOrderId(id: string | null | undefined): string | null {
  if (!id) return null;
  const s = String(id);
  if (s.length < 4) return "…";
  return `${s.slice(0, 2)}…${s.slice(-2)}`;
}

export function DemoAutoTradeHealthCard(props: {
  authority: DemoAutoAuthorityApi | null | undefined;
  qualification: QualificationPublicView | null | undefined;
  /** Only pass when backed by real heartbeat/status — otherwise omit (shows WAITING FOR DATA). */
  signalEngineActive?: boolean | null;
  decisionTriggerActive?: boolean | null;
}) {
  const a = props.authority;
  const q = props.qualification;
  const lastEval = q?.recentEvaluations?.[0];
  const lastBlocker =
    lastEval && lastEval.outcome !== "QUALIFIED"
      ? lastEval.reasonLabel || (lastEval.failed?.[0] ?? "—")
      : a?.marketStatus === "CLOSED" && a.enabled
        ? "MARKET CLOSED"
        : a?.reasons?.[0]
          ? a.reasons[0].replace(/_/g, " ")
          : "—";

  const account =
    a?.selectedDemoAccount || q?.accountMasked
      ? `Demo ${a?.selectedDemoAccount || q?.accountMasked}`
      : "—";
  const oauthOk = a?.tradingScope === "trading";
  const demoOn = Boolean(a?.enabled);
  const submissionReady = Boolean(
    a?.submissionAuthorized ?? (a?.enabled && a?.tradingScope === "trading")
  );

  const quote =
    a?.marketStatus === "CLOSED"
      ? `CLOSED / ${ageLabel(a.quoteAgeSeconds)}`
      : a?.quoteHealthy
        ? `LIVE / ${ageLabel(a.quoteAgeSeconds)}`
        : a?.quoteAgeSeconds != null
          ? `age ${ageLabel(a.quoteAgeSeconds)}`
          : "—";

  const executionNow =
    a?.executionNowLabel ??
    (a?.executionEligible
      ? "READY"
      : a?.marketStatus === "CLOSED" && submissionReady
        ? "WAITING — MARKET CLOSED"
        : submissionReady
          ? "WAITING"
          : "BLOCKED");

  const qualLabel =
    q?.accountConflict ||
    q?.recordStatus === "ACCOUNT_CONFLICT" ||
    q?.recordStatus === "ACCOUNT_MISMATCH"
      ? "QUALIFICATION ACCOUNT MISMATCH"
      : !a?.startedAt &&
          (a?.qualificationState === "READY_TO_QUALIFY" || !a?.qualificationState)
        ? "NOT STARTED"
        : (q?.overallLabel || a?.qualificationState || "—").toString();
  const demoAutoDetail =
    !demoOn && a
      ? !a.startedAt
        ? "Qualification not started"
        : a.reasons?.includes("INTENT_OFF")
          ? "Owner intent disabled"
          : a.label === "PAUSED"
            ? "Paused"
            : "OFF"
      : null;

  const lastBrokerOrder =
    maskOrderId(
      q?.recentControlledTrades?.find((t) => t.status !== "REJECTED")?.correlationId
    ) ?? "—";

  const signalLabel =
    props.signalEngineActive === true
      ? "Active ✓"
      : props.signalEngineActive === false
        ? "Inactive"
        : "WAITING FOR DATA";
  const triggerLabel =
    props.decisionTriggerActive === true
      ? "Active ✓"
      : props.decisionTriggerActive === false
        ? "Inactive"
        : "WAITING FOR DATA";

  return (
    <article
      className="gm-prem-card gm-at-health"
      data-testid="demo-autotrade-health"
      aria-label="Demo AutoTrade health"
    >
      <h3 className="gm-prem-card__title">DEMO AUTOTRADE HEALTH</h3>
      <dl className="gm-at-health-grid">
        <div>
          <dt>Account</dt>
          <dd data-testid="health-account">
            {account} {a?.selectedDemoAccount || q?.accountMasked ? "✓" : ""}
          </dd>
        </div>
        <div>
          <dt>Trading OAuth</dt>
          <dd data-testid="health-oauth">{oauthOk ? "Granted ✓" : a ? "Missing" : "—"}</dd>
        </div>
        <div>
          <dt>Signal engine</dt>
          <dd data-testid="health-signal-engine">{signalLabel}</dd>
        </div>
        <div>
          <dt>Decision trigger</dt>
          <dd data-testid="health-decision-trigger">{triggerLabel}</dd>
        </div>
        <div>
          <dt>Qualification</dt>
          <dd data-testid="health-qualification">{qualLabel}</dd>
        </div>
        <div>
          <dt>Demo Auto</dt>
          <dd data-testid="health-demo-auto">
            {demoOn
              ? "ON"
              : a?.label === "PAUSED"
                ? "PAUSED"
                : a
                  ? demoAutoDetail
                    ? `OFF — ${demoAutoDetail}`
                    : "OFF"
                  : "—"}
          </dd>
        </div>
        <div>
          <dt>Submission</dt>
          <dd data-testid="health-submission">
            {submissionReady ? "READY" : a ? "NOT AUTHORIZED" : "—"}
          </dd>
        </div>
        <div>
          <dt>Quote</dt>
          <dd data-testid="health-quote">{quote}</dd>
        </div>
        <div>
          <dt>Execution now</dt>
          <dd data-testid="health-execution">{executionNow}</dd>
        </div>
        <div>
          <dt>Last evaluation</dt>
          <dd data-testid="health-last-eval">
            {lastEval?.at ? new Date(lastEval.at).toLocaleString() : "—"}
          </dd>
        </div>
        <div>
          <dt>Last blocker</dt>
          <dd data-testid="health-last-blocker">{lastBlocker}</dd>
        </div>
        <div>
          <dt>Last broker order</dt>
          <dd data-testid="health-last-order">{lastBrokerOrder}</dd>
        </div>
      </dl>
    </article>
  );
}
