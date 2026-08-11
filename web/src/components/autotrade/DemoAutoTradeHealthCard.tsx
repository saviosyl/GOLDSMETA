/**
 * Compact DEMO AUTOTRADE HEALTH card — owner can see in ~5s whether Demo Auto will trade.
 */

import type { DemoAutoAuthorityApi } from "../../lib/broker/demoAutoAuthority";
import type { QualificationPublicView } from "../../lib/broker/qualificationTypes";

function ageLabel(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 5) return "LIVE";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.round(seconds / 60)}m`;
}

export function DemoAutoTradeHealthCard(props: {
  authority: DemoAutoAuthorityApi | null | undefined;
  qualification: QualificationPublicView | null | undefined;
  signalEngineActive?: boolean;
  decisionTriggerActive?: boolean;
}) {
  const a = props.authority;
  const q = props.qualification;
  const lastEval = q?.recentEvaluations?.[0];
  const lastBlocker =
    lastEval && lastEval.outcome !== "QUALIFIED"
      ? lastEval.reasonLabel || (lastEval.failed?.[0] ?? "—")
      : a?.reasons?.[0]
        ? a.reasons[0].replace(/_/g, " ")
        : "none";
  const account =
    a?.selectedDemoAccount || q?.accountMasked
      ? `Demo ${a?.selectedDemoAccount || q?.accountMasked}`
      : "—";
  const oauthOk = a?.tradingScope === "trading";
  const demoOn = Boolean(a?.enabled);
  const quote =
    a?.marketStatus === "CLOSED"
      ? "CLOSED"
      : a?.quoteHealthy
        ? `LIVE / ${ageLabel(a.quoteAgeSeconds)}`
        : a?.quoteAgeSeconds != null
          ? `age ${ageLabel(a.quoteAgeSeconds)}`
          : "—";
  const execution = a?.executionEligible
    ? "READY"
    : demoOn
      ? "BLOCKED"
      : "BLOCKED";
  const qualLabel =
    !a?.startedAt && (a?.qualificationState === "READY_TO_QUALIFY" || !a?.qualificationState)
      ? "NOT STARTED"
      : (q?.overallLabel || a?.qualificationState || "—").toString();

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
          <dd data-testid="health-oauth">{oauthOk ? "Granted ✓" : "Missing"}</dd>
        </div>
        <div>
          <dt>Signal engine</dt>
          <dd>{props.signalEngineActive !== false ? "Active ✓" : "Unknown"}</dd>
        </div>
        <div>
          <dt>Decision trigger</dt>
          <dd>{props.decisionTriggerActive !== false ? "Active ✓" : "Unknown"}</dd>
        </div>
        <div>
          <dt>Qualification</dt>
          <dd data-testid="health-qualification">{qualLabel}</dd>
        </div>
        <div>
          <dt>Demo Auto</dt>
          <dd data-testid="health-demo-auto">{demoOn ? "ON" : a?.label === "PAUSED" ? "PAUSED" : "OFF"}</dd>
        </div>
        <div>
          <dt>Quote</dt>
          <dd data-testid="health-quote">{quote}</dd>
        </div>
        <div>
          <dt>Execution</dt>
          <dd data-testid="health-execution">{execution}</dd>
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
          <dd data-testid="health-last-order">none</dd>
        </div>
      </dl>
    </article>
  );
}
