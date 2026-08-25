import { Bell, ChevronRight } from "lucide-react";
import type { IntradayPlan } from "../../types/intradayPlan";
import { deriveDecisionDashboardState } from "../../lib/decisionDashboardState";
import { PhoneAlertsControl } from "./PhoneAlertsControl";

type Props = {
  plan: IntradayPlan;
  marketStructureMode?: string | null;
  livePrice?: number | null;
  trendBias?: string | null;
  volatility?: string | null;
  newsImpact?: string | null;
};

/**
 * Compact Setup Status under Trade Plan Summary — replaces several scattered cards.
 */
export function SetupStatusCard({
  plan,
  marketStructureMode,
  livePrice,
  trendBias = "Neutral",
  volatility = "—",
  newsImpact = "Low"
}: Props) {
  const state = deriveDecisionDashboardState({ plan, marketStructureMode, livePrice });
  const confirmLabel = state.confirmationPassed
    ? "Confirmed"
    : state.confirmationLabel || "Pending";
  const quality =
    state.confidenceLabel ||
    (plan.confidence != null ? `${Math.round(plan.confidence)}%` : "—");

  return (
    <section
      className="gm-setup-status-card"
      data-testid="setup-status-card"
      aria-label="Setup status"
    >
      <div className="gm-setup-status-card__head">
        <h2>Setup status</h2>
      </div>
      <dl className="gm-setup-status-grid">
        <div>
          <dt>5M confirmation</dt>
          <dd data-testid="setup-status-5m">{confirmLabel}</dd>
        </div>
        <div>
          <dt>Setup quality</dt>
          <dd data-testid="setup-status-quality">{quality}</dd>
        </div>
        <div>
          <dt>Trend</dt>
          <dd data-testid="setup-status-trend">{String(trendBias).replace(/_/g, " ")}</dd>
        </div>
        <div>
          <dt>Volatility</dt>
          <dd data-testid="setup-status-vol">{String(volatility).replace(/_/g, " ")}</dd>
        </div>
        <div>
          <dt>News impact</dt>
          <dd data-testid="setup-status-news">{String(newsImpact)}</dd>
        </div>
      </dl>
      <div className="gm-setup-status-next" data-testid="setup-status-next">
        <span className="gm-label">Next</span>
        <strong>{state.nextAction}</strong>
      </div>
      <div className="gm-setup-status-alerts" id="phone-alerts">
        <span className="gm-setup-status-alerts__label">
          <Bell size={14} aria-hidden /> Phone alerts
        </span>
        <PhoneAlertsControl compact />
      </div>
      <details className="gm-setup-status-why" data-testid="why-waiting" id="why-waiting">
        <summary>
          Why waiting? <ChevronRight size={14} aria-hidden />
        </summary>
        <p>{state.reason || "No valid trade plan yet."}</p>
        <p className="gm-meta">
          Next check is the next analysis review, not a guaranteed signal time.
        </p>
      </details>
    </section>
  );
}
