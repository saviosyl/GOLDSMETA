import type { IntradayPlan } from "../../types/intradayPlan";
import { fmtPrice } from "../../lib/intradayFormat";
import {
  planStatusLabel,
  resolveDisplayAction,
  toneIcon
} from "../../lib/planDisplay";

type Props = {
  plan: IntradayPlan;
};

/**
 * Today's Intraday Plan — primary plan summary (not equal to Alternative Scenario).
 */
export function PrimaryPlanCard({ plan }: Props) {
  const display = resolveDisplayAction(plan);
  const status = plan.planStatus ?? null;

  return (
    <section
      className={`gm-primary-plan tone-${display.tone}`}
      data-testid="todays-intraday-plan"
      aria-label="Today's intraday plan"
    >
      <div className="gm-section-head">
        <h2 className="gm-section-title">Today&apos;s Intraday Plan</h2>
        {plan.planUnchanged ? (
          <span className="gm-badge neutral" data-testid="plan-unchanged">
            Plan unchanged
          </span>
        ) : (
          <span className={`gm-tone-pill tone-${display.tone}`} data-testid="plan-direction-pill">
            <span aria-hidden="true">{display.icon}</span> {display.shortLabel}
          </span>
        )}
      </div>

      <p className="gm-primary-plan-sentence" data-testid="primary-plan-sentence">
        {plan.oneSentence}
      </p>

      <div className="gm-primary-plan-facts">
        <div>
          <span className="gm-label">Trigger</span>
          <strong data-testid="primary-plan-trigger">{plan.trigger ?? "—"}</strong>
          {plan.triggerPrice != null && (
            <span className="gm-meta">{fmtPrice(plan.triggerPrice)}</span>
          )}
        </div>
        <div>
          <span className="gm-label">Invalidation</span>
          <strong data-testid="primary-plan-invalidation">{plan.invalidation}</strong>
        </div>
        <div>
          <span className="gm-label">Next target</span>
          <strong data-testid="primary-plan-target">{plan.nextTarget ?? "—"}</strong>
        </div>
        {status && (
          <div>
            <span className="gm-label">Plan status</span>
            <strong data-testid="primary-plan-status">{planStatusLabel(status)}</strong>
          </div>
        )}
      </div>

      {plan.whyNotReady && (
        <p className="gm-meta gm-why-compact" data-testid="primary-plan-why" role="status">
          <span aria-hidden="true">{toneIcon("wait")}</span>{" "}
          <strong>Why not ready:</strong> {plan.whyNotReady}
        </p>
      )}
    </section>
  );
}
