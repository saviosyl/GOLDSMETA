import { GhStatusTone, formatEur, useGoldHunter } from "./GoldHunterShell";
import { formatResearchLocalTime, formatResearchUtcTime } from "../../lib/formatResearchLocalTime";

export function GoldHunterDashboardPage() {
  const { status } = useGoldHunter();
  if (!status) return null;

  const mid = status.market.mid;
  const today = status.capital.todayPnlEur;
  const pf = status.performanceToday;

  return (
    <div data-testid="gh-dashboard">
      <section className="gh-hero" aria-label="Market hero">
        <div className="gh-hero-top">
          <div>
            <div className="gh-hero-symbol">XAUUSD</div>
            <div className="gh-hero-meta" style={{ marginTop: 4 }}>
              <span>
                Market <strong>{status.market.marketStatus}</strong>
              </span>
              <span>
                Feed <strong>{status.market.feedState}</strong>
              </span>
            </div>
          </div>
          <div className="gh-hero-price" data-testid="gh-mid">
            {mid != null ? mid.toFixed(2) : "—"}
          </div>
        </div>
        <div className="gh-hero-meta">
          <span>
            Bid <strong>{status.market.bid?.toFixed(2) ?? "—"}</strong>
          </span>
          <span>
            Ask <strong>{status.market.ask?.toFixed(2) ?? "—"}</strong>
          </span>
          <span>
            Spread <strong>{status.market.spread?.toFixed(2) ?? "—"}</strong>
          </span>
          {status.market.updatedAt ? (
            <span title={formatResearchUtcTime(status.market.updatedAt)}>
              {formatResearchLocalTime(status.market.updatedAt)}
            </span>
          ) : null}
        </div>
      </section>

      {(status.gates.blockers[0] || status.signal.note) && (
        <div className="gh-wait" data-testid="gh-primary-wait">
          {status.config.demoAutoTradeEnabled
            ? status.gates.blockers[0] ?? status.signal.note
            : "WAIT — AUTOTRADE OFF"}
        </div>
      )}

      <div className="gh-grid-2">
        <div className="gh-card">
          <div className="gh-kpi-label">cTrader Demo</div>
          <div className="gh-kpi-value" data-testid="gh-demo-balance">
            {status.broker.balance != null
              ? `€${status.broker.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
              : "—"}
          </div>
          <div className="gh-kpi-label" style={{ marginTop: 6 }}>
            {status.broker.connected
              ? `${status.broker.environment ?? "—"} · ${status.broker.accountMasked ?? "connected"}`
              : "Not connected"}
          </div>
        </div>
        <div className="gh-card">
          <div className="gh-kpi-label">GH Allocation</div>
          <div className="gh-kpi-value" data-testid="gh-allocation">
            €{status.capital.allocatedEur.toLocaleString()}
          </div>
          <div className="gh-kpi-label" style={{ marginTop: 6 }}>
            Available €{status.capital.availableEur.toLocaleString()}
          </div>
        </div>
      </div>

      <div className="gh-grid-2">
        <div className="gh-card">
          <div className="gh-kpi-label">Today P/L</div>
          <div
            className={`gh-kpi-value ${today > 0 ? "pos" : today < 0 ? "neg" : ""}`}
            data-testid="gh-today-pnl"
          >
            {formatEur(today)}
          </div>
        </div>
        <div className="gh-card">
          <div className="gh-kpi-label">Open Trades</div>
          <div className="gh-kpi-value" data-testid="gh-open-count">
            {status.openTrades.length}
          </div>
        </div>
      </div>

      <div className="gh-grid-3">
        <div className="gh-card">
          <div className="gh-kpi-label">Wins</div>
          <div className="gh-kpi-value">{pf.wins}</div>
        </div>
        <div className="gh-card">
          <div className="gh-kpi-label">Losses</div>
          <div className="gh-kpi-value">{pf.losses}</div>
        </div>
        <div className="gh-card">
          <div className="gh-kpi-label">Win Rate</div>
          <div className="gh-kpi-value">
            {pf.winRate != null ? `${(pf.winRate * 100).toFixed(0)}%` : "—"}
          </div>
        </div>
      </div>

      <h3 className="gh-section-title">System Health</h3>
      <div className="gh-health" data-testid="gh-health">
        {(
          [
            ["MARKET FEED", status.health.marketFeed],
            ["TRANSPORT", status.health.transport],
            ["DEPTH", status.health.depth],
            ["STRATEGY", status.health.strategy],
            ["RISK", status.health.risk],
            ["AUTOTRADE", status.health.autoTrade]
          ] as const
        ).map(([label, value]) => (
          <div className="gh-health-item" key={label}>
            <span className="label">{label}</span>
            <span className="value">
              <GhStatusTone value={value} />
            </span>
          </div>
        ))}
      </div>

      <details className="gh-diag">
        <summary>Admin diagnostics</summary>
        <pre data-testid="gh-diagnostics">
          {JSON.stringify(
            {
              executionMode: status.executionMode,
              liveExecutionEnabled: status.liveExecutionEnabled,
              runtimeSha: status.runtimeSha,
              strategy: "GOLD_HUNTER",
              fastAutoTrade: "NOT_INCLUDED",
              feedAgeMs: status.market.ageMs,
              brokerEnv: status.broker.environment
            },
            null,
            2
          )}
        </pre>
      </details>
    </div>
  );
}
