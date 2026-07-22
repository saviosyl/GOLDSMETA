import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { StockIntradayMode, StockIntradayStatus } from "../lib/stockIntradayTypes";

function money(n: number | null | undefined, currency = "EUR"): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(n);
}

export function StockIntradayAutoTradePage() {
  const { api } = useAuth();
  const [status, setStatus] = useState<StockIntradayStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [watchlistDraft, setWatchlistDraft] = useState("");

  const reload = useCallback(async () => {
    try {
      const next = await api.stockIntradayStatus();
      setStatus(next);
      setWatchlistDraft((next.watchlist?.symbols ?? []).join(", "));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Stocks Intraday status");
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (fn: () => Promise<StockIntradayStatus>) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const connection = status?.connection;
  const budget = status?.budget;
  const limits = status?.limits;

  return (
    <div className="gm-autotrade gm-stock-intraday" data-testid="stock-intraday-page">
      <header className="gm-autotrade-hero">
        <div className="gm-autotrade-hero-copy">
          <p className="gm-autotrade-kicker">GoldMeta · Stocks Intraday</p>
          <h1 className="gm-page-title gm-autotrade-title">Stocks Intraday AutoTrade</h1>
          <p className="gm-meta gm-autotrade-lead">
            Automatic long-only stock and ETF trading via Trading 212 Invest. Separate from IG Gold
            CFD AutoTrade. No per-trade approval while an Auto mode is active.
          </p>
          <p className="gm-meta">
            <Link to="/autotrade">Gold CFD AutoTrade</Link>
          </p>
        </div>
        <div className="gm-autotrade-status-block" data-testid="stock-intraday-status">
          <span className="gm-label">MODE</span>
          <span className="gm-at-pill gm-at-pill--off" data-testid="stock-intraday-mode-pill">
            {status?.displayStatus ?? "OFF"}
          </span>
          <span className="gm-label">ENV</span>
          <span className="gm-at-pill gm-at-pill--demo" data-testid="stock-intraday-env-pill">
            {connection?.environmentLabel ?? "T212 PAPER — ORDERS DISABLED"}
          </span>
        </div>
      </header>

      <div className="gm-autotrade-readonly-banner" data-testid="stock-intraday-safety">
        {status?.safetyStatement ??
          "GoldMeta trades only qualifying opportunities. No trade will be placed when the safety requirements are not met."}
      </div>

      {status?.marketData?.dataLabel ? (
        <div className="gm-autotrade-readonly-banner" data-testid="stock-intraday-data-label">
          Market data: {status.marketData.dataLabel}
          {status.marketData.feedId ? ` · feed=${status.marketData.feedId}` : ""}
          {" · "}
          provider={status.marketData.providerId}
        </div>
      ) : null}

      <div
        className="gm-autotrade-readonly-banner"
        data-testid="stock-intraday-t212-price-label"
      >
        {status?.t212ExecutionPrice?.label ??
          "T212 EXECUTION PRICE — NOT AVAILABLE FROM CURRENT PUBLIC API"}
      </div>

      <div className="gm-autotrade-stop-bar" data-testid="stock-intraday-kill-switch-bar">
        <div>
          <strong>Emergency STOP</strong>
          <p className="gm-meta">Halts new entries. Does not sell personal/non-GoldMeta holdings.</p>
        </div>
        <button
          type="button"
          className="gm-btn gm-at-stop"
          data-testid="stock-intraday-emergency-stop"
          disabled={busy}
          onClick={() => void run(() => api.stockIntradayEmergencyStop())}
        >
          STOP
        </button>
      </div>

      {error ? (
        <div className="banner error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="gm-section gm-autotrade-panel" data-testid="stock-intraday-connection">
        <div className="gm-section-head">
          <h2 className="gm-section-title">Trading 212 connection</h2>
          <p className="gm-meta">Paper read-only for this delivery. Order flags remain false.</p>
        </div>
        <div className="gm-autotrade-metrics">
          <div>
            <span className="gm-label">Connection</span>
            <strong>{connection?.connectionState ?? "Disconnected"}</strong>
          </div>
          <div>
            <span className="gm-label">Cash</span>
            <strong>{money(connection?.cash)}</strong>
          </div>
          <div>
            <span className="gm-label">Available</span>
            <strong>{money(connection?.availableToTrade)}</strong>
          </div>
          <div>
            <span className="gm-label">Engine</span>
            <strong>{status?.engineRunning ? "Running" : "Paused"}</strong>
          </div>
          <div>
            <span className="gm-label">Paper orders</span>
            <strong>{status?.paperOrderSubmissionEnabled ? "ON" : "OFF"}</strong>
          </div>
          <div>
            <span className="gm-label">Live orders</span>
            <strong>{status?.liveExecutionFeatureEnabled ? "ON" : "OFF"}</strong>
          </div>
        </div>
        <div className="gm-autotrade-actions">
          <button
            type="button"
            className="gm-btn gm-btn-primary"
            disabled={busy}
            data-testid="stock-intraday-connect-paper"
            onClick={() => void run(() => api.stockIntradayConnectPaper())}
          >
            Connect T212 Paper
          </button>
          <button
            type="button"
            className="gm-btn"
            disabled={busy || !connection?.connected}
            onClick={() => void run(() => api.stockIntradayDisconnect())}
          >
            Disconnect
          </button>
          <button type="button" className="gm-btn" disabled title="Live blocked">
            Connect T212 Live (blocked)
          </button>
        </div>
      </section>

      <section className="gm-section gm-autotrade-panel" data-testid="stock-intraday-mode">
        <div className="gm-section-head">
          <h2 className="gm-section-title">Operating mode</h2>
          <p className="gm-meta">OFF · SHADOW · PAPER AUTO · LIVE AUTO — no per-trade approval buttons</p>
        </div>
        <div className="gm-autotrade-mode-grid">
          {(
            [
              ["OFF", "OFF"],
              ["SHADOW", "SHADOW"],
              ["T212_PAPER_AUTO", "PAPER AUTO (orders off)"],
              ["T212_LIVE_AUTO", "LIVE AUTO (blocked)"]
            ] as Array<[StockIntradayMode, string]>
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={`gm-btn gm-at-mode${status?.mode === mode ? " is-active" : ""}`}
              disabled={busy || mode === "T212_LIVE_AUTO" || (status?.locked && mode !== "OFF")}
              data-testid={`stock-intraday-mode-${mode}`}
              title={
                mode === "T212_LIVE_AUTO"
                  ? "Live execution hard-blocked"
                  : mode === "T212_PAPER_AUTO"
                    ? "Paper submission flag is false"
                    : undefined
              }
              onClick={() => {
                if (mode === "T212_LIVE_AUTO") return;
                void run(() => api.stockIntradaySetMode(mode));
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {status?.locked ? (
          <button
            type="button"
            className="gm-btn gm-btn-gold"
            disabled={busy}
            onClick={() => void run(() => api.stockIntradayUnlock())}
          >
            Unlock (returns to OFF)
          </button>
        ) : null}
      </section>

      <section className="gm-section gm-autotrade-panel" data-testid="stock-intraday-budget">
        <div className="gm-section-head">
          <h2 className="gm-section-title">Daily capital &amp; risk</h2>
        </div>
        <div className="gm-autotrade-metrics">
          <div>
            <span className="gm-label">Daily allocation</span>
            <strong>{money(budget?.dailyCapitalAllocation)}</strong>
          </div>
          <div>
            <span className="gm-label">Remaining</span>
            <strong>{money(budget?.dailyCapitalRemaining)}</strong>
          </div>
          <div>
            <span className="gm-label">Max / trade</span>
            <strong>{money(limits?.maxCapitalPerTrade)}</strong>
          </div>
          <div>
            <span className="gm-label">Cash reserve</span>
            <strong>{money(limits?.minCashReserve)}</strong>
          </div>
          <div>
            <span className="gm-label">Daily loss left</span>
            <strong>{money(budget?.dailyLossRemaining)}</strong>
          </div>
          <div>
            <span className="gm-label">Trades today</span>
            <strong>
              {budget?.tradesUsed ?? 0}/{budget?.tradesMax ?? limits?.maxTradesPerDay}
            </strong>
          </div>
        </div>
      </section>

      <section className="gm-section gm-autotrade-panel" data-testid="stock-intraday-watchlist">
        <div className="gm-section-head">
          <h2 className="gm-section-title">SHADOW watchlist</h2>
          <p className="gm-meta">Max 10 symbols. Saved list is preserved across SHADOW re-enable.</p>
        </div>
        <label className="gm-label" htmlFor="stock-watchlist-input">
          Symbols (comma-separated)
        </label>
        <input
          id="stock-watchlist-input"
          className="gm-input"
          data-testid="stock-intraday-watchlist-input"
          value={watchlistDraft}
          disabled={busy}
          onChange={(e) => setWatchlistDraft(e.target.value)}
        />
        <div className="gm-autotrade-actions">
          <button
            type="button"
            className="gm-btn gm-btn-primary"
            disabled={busy}
            data-testid="stock-intraday-watchlist-save"
            onClick={() => {
              const symbols = watchlistDraft
                .split(/[,\s]+/)
                .map((s) => s.trim())
                .filter(Boolean);
              void run(() => api.stockIntradayUpdateWatchlist(symbols));
            }}
          >
            Save watchlist
          </button>
        </div>
        {(status?.watchlist?.rejected?.length ?? 0) > 0 ? (
          <ul className="gm-autotrade-limits-list" data-testid="stock-intraday-watchlist-rejected">
            {status!.watchlist!.rejected.map((r) => (
              <li key={r.symbol}>
                <strong>{r.symbol}</strong> rejected: {r.reasons.join(", ")}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="gm-section gm-autotrade-panel" data-testid="stock-intraday-ranked">
        <div className="gm-section-head">
          <h2 className="gm-section-title">Ranked Intraday Opportunities</h2>
          <p className="gm-meta">Not a guaranteed best stock — absolute checks required.</p>
        </div>
        {(status?.rankedOpportunities?.length ?? 0) === 0 ? (
          <p className="gm-empty">No ranked opportunities yet.</p>
        ) : (
          <ul className="gm-autotrade-limits-list">
            {status!.rankedOpportunities.map((o) => (
              <li key={o.symbol}>
                <strong>
                  {o.symbol} · {o.overallScore}
                </strong>{" "}
                {o.qualifies ? "qualifies" : `blocked: ${o.blockReasons[0] ?? "checks failed"}`} ·{" "}
                {o.strategy}
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="gm-btn"
          disabled={busy}
          data-testid="stock-intraday-shadow-scan"
          onClick={() =>
            void run(() => api.stockIntradayShadowScan(["AAPL", "MSFT", "NVDA", "SPY"]))
          }
        >
          Run shadow scan
        </button>
      </section>

      <section className="gm-section gm-autotrade-panel" data-testid="stock-intraday-shadow-performance">
        <div className="gm-section-head">
          <h2 className="gm-section-title">Shadow Performance</h2>
          <p className="gm-meta">
            {status?.shadowPerformance?.disclaimer ??
              "SHADOW results are hypothetical validation only and do not guarantee future performance."}
          </p>
        </div>
        <div className="gm-autotrade-metrics">
          <div>
            <span className="gm-label">Sessions</span>
            <strong>{status?.shadowPerformance?.marketSessionsObserved ?? 0}</strong>
          </div>
          <div>
            <span className="gm-label">Evaluated</span>
            <strong>{status?.shadowPerformance?.opportunitiesEvaluated ?? 0}</strong>
          </div>
          <div>
            <span className="gm-label">Opened</span>
            <strong>{status?.shadowPerformance?.tradesOpened ?? 0}</strong>
          </div>
          <div>
            <span className="gm-label">Closed</span>
            <strong>{status?.shadowPerformance?.tradesClosed ?? 0}</strong>
          </div>
          <div>
            <span className="gm-label">Win rate</span>
            <strong>
              {status?.shadowPerformance?.winRate == null
                ? "—"
                : `${(status.shadowPerformance.winRate * 100).toFixed(1)}%`}
            </strong>
          </div>
          <div>
            <span className="gm-label">Loss rate</span>
            <strong>
              {status?.shadowPerformance?.lossRate == null
                ? "—"
                : `${(status.shadowPerformance.lossRate * 100).toFixed(1)}%`}
            </strong>
          </div>
          <div>
            <span className="gm-label">Gross P/L</span>
            <strong>{money(status?.shadowPerformance?.grossPnl)}</strong>
          </div>
          <div>
            <span className="gm-label">Net P/L</span>
            <strong>{money(status?.shadowPerformance?.netPnl)}</strong>
          </div>
          <div>
            <span className="gm-label">Avg win</span>
            <strong>{money(status?.shadowPerformance?.averageWin)}</strong>
          </div>
          <div>
            <span className="gm-label">Avg loss</span>
            <strong>{money(status?.shadowPerformance?.averageLoss)}</strong>
          </div>
          <div>
            <span className="gm-label">Profit factor</span>
            <strong>
              {status?.shadowPerformance?.profitFactor == null
                ? "—"
                : status.shadowPerformance.profitFactor.toFixed(2)}
            </strong>
          </div>
          <div>
            <span className="gm-label">Max drawdown</span>
            <strong>{money(status?.shadowPerformance?.maximumDrawdown)}</strong>
          </div>
          <div>
            <span className="gm-label">Max consec. losses</span>
            <strong>{status?.shadowPerformance?.maximumConsecutiveLosses ?? 0}</strong>
          </div>
          <div>
            <span className="gm-label">Avg hold (min)</span>
            <strong>
              {status?.shadowPerformance?.averageHoldingTimeMinutes == null
                ? "—"
                : status.shadowPerformance.averageHoldingTimeMinutes.toFixed(1)}
            </strong>
          </div>
          <div>
            <span className="gm-label">Stop exits</span>
            <strong>{status?.shadowPerformance?.stopLossExits ?? 0}</strong>
          </div>
          <div>
            <span className="gm-label">Take-profit exits</span>
            <strong>{status?.shadowPerformance?.takeProfitExits ?? 0}</strong>
          </div>
          <div>
            <span className="gm-label">Trailing exits</span>
            <strong>{status?.shadowPerformance?.trailingStopExits ?? 0}</strong>
          </div>
          <div>
            <span className="gm-label">Invalidation exits</span>
            <strong>{status?.shadowPerformance?.strategyInvalidationExits ?? 0}</strong>
          </div>
          <div>
            <span className="gm-label">EOD exits</span>
            <strong>{status?.shadowPerformance?.endOfDayExits ?? 0}</strong>
          </div>
          <div>
            <span className="gm-label">Blocked</span>
            <strong>{status?.shadowPerformance?.blockedOpportunities ?? 0}</strong>
          </div>
          <div>
            <span className="gm-label">Data outages</span>
            <strong>{status?.shadowPerformance?.dataOutages ?? 0}</strong>
          </div>
          <div>
            <span className="gm-label">Stale blocks</span>
            <strong>{status?.shadowPerformance?.staleDataBlocks ?? 0}</strong>
          </div>
          <div>
            <span className="gm-label">Divergence blocks</span>
            <strong>{status?.shadowPerformance?.providerDivergenceBlocks ?? 0}</strong>
          </div>
        </div>
        {(status?.readinessGates?.length ?? 0) > 0 ? (
          <ul className="gm-autotrade-limits-list" data-testid="stock-intraday-readiness-gates">
            {status!.readinessGates!.map((g) => (
              <li key={g.id}>
                <strong>{g.ok ? "OK" : "FAIL"}</strong> {g.id} — {g.detail}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="gm-section gm-autotrade-panel" data-testid="stock-intraday-positions">
        <div className="gm-section-head">
          <h2 className="gm-section-title">GoldMeta-managed positions</h2>
          <p className="gm-meta">Personal holdings are never shown or sold here.</p>
        </div>
        {(status?.positions?.length ?? 0) === 0 ? (
          <p className="gm-empty">No GoldMeta-managed positions.</p>
        ) : (
          <ul className="gm-autotrade-positions">
            {status!.positions.map((p) => (
              <li key={p.positionId}>
                <strong>
                  {p.quantity} {p.symbol}
                </strong>
                <span>
                  Entry {p.entryPrice} · Stop {p.stop ?? "—"} · Target {p.takeProfit ?? "—"} ·{" "}
                  {p.currentExitRule}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="gm-section gm-autotrade-panel" data-testid="stock-intraday-activity">
        <div className="gm-section-head">
          <h2 className="gm-section-title">Activity</h2>
        </div>
        {(status?.activity?.length ?? 0) === 0 ? (
          <p className="gm-empty">No activity yet.</p>
        ) : (
          <ol className="gm-autotrade-log">
            {status!.activity.map((entry) => (
              <li key={entry.id} data-level={entry.level}>
                <time>{new Date(entry.at).toLocaleString()}</time>
                <span>{entry.message}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
