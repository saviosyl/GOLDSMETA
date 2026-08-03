import type { IntradayPlan } from "../../types/intradayPlan";
import { fmtPrice } from "../../lib/intradayFormat";
import {
  confirmationSummary,
  nextDecisionModeMessage
} from "../../lib/rangeMapHelpers";
import { shortActionLabel } from "../../lib/cockpitHelpers";

type Props = {
  plan: IntradayPlan;
  marketStructureMode?: string | null;
  onOpenScenarios?: () => void;
};

export function NextDecisionStrip({
  plan,
  marketStructureMode = null,
  onOpenScenarios
}: Props) {
  const mode = marketStructureMode ?? plan.freshness.marketStructureMode;
  const modeMessage = nextDecisionModeMessage(mode);
  const action = shortActionLabel(plan.action, plan.actionLabel);
  const confirmation = confirmationSummary(plan);

  return (
    <section
      className="gm-next-decision"
      data-testid="next-decision-strip"
      aria-label="Next decision"
    >
      <div className="gm-section-head">
        <h2 className="gm-section-title">Next Decision</h2>
        {onOpenScenarios && (
          <button
            type="button"
            className="gm-linkish"
            data-testid="next-decision-scenarios-link"
            onClick={onOpenScenarios}
          >
            Full Trade Scenarios
          </button>
        )}
      </div>

      {modeMessage && (
        <p
          className={`gm-next-decision-mode tone-${mode === "MISMATCH" ? "mismatch" : "observe"}`}
          data-testid="next-decision-mode-message"
          role="status"
        >
          {modeMessage}
        </p>
      )}

      <div className="gm-next-decision-grid">
        <div>
          <span className="gm-label">Current action</span>
          <strong data-testid="next-decision-action">{action}</strong>
        </div>
        <div>
          <span className="gm-label">Nearest trigger</span>
          <strong data-testid="next-decision-trigger">
            {plan.trigger ?? "—"}
            {plan.triggerPrice != null ? ` · ${fmtPrice(plan.triggerPrice)}` : ""}
          </strong>
        </div>
        <div>
          <span className="gm-label">Confirmation needed</span>
          <strong data-testid="next-decision-confirmation">{confirmation}</strong>
        </div>
        <div>
          <span className="gm-label">First target</span>
          <strong data-testid="next-decision-target">{plan.nextTarget ?? "—"}</strong>
        </div>
        <div className="gm-next-decision-invalidation">
          <span className="gm-label">Invalidation</span>
          <strong data-testid="next-decision-invalidation">{plan.invalidation}</strong>
        </div>
      </div>
      <p className="gm-meta gm-next-decision-note">
        Analysis only — AutoTrade OFF. Conditional scenarios are research references, not order
        tickets.
      </p>
    </section>
  );
}
