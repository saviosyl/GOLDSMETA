import type { Decision } from "../types/models";
import {
  entryDisplay,
  formatPercent,
  formatPrice,
  formatRatio,
  formatWhen,
  isStaleDecision,
  isTestDecision,
  tpPrice
} from "../lib/format";

interface Props {
  decision: Decision;
  source?: "live" | "cached" | "offline";
  cachedAt?: string | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  actionsDisabled?: boolean;
}

export function DecisionCard({
  decision,
  source = "live",
  cachedAt,
  onRefresh,
  refreshing,
  actionsDisabled
}: Props) {
  const supporting =
    decision.decision === "SELL" ? decision.bearishEvidence : decision.bullishEvidence;
  const opposing =
    decision.decision === "SELL" ? decision.bullishEvidence : decision.bearishEvidence;
  const stale = source !== "live" || isStaleDecision(decision);
  const test = isTestDecision(decision);
  const action = decision.recommendedManagementAction ?? decision.recommendedActions?.[0] ?? "—";

  return (
    <section className="card" aria-label={`Current decision ${decision.decision}`}>
      {(stale || source !== "live") && (
        <div className="banner stale" role="status">
          Showing {source === "offline" ? "offline" : "cached"} data
          {cachedAt ? ` from ${formatWhen(cachedAt)}` : ""}. Marked stale — verify live price before
          acting.
        </div>
      )}

      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <p className="muted" style={{ margin: 0 }}>
            {decision.scenarioName ?? decision.symbol}
          </p>
          <div className={`decision-hero ${decision.decision}`} aria-live="polite">
            {decision.decision}
          </div>
        </div>
        <div className="row">
          {test && (
            <span className="badge test" aria-label="TEST decision">
              TEST
            </span>
          )}
          <span className="badge" aria-label={`Data source ${decision.dataSourceLabel}`}>
            {source === "live" ? decision.dataSourceLabel : "OFFLINE"}
          </span>
        </div>
      </div>

      <p className="muted" style={{ marginTop: 0 }}>
        {formatPrice(decision.lastKnownPrice)} · {formatWhen(decision.generatedAt)}
      </p>

      <div className="grid-2" style={{ marginBottom: 12 }}>
        <div className="metric">
          <span className="label">Confidence</span>
          <span className="value">{formatPercent(decision.confidence)}</span>
        </div>
        <div className="metric">
          <span className="label">Trend</span>
          <span className="value">
            {decision.marketStructure?.trend ?? decision.higherTimeframeBias ?? decision.marketRegime}
          </span>
        </div>
        <div className="metric">
          <span className="label">POC</span>
          <span className="value">{formatPrice(decision.marketStructure?.poc)}</span>
        </div>
        <div className="metric">
          <span className="label">VAH</span>
          <span className="value">{formatPrice(decision.marketStructure?.vah)}</span>
        </div>
        <div className="metric">
          <span className="label">VAL</span>
          <span className="value">{formatPrice(decision.marketStructure?.val)}</span>
        </div>
        <div className="metric">
          <span className="label">Action</span>
          <span className="value">{action.replaceAll("_", " ")}</span>
        </div>
      </div>

      <h3>Trade plan</h3>
      <div className="price-row">
        <span>Entry</span>
        <strong>{entryDisplay(decision.entry)}</strong>
      </div>
      <div className="price-row">
        <span>Stop loss</span>
        <strong>{formatPrice(decision.stopLoss.price)}</strong>
      </div>
      <div className="price-row">
        <span>TP1</span>
        <strong>{tpPrice(decision.takeProfits, "TP1")}</strong>
      </div>
      <div className="price-row">
        <span>TP2</span>
        <strong>{tpPrice(decision.takeProfits, "TP2")}</strong>
      </div>
      <div className="price-row">
        <span>TP3</span>
        <strong>{tpPrice(decision.takeProfits, "TP3")}</strong>
      </div>
      <div className="price-row">
        <span>Risk / reward</span>
        <strong>
          {formatRatio(decision.riskReward.tp2 ?? decision.riskReward.tp1 ?? decision.riskReward.tp3)}
        </strong>
      </div>

      <h3 style={{ marginTop: 16 }}>Reasons</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Supporting
      </p>
      <ul className="list">
        {(supporting.length ? supporting : ["None listed"]).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="muted">Opposing</p>
      <ul className="list">
        {(opposing.length ? opposing : ["None listed"]).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      {decision.analysisOnly !== false && (
        <p className="muted" style={{ marginTop: 12 }}>
          Analysis only — not an executed broker order.
        </p>
      )}

      {onRefresh && (
        <button
          type="button"
          className="btn block"
          style={{ marginTop: 12 }}
          onClick={onRefresh}
          disabled={refreshing || actionsDisabled}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      )}
    </section>
  );
}
