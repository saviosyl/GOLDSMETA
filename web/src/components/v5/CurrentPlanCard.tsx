import { Link } from "react-router-dom";
import type { SetupRecord } from "../../types/models";

/** Current Plan section — calm empty state or locked shadow plan levels. */
export function CurrentPlanCard({ setup }: { setup: SetupRecord | null }) {
  const hasPlan =
    setup &&
    (setup.levels?.entryPrice != null ||
      setup.levels?.stopLoss != null ||
      setup.levels?.tp1 != null);

  if (!hasPlan) {
    return (
      <section className="gm-section" data-testid="current-plan">
        <div className="gm-section-head">
          <h2 className="gm-section-title">Current Plan</h2>
        </div>
        <div className="gm-empty gm-empty--calm" data-testid="no-shadow-plan" role="status">
          <strong>No validated shadow plan yet.</strong>
          <p className="gm-meta">
            GoldMeta is waiting for structure, confirmation and valid risk geometry.
          </p>
        </div>
      </section>
    );
  }

  const risk =
    setup!.levels?.entryPrice != null && setup!.levels?.stopLoss != null
      ? Math.abs(Number(setup!.levels.entryPrice) - Number(setup!.levels.stopLoss))
      : null;

  return (
    <section className="gm-section" data-testid="current-plan">
      <div className="gm-section-head">
        <h2 className="gm-section-title">Current Plan</h2>
        <span className="gm-badge research">SHADOW PLAN</span>
      </div>
      <p className="gm-meta gm-plan-disclaimer" data-testid="plan-disclaimer">
        NOT AN EXECUTED TRADE
      </p>
      <div className="gm-metrics-grid" data-testid="primary-plan-levels">
        <div className="gm-metric">
          <span className="gm-label">Direction</span>
          <span className="gm-metric-value">{setup!.direction ?? "—"}</span>
        </div>
        <div className="gm-metric">
          <span className="gm-label">Entry</span>
          <span className="gm-metric-value">{setup!.levels?.entryPrice ?? "—"}</span>
        </div>
        <div className="gm-metric">
          <span className="gm-label">Stop</span>
          <span className="gm-metric-value">{setup!.levels?.stopLoss ?? "—"}</span>
        </div>
        <div className="gm-metric">
          <span className="gm-label">TP1</span>
          <span className="gm-metric-value">{setup!.levels?.tp1 ?? "—"}</span>
        </div>
        <div className="gm-metric">
          <span className="gm-label">TP2</span>
          <span className="gm-metric-value">{setup!.levels?.tp2 ?? "—"}</span>
        </div>
        <div className="gm-metric">
          <span className="gm-label">TP3</span>
          <span className="gm-metric-value">{setup!.levels?.tp3 ?? "—"}</span>
        </div>
        <div className="gm-metric">
          <span className="gm-label">Risk distance</span>
          <span className="gm-metric-value">{risk != null ? risk.toFixed(2) : "—"}</span>
        </div>
        <div className="gm-metric">
          <span className="gm-label">Lifecycle</span>
          <span className="gm-metric-value">{String(setup!.status).replace(/_/g, " ")}</span>
        </div>
      </div>
      <p className="gm-meta" style={{ marginTop: 10 }}>
        <Link to={`/setups/${setup!.setupId}`}>Open setup detail</Link>
      </p>
    </section>
  );
}
