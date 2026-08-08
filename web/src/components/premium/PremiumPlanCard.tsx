import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { DecisionDashboardState } from "../../lib/decisionDashboardState";
import { fmtPrice } from "../../lib/intradayFormat";
import { premiumDecisionChip } from "../../lib/premiumDecisionCopy";
import type { IntradayPlan } from "../../types/intradayPlan";

type Props = {
  plan: IntradayPlan;
  state: DecisionDashboardState;
  updatedLabel?: string;
};

export function PremiumPlanCard({ plan, state, updatedLabel }: Props) {
  const chip = premiumDecisionChip(state, plan);
  const instruction =
    chip === "WAIT"
      ? "GoldMeta is watching for a valid setup"
      : sanitize(plan.oneSentence) || state.nextAction || state.planState;
  const nextTarget = state.levels.tp1 != null ? fmtPrice(state.levels.tp1) : "—";
  const invalidation =
    state.levels.stop != null
      ? `Below ${fmtPrice(state.levels.stop)}`
      : plan.tradePlan?.stopLoss != null
        ? `Below ${fmtPrice(plan.tradePlan.stopLoss)}`
        : "—";
  const confirmation = state.confirmationPassed
    ? "Confirmation passed"
    : state.confirmationLabel || "Pending";

  const chipTone =
    chip === "BUY READY" || chip === "BUY"
      ? "buy"
      : chip === "SELL READY" || chip === "SELL" || chip === "NO TRADE"
        ? "sell"
        : chip === "PREPARE" ||
            chip === "PREPARE BUY" ||
            chip === "PREPARE SELL" ||
            chip === "WAIT" ||
            chip === "WATCHING"
          ? "wait"
          : state.tone;

  return (
    <article className="gm-plan-summary-card" data-testid="premium-plan-card">
      <div className="gm-premium-plan-card-head">
        {(state.mode === "BUY_READY" || state.mode === "SELL_READY") && (
          <span className="gm-status-badge tone-buy" data-testid="premium-plan-ready">
            PLAN READY
          </span>
        )}
        <span className={`gm-status-badge tone-${chipTone}`} data-testid="premium-plan-chip">
          {chip}
        </span>
        {updatedLabel ? <span className="gm-meta">Updated {updatedLabel}</span> : null}
      </div>
      <h3 data-testid="premium-plan-instruction">{instruction}</h3>
      <div className="gm-plan-summary-grid">
        <div>
          <span className="gm-label">Next Target</span>
          <strong className="tone-green" data-testid="premium-plan-target">
            {nextTarget}
          </strong>
        </div>
        <div>
          <span className="gm-label">Invalidation</span>
          <strong className="tone-red" data-testid="premium-plan-invalidation">
            {invalidation}
          </strong>
        </div>
        <div>
          <span className="gm-label">Confirmation</span>
          <strong data-testid="premium-plan-confirmation">{confirmation}</strong>
        </div>
      </div>
      <div className="gm-plan-summary-foot">
        <span className="gm-meta">{updatedLabel ? `Updated ${updatedLabel}` : "Manual plan only"}</span>
        <Link className="gm-linkish" to="/levels" data-testid="premium-view-full-plan">
          View full plan <ChevronRight size={14} aria-hidden />
        </Link>
      </div>
    </article>
  );
}

function sanitize(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}
