import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../lib/auth";

type Premium = {
  totalAnalyses?: number;
  candidates?: number;
  rejected?: number;
  shadowPlans?: number;
  wins?: number;
  losses?: number;
  expectancyR?: number | null;
  profitFactor?: number | null;
  averageWinR?: number | null;
  averageLossR?: number | null;
  maxDrawdownR?: number | null;
  averageHoldBars?: number | null;
  averageMfe?: number | null;
  averageMae?: number | null;
  sampleSize?: number;
  sampleSizeWarning?: string;
  rejectionReasons?: Record<string, number>;
  strategyComparison?: Array<{ key: string; sampleSize: number; profitFactor: number | null }>;
  sessionComparison?: Array<{ key: string; sampleSize: number; profitFactor: number | null }>;
  unsafePlanCount?: number;
  planMutationCount?: number;
};

/** Premium filterable V4 shadow analytics — separate from V3. */
export function PremiumAnalyticsPage() {
  const { api } = useAuth();
  const [session, setSession] = useState("");
  const [direction, setDirection] = useState("");
  const [data, setData] = useState<Premium | null>(null);
  const [learning, setLearning] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filters: {
    environment: "LIVE";
    session?: string;
    direction?: "BUY" | "SELL";
  } = useMemo(() => {
    return {
      environment: "LIVE",
      session: session || undefined,
      direction: direction === "BUY" || direction === "SELL" ? direction : undefined
    };
  }, [session, direction]);

  useEffect(() => {
    void (async () => {
      try {
        const [a, l] = await Promise.all([
          api.v5PremiumAnalytics(filters),
          api.v5Learning("LIVE")
        ]);
        setData(a);
        setLearning(l);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Analytics failed");
      }
    })();
  }, [api, filters]);

  return (
    <div className="v5-page" data-testid="premium-analytics-page">
      <h1 className="brand" style={{ fontSize: "1.45rem" }}>
        Premium analytics
      </h1>
      <p className="subtitle">V4 shadow intelligence — filterable. Not proof of edge.</p>

      <section className="card">
        <div className="history-filters" role="group" aria-label="Filters">
          <button
            type="button"
            className={`history-filter ${!session ? "active" : ""}`}
            onClick={() => setSession("")}
          >
            All sessions
          </button>
          {["LONDON", "NEWYORK", "ASIA", "OVERLAP"].map((s) => (
            <button
              key={s}
              type="button"
              className={`history-filter ${session === s ? "active" : ""}`}
              onClick={() => setSession(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="history-filters" role="group" aria-label="Direction">
          <button
            type="button"
            className={`history-filter ${!direction ? "active" : ""}`}
            onClick={() => setDirection("")}
          >
            Both
          </button>
          <button
            type="button"
            className={`history-filter ${direction === "BUY" ? "active" : ""}`}
            onClick={() => setDirection("BUY")}
          >
            BUY
          </button>
          <button
            type="button"
            className={`history-filter ${direction === "SELL" ? "active" : ""}`}
            onClick={() => setDirection("SELL")}
          >
            SELL
          </button>
        </div>
      </section>

      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      {data && (
        <>
          <div className="banner stale" role="status">
            {data.sampleSizeWarning}
          </div>
          <section className="card v5-glass">
            <div className="grid-2">
              <div className="metric">
                <span className="label">Analyses</span>
                <span className="value">{data.totalAnalyses ?? 0}</span>
              </div>
              <div className="metric">
                <span className="label">Candidates</span>
                <span className="value">{data.candidates ?? 0}</span>
              </div>
              <div className="metric">
                <span className="label">Rejected</span>
                <span className="value">{data.rejected ?? 0}</span>
              </div>
              <div className="metric">
                <span className="label">Shadow plans</span>
                <span className="value">{data.shadowPlans ?? 0}</span>
              </div>
              <div className="metric">
                <span className="label">Wins / Losses</span>
                <span className="value">
                  {data.wins ?? 0} / {data.losses ?? 0}
                </span>
              </div>
              <div className="metric">
                <span className="label">Expectancy R</span>
                <span className="value">{String(data.expectancyR ?? "—")}</span>
              </div>
              <div className="metric">
                <span className="label">Profit factor</span>
                <span className="value">{String(data.profitFactor ?? "—")}</span>
              </div>
              <div className="metric">
                <span className="label">Max DD R</span>
                <span className="value">{String(data.maxDrawdownR ?? "—")}</span>
              </div>
              <div className="metric">
                <span className="label">Avg win / loss R</span>
                <span className="value">
                  {String(data.averageWinR ?? "—")} / {String(data.averageLossR ?? "—")}
                </span>
              </div>
              <div className="metric">
                <span className="label">MFE / MAE</span>
                <span className="value">
                  {String(data.averageMfe ?? "—")} / {String(data.averageMae ?? "—")}
                </span>
              </div>
              <div className="metric">
                <span className="label">Unsafe / mutations</span>
                <span className="value">
                  {data.unsafePlanCount ?? 0} / {data.planMutationCount ?? 0}
                </span>
              </div>
              <div className="metric">
                <span className="label">Avg hold (bars)</span>
                <span className="value">{String(data.averageHoldBars ?? "—")}</span>
              </div>
            </div>
          </section>

          <section className="card">
            <h2 className="section-title">Rejection reasons</h2>
            <ul className="list">
              {Object.entries(data.rejectionReasons ?? {})
                .slice(0, 12)
                .map(([k, v]) => (
                  <li key={k}>
                    <strong>{k}</strong> · {v}
                  </li>
                ))}
              {Object.keys(data.rejectionReasons ?? {}).length === 0 && (
                <li className="muted">None yet</li>
              )}
            </ul>
          </section>

          <section className="card">
            <h2 className="section-title">Strategy comparison</h2>
            <ul className="list">
              {(data.strategyComparison ?? []).map((s) => (
                <li key={s.key}>
                  <strong>{s.key}</strong> · n={s.sampleSize} · PF={String(s.profitFactor ?? "—")}
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2 className="section-title">London vs NY (sessions)</h2>
            <ul className="list">
              {(data.sessionComparison ?? []).map((s) => (
                <li key={s.key}>
                  <strong>{s.key}</strong> · n={s.sampleSize} · PF={String(s.profitFactor ?? "—")}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {learning && (
        <section className="card v5-glass">
          <h2 className="section-title">Learning insights</h2>
          <p className="muted">Statistics only — rules are not auto-modified.</p>
          <ul className="list">
            {((learning.insights as string[]) ?? []).map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
