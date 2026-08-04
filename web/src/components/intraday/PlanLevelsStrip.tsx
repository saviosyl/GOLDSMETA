import type { IntradayPlan } from "../../types/intradayPlan";
import { fmtPrice } from "../../lib/intradayFormat";
import { sanitizePlanText } from "../../lib/planTextFormat";

type Props = {
  plan: IntradayPlan;
};

/**
 * Large scannable Entry / Stop / TP1 — secondary research strip (optional).
 * Primary fold uses the unified Today's Intraday Plan card.
 */
export function PlanLevelsStrip({ plan }: Props) {
  const tp = plan.tradePlan;
  const entry =
    tp.entryZone != null
      ? sanitizePlanText(String(tp.entryZone))
      : plan.triggerPrice != null
        ? fmtPrice(plan.triggerPrice)
        : sanitizePlanText(plan.trigger);
  const stop = tp.stopLoss ?? plan.bullishScenario.invalidationPrice ?? null;
  const tp1 =
    tp.tp1 ??
    plan.nextTargetPrice ??
    plan.bullishScenario.firstTargetPrice ??
    null;
  const tp2 = tp.tp2 ?? plan.afterThatTargetPrice ?? null;
  const active = tp.cardKind === "ACTIVE_PLAN" && tp.actionable;

  return (
    <section
      className={`gm-plan-levels${active ? " is-active" : ""}`}
      data-testid="plan-levels-strip-secondary"
      aria-label="Entry stop and take profit"
    >
      <div className="gm-section-head">
        <h2 className="gm-section-title">Entry · Stop · TP1</h2>
        <span className={`gm-badge ${active ? "positive" : "neutral"}`}>
          {active ? "Active plan" : "Reference"}
        </span>
      </div>
      <div className="gm-plan-levels-grid gm-plan-levels-2x2">
        <div data-testid="plan-level-entry">
          <span className="gm-label">Entry</span>
          <strong className="gm-plan-price">{entry || "—"}</strong>
        </div>
        <div data-testid="plan-level-stop">
          <span className="gm-label">Stop</span>
          <strong className="gm-plan-price tone-sell">{fmtPrice(stop)}</strong>
        </div>
        <div data-testid="plan-level-tp1">
          <span className="gm-label">TP1</span>
          <strong className="gm-plan-price tone-buy">{fmtPrice(tp1)}</strong>
        </div>
        <div data-testid="plan-level-tp2">
          <span className="gm-label">TP2</span>
          <strong className="gm-plan-price">{tp2 != null ? fmtPrice(tp2) : "Optional"}</strong>
        </div>
      </div>
      {!active && (
        <p className="gm-meta" data-testid="plan-levels-note">
          Levels are research references until direction, entry, stop and TP1 are all valid.
        </p>
      )}
    </section>
  );
}
