import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import type { SetupAnalyticsSummary } from "../types/models";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}

const fmt = (v: number | null | undefined, suffix = ""): string =>
  v == null || Number.isNaN(v) ? "—" : `${v}${suffix}`;

export function AnalyticsPage() {
  const { api } = useAuth();
  const [environment, setEnvironment] = useState<"LIVE" | "TEST">("LIVE");
  const [analytics, setAnalytics] = useState<SetupAnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void api
      .setupAnalytics(environment)
      .then(setAnalytics)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load analytics"))
      .finally(() => setLoading(false));
  }, [api, environment]);

  return (
    <div className="analytics-page">
      <h1 className="brand" style={{ fontSize: "1.4rem" }}>
        Analytics
      </h1>
      <p className="subtitle">Setup outcomes — LIVE and TEST are never combined.</p>

      <div className="history-filters" role="tablist" aria-label="Environment">
        {(["LIVE", "TEST"] as const).map((env) => (
          <button
            key={env}
            type="button"
            role="tab"
            aria-selected={environment === env}
            className={`history-filter ${environment === env ? "active" : ""}`}
            onClick={() => setEnvironment(env)}
          >
            {env}
          </button>
        ))}
      </div>

      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      {loading && (
        <div className="card" role="status">
          Loading analytics…
        </div>
      )}

      {!loading && analytics && analytics.completedSetups === 0 && (
        <div className="card" data-testid="analytics-empty">
          <h2>No completed setups</h2>
          <p className="muted">
            Analytics appear after BUY/SELL setups resolve. Small samples are not statistically
            significant — profitability is not proven.
          </p>
        </div>
      )}

      {!loading && analytics && (
        <>
          {analytics.sampleSizeWarning && (
            <div className="banner stale" role="status" data-testid="sample-warning">
              {analytics.sampleSizeWarning}
            </div>
          )}

          <section className="card">
            <h2 className="section-title">{environment} summary</h2>
            <div className="grid-2">
              <Metric label="Completed" value={String(analytics.completedSetups)} />
              <Metric label="Active" value={String(analytics.activeSetups)} />
              <Metric label="Win rate" value={fmt(analytics.winRate, "%")} />
              <Metric label="Avg R" value={fmt(analytics.averageR, "R")} />
              <Metric label="Cumulative R" value={fmt(analytics.cumulativeR, "R")} />
              <Metric label="Expectancy" value={fmt(analytics.expectancyR, "R")} />
            </div>
          </section>

          <section className="card">
            <h2 className="section-title">Outcomes</h2>
            <div className="grid-2">
              <Metric label="Wins" value={String(analytics.wins)} />
              <Metric label="Losses" value={String(analytics.losses)} />
              <Metric label="Expired" value={String(analytics.expired)} />
              <Metric label="Ambiguous" value={String(analytics.ambiguous)} />
              <Metric label="TP1 hit rate" value={fmt(analytics.tp1HitRate, "%")} />
              <Metric label="SL hit rate" value={fmt(analytics.slHitRate, "%")} />
              <Metric label="Avg MFE" value={fmt(analytics.averageMfe, "R")} />
              <Metric label="Avg MAE" value={fmt(analytics.averageMae, "R")} />
            </div>
          </section>

          <section className="card">
            <h2 className="section-title">BUY vs SELL</h2>
            <div className="grid-2">
              <Metric label="BUY setups" value={String(analytics.byDirection.BUY)} />
              <Metric label="SELL setups" value={String(analytics.byDirection.SELL)} />
            </div>
          </section>

          <section className="card">
            <h2 className="section-title">By session</h2>
            <div className="grid-2">
              {Object.keys(analytics.bySession).length === 0 && (
                <p className="muted">No session data yet.</p>
              )}
              {Object.entries(analytics.bySession).map(([session, count]) => (
                <Metric key={session} label={session} value={String(count)} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
