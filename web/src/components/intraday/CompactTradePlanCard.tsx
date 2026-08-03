import { Link } from "react-router-dom";
import type { ManualTradePlanCard } from "../../types/intradayPlan";
import { fmtPrice } from "../../lib/intradayFormat";

type Props = {
  tradePlan: ManualTradePlanCard;
};

export function CompactTradePlanCard({ tradePlan }: Props) {
  return (
    <section className="gm-intra-tradeplan" data-testid="compact-trade-plan" aria-label="Manual trade plan">
      <div className="gm-section-head">
        <h2 className="gm-section-title">Manual trade plan</h2>
        <span className={`gm-badge ${tradePlan.actionable ? "positive" : "neutral"}`}>
          {tradePlan.actionable ? "Actionable" : "Not actionable yet"}
        </span>
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

      <p className="gm-meta">{tradePlan.maxCashRiskNote}</p>
      <p className="gm-meta">{tradePlan.positionSizeNote}</p>
      <p className="gm-meta" data-testid="tp-management">
        {tradePlan.management}
      </p>
      <p className="gm-meta" style={{ marginBottom: 0 }}>
        <Link to="/planner">Open risk planner</Link> · Manual sizing only — GoldMeta never places orders.
      </p>
    </section>
  );
}
