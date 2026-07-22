import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../lib/auth";
import { formatSession } from "../lib/plainLanguage";
import {
  EmptyState,
  MetricCard,
  PageHeader,
  SectionCard,
  Tabs
} from "../components/ui/primitives";

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

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "strategies", label: "Strategies" },
  { id: "sessions", label: "Sessions" },
  { id: "risk", label: "Risk" },
  { id: "rejections", label: "Rejections" }
];

/** Premium filterable V4 shadow analytics — separate from V3. */
export function PremiumAnalyticsPage() {
  const { api } = useAuth();
  const [session, setSession] = useState("");
  const [direction, setDirection] = useState("");
  const [tab, setTab] = useState("overview");
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

  const sampleTooSmall = (data?.sampleSize ?? 0) < 20 && (data?.shadowPlans ?? 0) < 5;

  return (
    <div data-testid="premium-analytics-page">
      <PageHeader title="Analytics" environment="LIVE" freshness="V4 shadow only" />
      <p className="gm-meta" style={{ marginTop: -8, marginBottom: 16 }}>
        Filterable V4 shadow intelligence. Not proof of edge. Broker execution remains disabled.
      </p>

      <SectionCard>
        <div className="gm-tabs" role="group" aria-label="Session filters">
          <button type="button" className={!session ? "active" : undefined} onClick={() => setSession("")}>
            All sessions
          </button>
          {["LONDON", "NEWYORK", "ASIA", "OVERLAP"].map((s) => (
            <button
              key={s}
              type="button"
              className={session === s ? "active" : undefined}
              onClick={() => setSession(s)}
            >
              {formatSession(s)}
            </button>
          ))}
        </div>
        <div className="gm-tabs" role="group" aria-label="Direction filters">
          <button type="button" className={!direction ? "active" : undefined} onClick={() => setDirection("")}>
            Both
          </button>
          <button
            type="button"
            className={direction === "BUY" ? "active" : undefined}
            onClick={() => setDirection("BUY")}
          >
            Buy
          </button>
          <button
            type="button"
            className={direction === "SELL" ? "active" : undefined}
            onClick={() => setDirection("SELL")}
          >
            Sell
          </button>
        </div>
      </SectionCard>

      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      <Tabs items={TABS} value={tab} onChange={setTab} />

      {!data && !error && (
        <SectionCard>
          <p className="gm-meta">Loading analytics…</p>
        </SectionCard>
      )}

      {data && sampleTooSmall && (
        <div data-testid="analytics-empty-sample">
          <SectionCard>
            <EmptyState
              title="Not enough verified shadow outcomes yet."
              body={
                data.sampleSizeWarning ??
                "Charts and comparison grids appear when the sample is large enough to be meaningful."
              }
            />
            <div className="gm-metrics-grid" style={{ marginTop: 16 }}>
              <MetricCard label="Analyses" value={data.totalAnalyses ?? 0} />
              <MetricCard label="Shadow plans" value={data.shadowPlans ?? 0} />
              <MetricCard label="Sample size" value={data.sampleSize ?? 0} />
              <MetricCard label="Rejected" value={data.rejected ?? 0} />
            </div>
          </SectionCard>
        </div>
      )}

      {data && !sampleTooSmall && tab === "overview" && (
        <SectionCard title="Overview">
          {data.sampleSizeWarning && (
            <p className="gm-meta" role="status">
              {data.sampleSizeWarning}
            </p>
          )}
          <div className="gm-metrics-grid">
            <MetricCard label="Analyses" value={data.totalAnalyses ?? 0} />
            <MetricCard label="Candidates" value={data.candidates ?? 0} />
            <MetricCard label="Rejected" value={data.rejected ?? 0} />
            <MetricCard label="Shadow plans" value={data.shadowPlans ?? 0} />
            <MetricCard label="Wins / Losses" value={`${data.wins ?? 0} / ${data.losses ?? 0}`} />
            <MetricCard label="Expectancy R" value={String(data.expectancyR ?? "—")} />
            <MetricCard label="Profit factor" value={String(data.profitFactor ?? "—")} />
            <MetricCard label="Max DD R" value={String(data.maxDrawdownR ?? "—")} />
          </div>
        </SectionCard>
      )}

      {data && !sampleTooSmall && tab === "strategies" && (
        <SectionCard title="Strategies">
          {(data.strategyComparison ?? []).length === 0 ? (
            <EmptyState title="No strategy comparison data yet." />
          ) : (
            <ul className="list">
              {(data.strategyComparison ?? []).map((s) => (
                <li key={s.key}>
                  <strong>{s.key}</strong> · n={s.sampleSize} · PF={String(s.profitFactor ?? "—")}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      {data && !sampleTooSmall && tab === "sessions" && (
        <SectionCard title="Sessions">
          {(data.sessionComparison ?? []).length === 0 ? (
            <EmptyState title="No session comparison data yet." />
          ) : (
            <ul className="list">
              {(data.sessionComparison ?? []).map((s) => (
                <li key={s.key}>
                  <strong>{formatSession(s.key)}</strong> · n={s.sampleSize} · PF=
                  {String(s.profitFactor ?? "—")}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      {data && !sampleTooSmall && tab === "risk" && (
        <SectionCard title="Risk">
          <div className="gm-metrics-grid">
            <MetricCard label="Avg win / loss R" value={`${data.averageWinR ?? "—"} / ${data.averageLossR ?? "—"}`} />
            <MetricCard label="MFE / MAE" value={`${data.averageMfe ?? "—"} / ${data.averageMae ?? "—"}`} />
            <MetricCard label="Unsafe plans" value={data.unsafePlanCount ?? 0} />
            <MetricCard label="Plan mutations" value={data.planMutationCount ?? 0} />
            <MetricCard label="Avg hold (bars)" value={String(data.averageHoldBars ?? "—")} />
          </div>
        </SectionCard>
      )}

      {data && !sampleTooSmall && tab === "rejections" && (
        <SectionCard title="Rejections">
          {Object.keys(data.rejectionReasons ?? {}).length === 0 ? (
            <EmptyState title="No rejection reasons recorded yet." />
          ) : (
            <ul className="list">
              {Object.entries(data.rejectionReasons ?? {})
                .slice(0, 12)
                .map(([k, v]) => (
                  <li key={k}>
                    <strong>{k.replace(/_/g, " ")}</strong> · {v}
                  </li>
                ))}
            </ul>
          )}
        </SectionCard>
      )}

      {learning && (
        <SectionCard title="Learning insights">
          <p className="gm-meta">Statistics only — rules are not auto-modified.</p>
          <ul className="list">
            {((learning.insights as string[]) ?? []).map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}
