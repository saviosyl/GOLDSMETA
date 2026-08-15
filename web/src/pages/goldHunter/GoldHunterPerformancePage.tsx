import { useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import type { GoldHunterPerformanceBucket, GoldHunterTrade } from "../../lib/api";
import { formatEur, useGoldHunter } from "./GoldHunterShell";
import { formatResearchLocalTime, formatResearchUtcTime } from "../../lib/formatResearchLocalTime";

type Range = "today" | "week" | "month" | "all";
type Tab = "demo" | "paper";

export function GoldHunterPerformancePage() {
  const { api } = useAuth();
  const { status } = useGoldHunter();
  const [range, setRange] = useState<Range>("today");
  const [tab, setTab] = useState<Tab>("demo");
  const [demo, setDemo] = useState<GoldHunterPerformanceBucket | null>(null);
  const [trades, setTrades] = useState<GoldHunterTrade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      api.goldHunterPerformance(range),
      api.goldHunterTrades()
    ])
      .then(([perf, t]) => {
        if (cancelled) return;
        setDemo(perf.demo);
        setTrades(t.trades);
      })
      .catch(() => {
        if (!cancelled) {
          setDemo(null);
          setTrades([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, status?.config.updatedAt]);

  return (
    <div data-testid="gh-performance">
      <div className="gh-tabs-range" role="tablist" aria-label="Performance source">
        <button
          type="button"
          className={tab === "demo" ? "active" : undefined}
          onClick={() => setTab("demo")}
        >
          DEMO
        </button>
        <button
          type="button"
          className={tab === "paper" ? "active" : undefined}
          onClick={() => setTab("paper")}
        >
          PAPER
        </button>
      </div>

      {tab === "paper" ? (
        <div className="gh-card">
          <h3>Reference paper</h3>
          <div className="gh-empty">
            Paper performance is kept separate from Demo P/L.
            <br />
            No paper series attached in this release.
          </div>
        </div>
      ) : (
        <>
          <div className="gh-tabs-range" role="tablist" aria-label="Range">
            {(["today", "week", "month", "all"] as const).map((r) => (
              <button
                key={r}
                type="button"
                className={range === r ? "active" : undefined}
                onClick={() => setRange(r)}
              >
                {r === "all" ? "All" : r[0]!.toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>

          {loading || !demo ? (
            <div className="gh-empty">Loading Demo performance…</div>
          ) : (
            <>
              <div className="gh-grid-2">
                <div className="gh-card">
                  <div className="gh-kpi-label">Net P/L</div>
                  <div
                    className={`gh-kpi-value ${demo.netPnl > 0 ? "pos" : demo.netPnl < 0 ? "neg" : ""}`}
                  >
                    {formatEur(demo.netPnl)}
                  </div>
                </div>
                <div className="gh-card">
                  <div className="gh-kpi-label">Trades</div>
                  <div className="gh-kpi-value">{demo.trades}</div>
                </div>
              </div>
              <div className="gh-grid-3">
                <div className="gh-card">
                  <div className="gh-kpi-label">Win rate</div>
                  <div className="gh-kpi-value">
                    {demo.winRate != null ? `${(demo.winRate * 100).toFixed(0)}%` : "—"}
                  </div>
                </div>
                <div className="gh-card">
                  <div className="gh-kpi-label">Profit factor</div>
                  <div className="gh-kpi-value">
                    {demo.profitFactor != null ? demo.profitFactor.toFixed(2) : "—"}
                  </div>
                </div>
                <div className="gh-card">
                  <div className="gh-kpi-label">Max DD</div>
                  <div className="gh-kpi-value">
                    {demo.maxDrawdown != null ? formatEur(-demo.maxDrawdown).replace("+", "") : "—"}
                  </div>
                </div>
              </div>
              <div className="gh-grid-3">
                <div className="gh-card">
                  <div className="gh-kpi-label">Avg win</div>
                  <div className="gh-kpi-value">{formatEur(demo.avgWin)}</div>
                </div>
                <div className="gh-card">
                  <div className="gh-kpi-label">Avg loss</div>
                  <div className="gh-kpi-value">{formatEur(demo.avgLoss)}</div>
                </div>
                <div className="gh-card">
                  <div className="gh-kpi-label">Expectancy</div>
                  <div className="gh-kpi-value">{formatEur(demo.expectancy)}</div>
                </div>
              </div>
            </>
          )}

          <h3 className="gh-section-title" style={{ marginTop: 8 }}>
            Demo trade history
          </h3>
          {trades.length === 0 ? (
            <div className="gh-empty" data-testid="gh-no-trades">
              No Gold Hunter Demo trades yet
            </div>
          ) : (
            <>
              <div className="gh-mobile-trades">
                {trades.map((t) => (
                  <article key={t.goldHunterTradeId} className="gh-trade-card">
                    <header>
                      <div>
                        <span className="gh-badge gh-badge--demo">DEMO ORDER</span>{" "}
                        <span className="gh-badge">{t.side}</span>
                      </div>
                      <strong>{t.result ?? t.status}</strong>
                    </header>
                    <div className="gh-trade-grid">
                      <div>
                        <span>ID</span>
                        <strong>{t.goldHunterTradeId}</strong>
                      </div>
                      <div>
                        <span>Setup</span>
                        <strong>{t.setup ?? "—"}</strong>
                      </div>
                      <div>
                        <span>Entry</span>
                        <strong>{t.entry?.toFixed(2) ?? "—"}</strong>
                      </div>
                      <div>
                        <span>Exit</span>
                        <strong>{t.exit?.toFixed(2) ?? "—"}</strong>
                      </div>
                      <div>
                        <span>Net P/L</span>
                        <strong>{formatEur(t.netPnlEur)}</strong>
                      </div>
                      <div>
                        <span>Filled</span>
                        <strong title={formatResearchUtcTime(t.fillTs)}>
                          {formatResearchLocalTime(t.fillTs)}
                        </strong>
                      </div>
                    </div>
                    <p className="hint" style={{ marginTop: 8 }}>
                      strategy=GOLD_HUNTER · environment=DEMO
                    </p>
                  </article>
                ))}
              </div>
              <div className="gh-table-wrap">
                <table className="gh-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Side</th>
                      <th>Setup</th>
                      <th>Entry</th>
                      <th>Exit</th>
                      <th>Net</th>
                      <th>Result</th>
                      <th>Filled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t) => (
                      <tr key={t.goldHunterTradeId}>
                        <td>{t.goldHunterTradeId}</td>
                        <td>{t.side}</td>
                        <td>{t.setup ?? "—"}</td>
                        <td>{t.entry?.toFixed(2) ?? "—"}</td>
                        <td>{t.exit?.toFixed(2) ?? "—"}</td>
                        <td>{formatEur(t.netPnlEur)}</td>
                        <td>{t.result ?? t.status}</td>
                        <td title={formatResearchUtcTime(t.fillTs)}>
                          {formatResearchLocalTime(t.fillTs)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
