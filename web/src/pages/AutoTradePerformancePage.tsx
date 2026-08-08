import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";

type Perf = {
  environment?: string;
  period?: string;
  totalTrades?: number;
  wins?: number;
  losses?: number;
  winRate?: number | null;
  netPnl?: number;
  averageWin?: number | null;
  averageLoss?: number | null;
  averageRr?: number | null;
  profitFactor?: number | null;
  largestWin?: number | null;
  largestLoss?: number | null;
  largestDrawdown?: number | null;
  buyWinRate?: number | null;
  sellWinRate?: number | null;
  londonTrades?: number;
  newYorkTrades?: number;
  avgConfidenceWinners?: number | null;
  avgConfidenceLosers?: number | null;
  cumulativePnl?: Array<{ at: string; pnl: number }>;
  recentTrades?: Array<{
    correlationId?: string | null;
    date?: string;
    side?: string;
    entry?: number | null;
    exit?: number | null;
    pnl?: number;
    riskReward?: number | null;
    confidence?: number | null;
    session?: string | null;
    source?: string | null;
    reason?: string | null;
  }>;
};

type Weekly = {
  report?: {
    weekStart?: string;
    weekEnd?: string;
    environment?: string;
    trades?: number;
    wins?: number;
    losses?: number;
    winRate?: number | null;
    netPnl?: number;
    averageRr?: number | null;
    largestDrawdown?: number | null;
    buyWinRate?: number | null;
    sellWinRate?: number | null;
    londonTrades?: number;
    newYorkTrades?: number;
    qualificationLabel?: string;
    safetyEvents?: string[];
    whatWorked?: string[];
    whatStruggled?: string[];
  };
};

function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function num(n: number | null | undefined, d = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(d);
}

function sourceLabel(s?: string | null): string {
  if (!s) return "—";
  if (s === "qualification_controlled") return "Qualification";
  if (s === "demo_auto") return "Auto";
  if (s === "manual") return "Manual";
  return s;
}

