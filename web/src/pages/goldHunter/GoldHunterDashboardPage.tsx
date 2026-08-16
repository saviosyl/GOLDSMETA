import { GhStatusTone, formatEur, useGoldHunter } from "./GoldHunterShell";
import { formatResearchLocalTime, formatResearchUtcTime } from "../../lib/formatResearchLocalTime";
import { useAuth } from "../../lib/auth";
import { useState } from "react";

function money(n: number | null | undefined, currency: string | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const code = (currency ?? "EUR").toUpperCase();
  try {
    return new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2
    }).format(n);
  } catch {
    return `${code} ${n.toFixed(2)}`;
  }
}

export function GoldHunterDashboardPage() {
  const { status, refresh } = useGoldHunter();
  const { api } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  if (!status) return null;

  const mid = status.market.mid;
  const today = status.capital.todayPnlEur;
  const pf = status.performanceToday;
  const cur = status.broker.currency;

  async function onRefresh() {
    setRefreshing(true);
    try {
      if (typeof api.goldHunterRefreshAccount === "function") {
        await api.goldHunterRefreshAccount();
      }
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }

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
            : status.market.marketStatus === "CLOSED"
              ? "WAIT — MARKET CLOSED"
              : "WAIT — AUTOTRADE OFF"}
        </div>
      )}

      <div className="gh-split" style={{ marginBottom: 12 }}>
        <section className="gh-card" data-testid="gh-ctrader-card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8
            }}
          >
            <h3 style={{ margin: 0 }}>cTrader Demo</h3>
            <button
              type="button"
              className="gh-btn"
              style={{ minHeight: 36, padding: "6px 10px", fontSize: "0.75rem" }}
              data-testid="gh-account-refresh"
              disabled={refreshing}
              onClick={() => void onRefresh()}
            >
              {refreshing ? "…" : "Refresh"}
            </button>
          </div>
          <div className="gh-trade-grid" style={{ marginTop: 10 }}>
            <div>
              <span>Balance</span>
              <strong data-testid="gh-demo-balance">{money(status.broker.balance, cur)}</strong>
            </div>
            <div>
              <span>Equity</span>
              <strong data-testid="gh-demo-equity">{money(status.broker.equity, cur)}</strong>
            </div>
            <div>
              <span>Used margin</span>
              <strong data-testid="gh-demo-margin-used">
                {money(status.broker.marginUsed, cur)}
              </strong>
            </div>
            <div>
              <span>Free margin</span>
              <strong data-testid="gh-demo-free-margin">
                {money(status.broker.freeMargin, cur)}
              </strong>
            </div>
          </div>
          <div className="gh-hero-meta" style={{ marginTop: 10 }}>
            <GhStatusTone value={status.broker.authState ?? "UNKNOWN"} />
            <span className="gh-badge gh-badge--demo">
              {status.broker.environment ?? "UNKNOWN"}
            </span>
            <span className="gh-kpi-label">
              {status.broker.accountMasked ?? "—"}
              {cur ? ` · ${cur}` : ""}
            </span>
          </div>
          {status.broker.lastSyncAt ? (
            <p className="hint" style={{ marginTop: 8 }} title={formatResearchUtcTime(status.broker.lastSyncAt)}>
              Last broker sync {formatResearchLocalTime(status.broker.lastSyncAt)}
              {status.broker.snapshotAgeMs != null
                ? ` · age ${Math.round(status.broker.snapshotAgeMs / 1000)}s`
                : ""}
            </p>
          ) : (
            <p className="hint" style={{ marginTop: 8 }}>
              {status.broker.connected ? "Account snapshot pending" : "Not connected"}
            </p>
          )}
        </section>

        <section className="gh-card" data-testid="gh-capital-card">
          <h3 style={{ margin: 0 }}>Gold Hunter</h3>
          <div className="gh-trade-grid" style={{ marginTop: 10 }}>
            <div>
              <span>Allocated</span>
              <strong data-testid="gh-allocation">
                €{status.capital.allocatedEur.toLocaleString()}
              </strong>
            </div>
            <div>
              <span>Committed</span>
              <strong data-testid="gh-committed">
                {status.capital.committedEur == null
                  ? "—"
                  : `€${status.capital.committedEur.toLocaleString()}`}
              </strong>
            </div>
            <div>
              <span>Available</span>
              <strong>
                {status.capital.availableEur == null
                  ? "—"
                  : `€${status.capital.availableEur.toLocaleString()}`}
              </strong>
            </div>
            <div>
              <span>Risk / trade</span>
              <strong>{formatEur(status.capital.riskBudgetEur).replace("+", "")}</strong>
            </div>
            <div>
              <span>Today GH Demo P/L</span>
              <strong
                className={today > 0 ? "pos" : today < 0 ? "neg" : undefined}
                data-testid="gh-today-pnl"
              >
                {formatEur(today)}
              </strong>
            </div>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            Risk uses Gold Hunter allocation — not full Demo balance.
            {status.capital.committedKnown === false
              ? " Committed capital unavailable — new entries fail closed."
              : ""}
          </p>
        </section>
      </div>

      <div className="gh-grid-2">
        <div className="gh-card">
          <div className="gh-kpi-label">Open Trades</div>
          <div className="gh-kpi-value" data-testid="gh-open-count">
            {status.openTrades.length}
          </div>
        </div>
        <div className="gh-card">
          <div className="gh-kpi-label">Win Rate</div>
          <div className="gh-kpi-value">
            {pf.winRate != null ? `${(pf.winRate * 100).toFixed(0)}%` : "—"}
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
          <div className="gh-kpi-label">Profit factor</div>
          <div className="gh-kpi-value">
            {pf.profitFactor != null ? pf.profitFactor.toFixed(2) : "—"}
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
              broker: {
                provider: status.broker.provider,
                environment: status.broker.environment,
                authState: status.broker.authState,
                accountMasked: status.broker.accountMasked,
                currency: status.broker.currency,
                snapshotSource: status.broker.snapshotSource,
                snapshotAgeMs: status.broker.snapshotAgeMs,
                lastSyncAt: status.broker.lastSyncAt,
                validForRisk: status.broker.validForRisk
              },
              strategyPipeline: status.strategyPipeline,
              arming: status.arming,
              gates: status.gates,
              signal: status.signal,
              execution: status.execution,
              openTrades: status.openTrades.map((t) => ({
                goldHunterTradeId: t.goldHunterTradeId,
                setup: t.setup,
                side: t.side,
                status: t.status,
                netPnlEur: t.netPnlEur,
                entry: t.entry,
                stop: t.stop
              })),
              performanceToday: status.performanceToday,
              feedAgeMs: status.market.ageMs,
              fastAutoTrade: "NOT_INCLUDED"
            },
            null,
            2
          )}
        </pre>
      </details>
    </div>
  );
}
