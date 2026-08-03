import { Link } from "react-router-dom";
import type { ManualTradePlanCard } from "../../types/intradayPlan";
import { fmtPrice } from "../../lib/intradayFormat";

type Props = {
  tradePlan: ManualTradePlanCard;
};

export function CompactTradePlanCard({ tradePlan }: Props) {
  if (tradePlan.cardKind !== "ACTIVE_PLAN") {
    return (
      <section
        className="gm-intra-tradeplan gm-intra-conditional"
        data-testid="compact-trade-plan"
        aria-label="Conditional reference levels"
      >
        <div className="gm-section-head">
          <h2 className="gm-section-title">{tradePlan.title}</h2>
          <span className="gm-badge neutral">No trade plan active</span>
        </div>
        <p className="gm-meta" data-testid="tp-no-active">
          {tradePlan.orderingNote ?? "No trade plan is active."} Stop/TP values are not presented as
          an order ticket until direction, entry, stop, TP1 and ordering are valid.
        </p>

        <div className="gm-intra-conditional-grid">
          {tradePlan.bullishConditional && (
            <article className="gm-intra-conditional-card tone-bull" data-testid="bullish-conditional">
              <h3>{tradePlan.bullishConditional.label}</h3>
              <p>
                <span className="gm-label">Trigger</span>
                <strong>{tradePlan.bullishConditional.trigger}</strong>
              </p>
              <p>
                <span className="gm-label">Reference TP1</span>
                <strong>{fmtPrice(tradePlan.bullishConditional.tp1)}</strong>
              </p>
              <p>
                <span className="gm-label">Invalidation</span>
                <strong>{tradePlan.bullishConditional.invalidation}</strong>
              </p>
            </article>
          )}
          {tradePlan.bearishConditional && (
            <article className="gm-intra-conditional-card tone-bear" data-testid="bearish-conditional">
              <h3>{tradePlan.bearishConditional.label}</h3>
              <p>
                <span className="gm-label">Trigger</span>
                <strong>{tradePlan.bearishConditional.trigger}</strong>
              </p>
              <p>
                <span className="gm-label">Reference TP1</span>
                <strong>{fmtPrice(tradePlan.bearishConditional.tp1)}</strong>
              </p>
              <p>
                <span className="gm-label">Invalidation</span>
                <strong>{tradePlan.bearishConditional.invalidation}</strong>
              </p>
            </article>
          )}
        </div>
        <p className="gm-meta gm-mobile-collapse-note" style={{ marginBottom: 0 }}>
          <Link to="/planner">Open risk planner</Link> · Manual sizing only — GoldMeta never places
          orders.
        </p>
      </section>
    );
  }

  return (
    <section className="gm-intra-tradeplan" data-testid="compact-trade-plan" aria-label="Manual trade plan">
      <div className="gm-section-head">
        <h2 className="gm-section-title">{tradePlan.title}</h2>
        <span className="gm-badge positive">Actionable</span>
      </div>

      <div className="gm-intra-tradeplan-grid">
        <div>
          <span className="gm-label">Direction</span>
          <strong data-testid="tp-direction">{tradePlan.direction}</strong>
        </div>
        <div>
          <span className="gm-label">Entry zone</span>
          <strong data-testid="tp-entry">{tradePlan.entryZone ?? "—"}</strong>
        </div>
        <div>
          <span className="gm-label">Stop loss</span>
          <strong data-testid="tp-stop">{fmtPrice(tradePlan.stopLoss)}</strong>
        </div>
        <div>
          <span className="gm-label">TP1</span>
          <strong>{fmtPrice(tradePlan.tp1)}</strong>
        </div>
        <div>
          <span className="gm-label">TP2</span>
          <strong>{fmtPrice(tradePlan.tp2)}</strong>
        </div>
        <div>
          <span className="gm-label">TP3</span>
          <strong>{fmtPrice(tradePlan.tp3)}</strong>
        </div>
        <div>
          <span className="gm-label">Risk / reward</span>
          <strong>{tradePlan.riskReward ?? "—"}</strong>
        </div>
        <div className="gm-intra-tradeplan-span">
          <span className="gm-label">Invalidation</span>
          <strong data-testid="tp-invalidation">{tradePlan.invalidation}</strong>
        </div>
      </div>

      <details className="gm-intra-details gm-mobile-collapse">
        <summary>Risk notes</summary>
        <p className="gm-meta">{tradePlan.maxCashRiskNote}</p>
        <p className="gm-meta">{tradePlan.positionSizeNote}</p>
        <p className="gm-meta" data-testid="tp-management">
          {tradePlan.management}
        </p>
      </details>
      <p className="gm-meta" style={{ marginBottom: 0 }}>
        <Link to="/planner">Open risk planner</Link> · Manual sizing only — GoldMeta never places orders.
      </p>
    </section>
  );
}
