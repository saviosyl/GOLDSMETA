import type { DailySafetyPublicView } from "../../lib/broker/ctraderTypes";

type Props = {
  safety: DailySafetyPublicView;
  onResume?: () => void;
  busy?: boolean;
};

function money(n: number, currency: string): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${currency === "EUR" ? "€" : ""}${n.toFixed(2)}`;
}

export function DailySafetyCard({ safety, onResume, busy }: Props) {
  return (
    <section className="gm-prem-card gm-daily-safety" data-testid="daily-safety-card" aria-label="Daily safety">
      <div className="gm-qual-dash__head">
        <div>
          <p className="gm-label">Daily safety</p>
          <h2>{safety.environment === "live" ? "LIVE" : "DEMO"} · {safety.tradingDay}</h2>
        </div>
        <span className={`gm-qual-pill gm-qual-pill--${safety.entriesBlocked ? "bad" : "ok"}`}>
          {safety.autoTradeLabel}
        </span>
      </div>

      <div className="gm-prem-stat-grid gm-prem-stat-grid--3">
        <div className="gm-prem-stat" data-testid="daily-trades-today">
          <span>Trades today</span>
          <strong className={safety.tradesLimitReached ? "is-warn" : undefined}>
            {safety.tradesToday} / {safety.tradesMax}
          </strong>
          {safety.tradesLimitReached ? <em className="gm-prem-stat-note">Daily trade limit reached</em> : null}
        </div>
        <div className="gm-prem-stat" data-testid="daily-pnl">
          <span>Daily P/L</span>
          <strong>{money(safety.dailyPnl, safety.currency)}</strong>
        </div>
        <div className="gm-prem-stat" data-testid="daily-loss-used">
          <span>Daily loss used</span>
          <strong>
            {money(safety.dailyLossUsed, safety.currency)} / {money(safety.dailyLossLimit, safety.currency)}
          </strong>
          <em className="gm-prem-stat-note">
            Remaining {money(safety.dailyLossRemaining, safety.currency)}
          </em>
        </div>
        <div className="gm-prem-stat">
          <span>Consecutive losses</span>
          <strong>
            {safety.consecutiveLosses} / {safety.consecutiveLossMax}
          </strong>
        </div>
        <div className="gm-prem-stat">
          <span>Open positions</span>
          <strong>
            {safety.openPositions} / {safety.openPositionsMax}
          </strong>
        </div>
        <div className="gm-prem-stat">
          <span>Cooldown</span>
          <strong>{safety.cooldownLabel}</strong>
        </div>
        <div className="gm-prem-stat">
          <span>Emergency Stop</span>
          <strong className={safety.emergencyStopActive ? "is-warn" : "is-ok"}>
            {safety.emergencyStopLabel}
          </strong>
        </div>
        <div className="gm-prem-stat">
          <span>AutoTrade</span>
          <strong>{safety.autoTradeLabel}</strong>
        </div>
        {safety.dailyProfitTargetEnabled ? (
          <div className="gm-prem-stat">
            <span>Profit target</span>
            <strong>
              {safety.dailyProfitTargetReached
                ? "Reached"
                : money(safety.dailyProfitTarget ?? 0, safety.currency)}
            </strong>
          </div>
        ) : null}
      </div>

      {safety.entriesBlockedReason ? (
        <p className="gm-meta" data-testid="daily-safety-block-reason">
          New entries blocked: {safety.entriesBlockedReason}
        </p>
      ) : null}

      {onResume && (safety.consecutiveLossPaused || safety.profitProtectionPaused) ? (
        <div className="gm-qual-actions">
          <button
            type="button"
            className="gm-btn"
            disabled={busy}
            data-testid="daily-safety-resume"
            onClick={onResume}
          >
            Resume new entries
          </button>
        </div>
      ) : null}
    </section>
  );
}
