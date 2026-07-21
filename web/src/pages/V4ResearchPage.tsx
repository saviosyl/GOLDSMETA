import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";

/** V4 research panel — never presents shadow output as an actionable trade. */
export function V4ResearchPage() {
  const { api } = useAuth();
  const [status, setStatus] = useState<{
    strategyVersion?: string;
    deploymentStage?: string;
    actionableLiveEnabled?: boolean;
    shadowComputeEnabled?: boolean;
    note?: string;
  } | null>(null);
  const [shadows, setShadows] = useState<unknown[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [s, sh] = await Promise.all([api.v4Status(), api.v4Shadows(20)]);
        setStatus(s);
        setShadows(sh);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load V4 research status");
      }
    })();
  }, [api]);

  return (
    <div className="v4-research-page">
      <h1 className="brand" style={{ fontSize: "1.4rem" }}>
        GoldMeta V4 Research
      </h1>
      <p className="subtitle">
        Separate versioned engine (strategyVersion=4). Production remains legacy V3. Not actionable.
      </p>

      <div className="banner stale" role="status" data-testid="v4-wait-banner">
        WAIT — NO VALIDATED EDGE is the default posture. Shadow results are not trade recommendations.
        Setup quality is not win probability. Profit cannot be guaranteed.
      </div>

      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      <section className="card" data-testid="v4-status">
        <h2 className="section-title">Deployment stage</h2>
        <div className="grid-2">
          <div className="metric">
            <span className="label">Strategy</span>
            <span className="value">{status?.strategyVersion ?? "4"}</span>
          </div>
          <div className="metric">
            <span className="label">Stage</span>
            <span className="value">{status?.deploymentStage ?? "RESEARCH"}</span>
          </div>
          <div className="metric">
            <span className="label">Actionable LIVE</span>
            <span className="value">{String(status?.actionableLiveEnabled ?? false)}</span>
          </div>
          <div className="metric">
            <span className="label">Shadow compute</span>
            <span className="value">{String(status?.shadowComputeEnabled ?? "—")}</span>
          </div>
        </div>
        <p className="muted">{status?.note}</p>
      </section>

      <section className="card">
        <h2 className="section-title">ACTIVE LOCKED PLAN (V4)</h2>
        <p className="muted">
          Locked V4 plans are research/shadow only until Stage D acceptance gates pass. Broker mode
          remains DISABLED.
        </p>
        <p className="muted">No actionable V4 locked plan.</p>
      </section>

      <section className="card" data-testid="v4-shadows">
        <h2 className="section-title">LATEST MARKET ANALYSIS (V4 shadow)</h2>
        <p className="muted">
          COMEX GC confirmation is not wired yet — XAUUSD TV profile only. Profile conflicts reduce
          quality; they do not invent trades.
        </p>
        {shadows.length === 0 ? (
          <p className="muted">No shadow records yet.</p>
        ) : (
          <ul className="list">
            {shadows.slice(0, 8).map((s, i) => {
              const row = s as Record<string, unknown>;
              return (
                <li key={String(row.shadowId ?? i)}>
                  <strong>{String(row.generatedAt ?? "—")}</strong>
                  <div className="muted">
                    {Array.isArray(row.noTradeReasons)
                      ? (row.noTradeReasons as string[]).slice(0, 2).join(" · ")
                      : "shadow"}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="disclaimer-footer">
        Do not enable broker execution. Do not treat early V4 research as proof of edge.
      </p>
    </div>
  );
}
