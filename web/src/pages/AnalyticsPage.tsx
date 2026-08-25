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
      <p className="subtitle">
        LIVE forward-testing and TEST fixtures stay separate. System R ≠ manual account P/L.
      </p>

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
            Analytics appear after BUY/SELL setups resolve. Early positive results do not prove the
            strategy is profitable.
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
            <h2 className="section-title">{environment} system performance</h2>
            <p className="muted">GoldMeta theoretical / raw outcomes only.</p>
            <div className="grid-2">
              <Metric label="Total setups" value={String(analytics.totalSetups)} />
              <Metric label="Completed" value={String(analytics.completedSetups)} />
              <Metric label="Active" value={String(analytics.activeSetups)} />
              <Metric label="Entries" value={String(analytics.entriesTriggered ?? "—")} />
              <Metric label="Expired pre-entry" value={String(analytics.expiredBeforeEntry ?? "—")} />
              <Metric label="Win rate" value={fmt(analytics.winRate, "%")} />
              <Metric label="Loss rate" value={fmt(analytics.lossRate, "%")} />
              <Metric label="Avg R" value={fmt(analytics.averageR, "R")} />
              <Metric label="Raw total R" value={fmt(analytics.cumulativeR, "R")} />
              <Metric label="Expectancy" value={fmt(analytics.expectancyR, "R")} />
              <Metric label="Profit factor" value={fmt(analytics.profitFactorR)} />
              <Metric label="Max losing streak" value={String(analytics.maxLosingStreak ?? "—")} />
              <Metric label="Max DD (R)" value={fmt(analytics.maxDrawdownR, "R")} />
            </div>
          </section>

          <section className="card">
            <h2 className="section-title">Outcomes</h2>
            <div className="grid-2">
              <Metric label="Wins" value={String(analytics.wins)} />
              <Metric label="Losses" value={String(analytics.losses)} />
              <Metric label="TP1" value={String(analytics.tp1Hits ?? "—")} />
              <Metric label="TP2" value={String(analytics.tp2Hits ?? "—")} />
              <Metric label="TP3" value={String(analytics.tp3Hits ?? "—")} />
              <Metric label="Stopped" value={String(analytics.stopped ?? "—")} />
              <Metric label="Expired" value={String(analytics.expired)} />
              <Metric label="Ambiguous" value={String(analytics.ambiguous)} />
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

          {analytics.byDayOfWeek && Object.keys(analytics.byDayOfWeek).length > 0 && (
            <section className="card">
              <h2 className="section-title">By day of week</h2>
              <div className="grid-2">
                {Object.entries(analytics.byDayOfWeek).map(([day, count]) => (
                  <Metric key={day} label={day} value={String(count)} />
                ))}
              </div>
            </section>
          )}

          {analytics.byConfidenceBand && Object.keys(analytics.byConfidenceBand).length > 0 && (
            <section className="card">
              <h2 className="section-title">By confidence band</h2>
              <div className="grid-2">
                {Object.entries(analytics.byConfidenceBand).map(([band, count]) => (
                  <Metric key={band} label={band} value={String(count)} />
                ))}
              </div>
            </section>
          )}

          <section className="card" data-testid="manual-analytics">
            <h2 className="section-title">Manual account (optional, separate)</h2>
            <p className="muted">Never mixed with system R metrics above.</p>
            <div className="grid-2">
              <Metric label="Entered" value={String(analytics.manual?.entered ?? 0)} />
              <Metric label="Skipped" value={String(analytics.manual?.skipped ?? 0)} />
              <Metric label="With P/L" value={String(analytics.manual?.withPnl ?? 0)} />
              <Metric
                label="Manual P/L total"
                value={fmt(analytics.manual?.totalManualPnl ?? null)}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