function CumulativeChart(props: {
  points: Array<{ at: string; pnl: number }>;
  label: string;
}) {
  const { points, label } = props;
  if (!points.length) {
    return <p className="gm-meta">No completed trades yet.</p>;
  }
  const values = points.map((p) => p.pnl);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const w = 320;
  const h = 120;
  const path = points
    .map((p, i) => {
      const x = (i / Math.max(1, points.length - 1)) * (w - 8) + 4;
      const y = h - 8 - ((p.pnl - min) / span) * (h - 16);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div className="gm-perf-chart" data-testid="cumulative-pnl-chart">
      <p className="gm-perf-chart__label">{label}</p>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
      <p className="gm-meta">
        {points.length} closed · end {num(points[points.length - 1]?.pnl)}
      </p>
    </div>
  );
}

export function AutoTradePerformancePage() {
  const { api } = useAuth();
  const [environment, setEnvironment] = useState<"DEMO" | "LIVE">("DEMO");
  const [period, setPeriod] = useState<"today" | "7d" | "30d" | "all">("7d");
  const [chartPeriod, setChartPeriod] = useState<"7d" | "30d" | "all">("7d");
  const [perf, setPerf] = useState<Perf | null>(null);
  const [chart, setChart] = useState<Perf | null>(null);
  const [weekly, setWeekly] = useState<Weekly | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [p, c, w] = await Promise.all([
          api.getAutoTradePerformance({ environment, period }),
          api.getAutoTradePerformance({ environment, period: chartPeriod }),
          api.getWeeklyGoldMetaReport(environment)
        ]);
        if (cancelled) return;
        setPerf(p as Perf);
        setChart(c as Perf);
        setWeekly(w as Weekly);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Performance unavailable");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, environment, period, chartPeriod]);

  const envLabel = useMemo(
    () =>
      environment === "LIVE" ? "LIVE — REAL MONEY" : "DEMO PERFORMANCE",
    [environment]
  );

  const empty = !perf || (perf.totalTrades ?? 0) === 0;

  return (
    <div className="gm-page gm-perf-page" data-testid="autotrade-performance-page">
      <header className="gm-perf-page__head">
        <div>
          <p className="gm-label">GoldMeta</p>
          <h1>Performance</h1>
          <p className="gm-meta">{envLabel}</p>
        </div>
        <Link className="gm-btn gm-btn--ghost" to="/autotrade">
          AutoTrade
        </Link>
      </header>

      <div className="gm-perf-filters" role="group" aria-label="Environment">
        {(["DEMO", "LIVE"] as const).map((e) => (
          <button
            key={e}
            type="button"
            className={environment === e ? "is-active" : ""}
            onClick={() => setEnvironment(e)}
          >
            {e}
          </button>
        ))}
      </div>
      <div className="gm-perf-filters" role="group" aria-label="Period">
        {(
          [
            ["today", "TODAY"],
            ["7d", "7 DAYS"],
            ["30d", "30 DAYS"],
            ["all", "ALL"]
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={period === id ? "is-active" : ""}
            onClick={() => setPeriod(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <p className="gm-error">{error}</p> : null}

      {empty ? (
        <p className="gm-perf-empty" data-testid="perf-empty">
          No completed trades yet.
        </p>
      ) : (
        <section className="gm-perf-metrics">
          <div>
            <span>Total trades</span>
            <strong>{perf?.totalTrades ?? 0}</strong>
          </div>
          <div>
            <span>Wins</span>
            <strong>{perf?.wins ?? 0}</strong>
          </div>
          <div>
            <span>Losses</span>
            <strong>{perf?.losses ?? 0}</strong>
          </div>
          <div>
            <span>Win rate</span>
            <strong>{pct(perf?.winRate)}</strong>
          </div>
          <div>
            <span>Net P/L</span>
            <strong>{num(perf?.netPnl)}</strong>
          </div>
          <div>
            <span>Average win</span>
            <strong>{num(perf?.averageWin)}</strong>
          </div>
          <div>
            <span>Average loss</span>
            <strong>{num(perf?.averageLoss)}</strong>
          </div>
          <div>
            <span>Average R:R</span>
            <strong>{num(perf?.averageRr)}</strong>
          </div>
          <div>
            <span>Profit factor</span>
            <strong>{num(perf?.profitFactor)}</strong>
          </div>
          <div>
            <span>Largest win</span>
            <strong>{num(perf?.largestWin)}</strong>
          </div>
          <div>
            <span>Largest loss</span>
            <strong>{num(perf?.largestLoss)}</strong>
          </div>
          <div>
            <span>Max drawdown</span>
            <strong>{num(perf?.largestDrawdown)}</strong>
          </div>
          <div>
            <span>BUY win rate</span>
            <strong>{pct(perf?.buyWinRate)}</strong>
          </div>
          <div>
            <span>SELL win rate</span>
            <strong>{pct(perf?.sellWinRate)}</strong>
          </div>
          <div>
            <span>London trades</span>
            <strong>{perf?.londonTrades ?? 0}</strong>
          </div>
          <div>
            <span>New York trades</span>
            <strong>{perf?.newYorkTrades ?? 0}</strong>
          </div>
          <div>
            <span>Avg conf. winners</span>
            <strong>{num(perf?.avgConfidenceWinners, 0)}</strong>
          </div>
          <div>
            <span>Avg conf. losers</span>
            <strong>{num(perf?.avgConfidenceLosers, 0)}</strong>
          </div>
        </section>
      )}

      <section className="gm-perf-section">
        <div className="gm-perf-section__head">
          <h2>Cumulative P/L</h2>
          <div className="gm-perf-filters">
            {(
              [
                ["7d", "7D"],
                ["30d", "30D"],
                ["all", "All"]
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={chartPeriod === id ? "is-active" : ""}
                onClick={() => setChartPeriod(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <CumulativeChart
          points={chart?.cumulativePnl ?? []}
          label={envLabel}
        />
      </section>

      <section className="gm-perf-section">
        <h2>Recent trades</h2>
        {!perf?.recentTrades?.length ? (
          <p className="gm-meta">No completed trades yet.</p>
        ) : (
          <ul className="gm-perf-trades">
            {perf.recentTrades.map((t, i) => (
              <li key={`${t.correlationId ?? i}-${t.date}`}>
                <Link
                  to={
                    t.correlationId
                      ? `/journal?correlationId=${encodeURIComponent(t.correlationId)}`
                      : "/journal"
                  }
                >
                  <span>{t.date ? new Date(t.date).toLocaleDateString() : "—"}</span>
                  <span>{t.side}</span>
                  <span>{num(t.entry)}</span>
                  <span>{num(t.exit)}</span>
                  <span>{num(t.pnl)}</span>
                  <span>{num(t.riskReward)}</span>
                  <span>{num(t.confidence, 0)}</span>
                  <span>{t.session ?? "—"}</span>
                  <span>{sourceLabel(t.source)}</span>
                  <span className="gm-meta">{t.reason ?? "—"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="gm-perf-section" data-testid="weekly-report-section">
        <h2>Weekly GoldMeta Report</h2>
        {weekly?.report ? (
          <>
            <p className="gm-meta">
              {weekly.report.weekStart} → {weekly.report.weekEnd} ·{" "}
              {weekly.report.environment}
            </p>
            <dl className="gm-perf-weekly">
              <div>
                <dt>Trades</dt>
                <dd>{weekly.report.trades ?? 0}</dd>
              </div>
              <div>
                <dt>Wins / Losses</dt>
                <dd>
                  {weekly.report.wins ?? 0} / {weekly.report.losses ?? 0}
                </dd>
              </div>
              <div>
                <dt>Win rate</dt>
                <dd>{pct(weekly.report.winRate)}</dd>
              </div>
              <div>
                <dt>Net P/L</dt>
                <dd>{num(weekly.report.netPnl)}</dd>
              </div>
              <div>
                <dt>Avg R:R</dt>
                <dd>{num(weekly.report.averageRr)}</dd>
              </div>
              <div>
                <dt>Largest drawdown</dt>
                <dd>{num(weekly.report.largestDrawdown)}</dd>
              </div>
            </dl>
            <p className="gm-meta">{weekly.report.qualificationLabel}</p>
            <h3>What worked</h3>
            <ul>
              {(weekly.report.whatWorked ?? ["Not enough completed trades yet."]).map(
                (line) => (
                  <li key={line}>{line}</li>
                )
              )}
            </ul>
            <h3>What struggled</h3>
            <ul>
              {(weekly.report.whatStruggled ?? ["Not enough completed trades yet."]).map(
                (line) => (
                  <li key={line}>{line}</li>
                )
              )}
            </ul>
          </>
        ) : (
          <p className="gm-meta">Not enough completed trades yet.</p>
        )}
      </section>
    </div>
  );
}
