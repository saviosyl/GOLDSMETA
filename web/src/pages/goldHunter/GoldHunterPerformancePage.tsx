import { useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import type { GoldHunterPerformanceBucket } from "../../lib/api";
import { formatEur, useGoldHunter } from "./GoldHunterShell";

type Range = "today" | "week" | "month" | "all";

export function GoldHunterPerformancePage() {
  const { api } = useAuth();
  const { status } = useGoldHunter();
  const [range, setRange] = useState<Range>("today");
  const [demo, setDemo] = useState<GoldHunterPerformanceBucket | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api.goldHunterPerformance(range)
      .then((result) => {
        if (!cancelled) setDemo(result.demo);
      })
      .catch(() => {
        if (!cancelled) setDemo(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, range, status?.config.updatedAt]);

  return (
    <div className="gh26-page" data-testid="gh-performance">
      <div className="gh26-page-head">
        <div><span className="gh26-eyebrow">BROKER-CONFIRMED DEMO RESULTS</span><h1>Performance</h1></div>
        <span className="gh26-mode-badge">DEMO</span>
      </div>

      <div className="gh-tabs-range" role="tablist" aria-label="Performance range">
        {(["today", "week", "month", "all"] as const).map((item) => (
          <button key={item} type="button" className={range === item ? "active" : undefined} onClick={() => setRange(item)}>
            {item === "all" ? "All" : item[0]!.toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      {loading || !demo ? (
        <div className="gh26-card"><p className="gh26-muted">Loading Demo performance…</p></div>
      ) : (
        <>
          <section className="gh26-kpis">
            <article><span>Net P/L</span><strong className={demo.netPnl < 0 ? "is-negative" : demo.netPnl > 0 ? "is-positive" : ""}>{formatEur(demo.netPnl)}</strong></article>
            <article><span>Trades</span><strong>{demo.trades}</strong></article>
            <article><span>Win rate</span><strong>{demo.winRate != null ? `${Math.round(demo.winRate * 100)}%` : "—"}</strong></article>
            <article><span>Profit factor</span><strong>{demo.profitFactor != null ? demo.profitFactor.toFixed(2) : "—"}</strong></article>
          </section>

          <section className="gh26-grid-2">
            <article className="gh26-card">
              <div className="gh26-card-head"><div><span className="gh26-eyebrow">TRADE QUALITY</span><h2>Average outcome</h2></div></div>
              <div className="gh26-trade-grid">
                <div><span>Average win</span><strong className="is-positive">{formatEur(demo.avgWin)}</strong></div>
                <div><span>Average loss</span><strong className="is-negative">{formatEur(demo.avgLoss)}</strong></div>
                <div><span>Expectancy</span><strong>{formatEur(demo.expectancy)}</strong></div>
                <div><span>Max drawdown</span><strong className="is-negative">{demo.maxDrawdown != null ? formatEur(-Math.abs(demo.maxDrawdown)).replace("+", "") : "—"}</strong></div>
              </div>
            </article>

            <article className="gh26-card">
              <div className="gh26-card-head"><div><span className="gh26-eyebrow">WINS / LOSSES</span><h2>{demo.wins} wins · {demo.losses} losses</h2></div></div>
              <div className="gh26-performance-bar" aria-label={`${demo.wins} wins and ${demo.losses} losses`}>
                <span className="is-win" style={{ width: `${demo.trades ? (demo.wins / demo.trades) * 100 : 0}%` }} />
                <span className="is-loss" style={{ width: `${demo.trades ? (demo.losses / demo.trades) * 100 : 0}%` }} />
              </div>
              <p>Only actual Gold Hunter Demo trades are counted here. Hypothetical GoldMeta signal results stay in the normal History area.</p>
            </article>
          </section>
        </>
      )}
    </div>
  );
}
