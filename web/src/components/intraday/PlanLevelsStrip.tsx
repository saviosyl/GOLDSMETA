import type { IntradayPlan } from "../../types/intradayPlan";
import { fmtPrice } from "../../lib/intradayFormat";

type Props = {
  plan: IntradayPlan;
};

/**
 * Large scannable Entry / Stop / TP1 — primary plan levels only.
 */
export function PlanLevelsStrip({ plan }: Props) {
  const tp = plan.tradePlan;
  const entry =
    tp.entryZone ??
    (plan.triggerPrice != null ? fmtPrice(plan.triggerPrice) : plan.trigger);
  const stop = tp.stopLoss ?? plan.bullishScenario.invalidationPrice ?? null;
  const tp1 =
    tp.tp1 ??
    plan.nextTargetPrice ??
    plan.bullishScenario.firstTargetPrice ??
    null;
  const active = tp.cardKind === "ACTIVE_PLAN" && tp.actionable;

  return (
    <section
      className={`gm-plan-levels${active ? " is-active" : ""}`}
      data-testid="plan-levels-strip"
      aria-label="Entry stop and take profit"
    >
      <div className="gm-section-head">
        <h2 className="gm-section-title">Entry · Stop · TP1</h2>
        <span className={`gm-badge ${active ? "positive" : "neutral"}`}>
          {active ? "Active plan" : "Reference"}
        </span>
      </div>
      <div className="gm-plan-levels-grid">
        <div data-testid="plan-level-entry">
          <span className="gm-label">Entry</span>
          <strong className="gm-plan-price">{entry ?? "—"}</strong>
        </div>
        <div data-testid="plan-level-stop">
          <span className="gm-label">Stop</span>
          <strong className="gm-plan-price tone-sell">{fmtPrice(stop)}</strong>
        </div>
        <div data-testid="plan-level-tp1">
          <span className="gm-label">TP1</span>
          <strong className="gm-plan-price tone-buy">{fmtPrice(tp1)}</strong>
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
