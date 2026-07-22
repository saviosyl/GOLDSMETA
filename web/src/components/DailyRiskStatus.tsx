import type { DailyManualRiskStatus } from "../lib/manualRisk";

interface Props {
  status: DailyManualRiskStatus;
}

export function DailyRiskStatus({ status }: Props) {
  return (
    <section
      className={`card daily-risk-status ${status.stopTradingToday ? "stop" : ""}`}
      aria-label="Daily manual risk status"
      data-testid="daily-risk-status"
    >
      <h2 className="section-title">Daily manual-risk status</h2>
      {status.stopTradingToday ? (
        <div className="stop-trading-banner" role="alert" data-testid="stop-trading-banner">
          STOP TRADING FOR TODAY
        </div>
      ) : (
        <p className="muted">Within configured manual limits. Signals still record normally.</p>
      )}
      <div className="grid-2 compact-metrics">
        <div className="metric">
          <span className="label">Max / trade</span>
          <span className="value">
            {status.currency} {status.maxCashRiskPerTrade}
          </span>
        </div>
        <div className="metric">
          <span className="label">Today P/L</span>
          <span className="value">
            {status.currency} {status.todayRealisedPnl}
          </span>
        </div>
        <div className="metric">
          <span className="label">Daily loss cap</span>
          <span className="value">
            {status.currency} {status.maxDailyRealisedLoss}
          </span>
        </div>
        <div className="metric">
          <span className="label">Consecutive losses</span>
          <span className="value">
            {status.consecutiveLosses} / {status.stopAfterConsecutiveLosses}
          </span>
        </div>
        <div className="metric">
          <span className="label">Open manual</span>
          <span className="value">
            {status.openManualTrades} / {status.maxSimultaneousManualTrades}
          </span>
        </div>
      </div>
      {status.reasons.map((r) => (
        <p key={r} className="muted">
          {r}
        </p>
      ))}
      <p className="muted safety-rules">
        No averaging down · No martingale · No automatic recovery trades
      </p>
    </section>
  );
}
