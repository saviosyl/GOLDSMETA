import type { Decision } from "../types/models";
import {
  displayQualityLabel,
  formatPercent,
  formatPrice,
  formatWhen,
  isStaleDecision,
  isTestDecision,
  primaryReason,
  recommendedActionLabel,
  tradePlanEntryLabel,
  tradePlanRrLabel,
  tradePlanStopLabel,
  tradePlanTpLabel,
  trendLabel
} from "../lib/decisionDisplay";

interface Props {
  decision: Decision;
  source?: "live" | "cached" | "offline";
  cachedAt?: string | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  actionsDisabled?: boolean;
  compact?: boolean;
}

export function DecisionCard({
  decision,
  source = "live",
  cachedAt,
  onRefresh,
  refreshing,
  actionsDisabled,
  compact = false
}: Props) {
  const supporting =
    decision.decision === "SELL" ? decision.bearishEvidence : decision.bullishEvidence;
  const opposing =
    decision.decision === "SELL" ? decision.bullishEvidence : decision.bearishEvidence;
  const stale = source !== "live" || isStaleDecision(decision);
  const test = isTestDecision(decision);
  const quality = displayQualityLabel(decision, source);
  const action = recommendedActionLabel(decision);
  const summary = primaryReason(decision);

  return (
    <section className="card decision-card" aria-label={`Current decision ${decision.decision}`}>
      {stale && (
        <div className="banner stale" role="status" data-testid="stale-banner">
          {source === "offline"
            ? "Offline — showing cached decision."
            : source === "cached"
              ? `Cached decision${cachedAt ? ` from ${formatWhen(cachedAt)}` : ""}.`
              : "Market data is stale."}{" "}
          Verify the live price before acting.
        </div>
      )}

      <div className="decision-card-header">
        <div className="decision-card-title min-zero">
          <p className="muted decision-symbol">{decision.scenarioName ?? decision.symbol}</p>
          <div className={`decision-hero ${decision.decision}`} aria-live="polite">
            {decision.decision}
          </div>
        </div>
        <div className="decision-badges">
          {test && (
            <span className="badge test" aria-label="TEST decision" data-testid="test-badge">
              TEST
            </span>
          )}
          <span className="badge" aria-label={`Data quality ${quality}`} data-testid="quality-badge">
            {quality}
          </span>
        </div>
      </div>

      <p className="muted decision-meta">
        {formatPrice(decision.lastKnownPrice)} · {formatWhen(decision.generatedAt)}
      </p>

      {!compact && (
        <p className="decision-summary" data-testid="decision-summary">
          {summary}
        </p>
      )}

      <div className="grid-2 decision-metrics">
        <div className="metric">
          <span className="label">Confidence</span>
          <span className="value">{formatPercent(decision.confidence)}</span>
        </div>
        <div className="metric">
          <span className="label">Trend</span>
          <span className="value">{trendLabel(decision)}</span>
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
          <span className="value action-value" data-testid="action-label">
            {action}
          </span>
        </div>
      </div>

      <h3>Trade plan</h3>
      <div className="price-row">
        <span>Entry</span>
        <strong data-testid="plan-entry">{tradePlanEntryLabel(decision)}</strong>
      </div>
      <div className="price-row">
        <span>Stop loss</span>
        <strong data-testid="plan-stop">{tradePlanStopLabel(decision)}</strong>
      </div>
      <div className="price-row">
        <span>TP1</span>
        <strong data-testid="plan-tp1">{tradePlanTpLabel(decision, "TP1")}</strong>
      </div>
      <div className="price-row">
        <span>TP2</span>
        <strong data-testid="plan-tp2">{tradePlanTpLabel(decision, "TP2")}</strong>
      </div>
      <div className="price-row">
        <span>TP3</span>
        <strong data-testid="plan-tp3">{tradePlanTpLabel(decision, "TP3")}</strong>
      </div>
      <div className="price-row">
        <span>Risk / reward</span>
        <strong data-testid="plan-rr">{tradePlanRrLabel(decision)}</strong>
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
