import type { DailySafetyPublicView } from "../../lib/broker/ctraderTypes";
import type { QualificationPublicView } from "../../lib/broker/qualificationTypes";

type Props = {
  marketStatus: string;
  price: number | null;
  bid: number | null;
  ask: number | null;
  updatedLabel: string;
  decisionLabel: string;
  confidence: number | null;
  nextAction: string;
  qualification: QualificationPublicView | null;
  daily: DailySafetyPublicView | null;
};

export function TodayPlanSummary({
  marketStatus,
  price,
  bid,
  ask,
  updatedLabel,
  decisionLabel,
  confidence,
  nextAction,
  qualification,
  daily
}: Props) {
  const autoLabel = qualification
    ? qualification.demoAuto.enabled
      ? "Demo Auto"
      : qualification.startedAt
        ? "Qualification"
        : "Off"
    : "—";

  return (
    <section className="gm-prem-card gm-today-summary" data-testid="today-plan-summary" aria-label="Today summary">
      <div className="gm-qual-dash__head">
        <div>
          <p className="gm-label">XAUUSD</p>
          <h2 data-testid="today-market-status">{marketStatus || "Status pending"}</h2>
        </div>
        <div className="gm-today-price">
          <strong data-testid="today-price">{price != null ? price.toFixed(2) : "—"}</strong>
          <span>
            Bid {bid != null ? bid.toFixed(2) : "—"} · Ask {ask != null ? ask.toFixed(2) : "—"}
          </span>
          <span className="gm-meta">{updatedLabel}</span>
        </div>
      </div>

      <div className="gm-prem-stat-grid gm-prem-stat-grid--3">
        <div className="gm-prem-stat">
          <span>Decision</span>
          <strong data-testid="today-decision">{decisionLabel}</strong>
          <em className="gm-prem-stat-note">
            Confidence {confidence != null ? `${Math.round(confidence)}%` : "—"}
          </em>
        </div>
        <div className="gm-prem-stat">
          <span>AutoTrade</span>
          <strong>{autoLabel}</strong>
          <em className="gm-prem-stat-note">Live Locked</em>
        </div>
        <div className="gm-prem-stat">
          <span>Trades today</span>
          <strong>
            {daily ? `${daily.tradesToday} / ${daily.tradesMax}` : "—"}
          </strong>
        </div>
        <div className="gm-prem-stat">
          <span>Daily P/L</span>
          <strong>
            {daily
              ? `${daily.dailyPnl >= 0 ? "+" : ""}€${daily.dailyPnl.toFixed(2)}`
              : "—"}
          </strong>
        </div>
        <div className="gm-prem-stat">
          <span>Daily risk remaining</span>
          <strong>
            {daily ? `€${daily.dailyLossRemaining.toFixed(2)}` : "—"}
          </strong>
        </div>
        <div className="gm-prem-stat" data-testid="today-next-action">
          <span>Next action</span>
          <strong>{nextAction}</strong>
        </div>
      </div>
    </section>
  );
}
