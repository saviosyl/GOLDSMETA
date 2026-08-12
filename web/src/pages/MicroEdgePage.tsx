import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";

type HorizonKey = "1m" | "5m" | "15m";

type HorizonForecast = {
  horizon: HorizonKey;
  pUp: number;
  pDown: number;
  pNoEdge: number;
  expectedSignedMove: number;
  expectedAbsoluteMove: number;
  estimatedFriction: number;
  netEdgeUp: number;
  netEdgeDown: number;
  confidence: number;
  decision: string;
  eligibleOpportunity: boolean;
};

type MicroPrediction = {
  predictionId: string;
  candleCloseTs: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  quoteAgeMs: number;
  dataFreshness: string;
  session: string;
  regime: string;
  modelVersion: string;
  costModelVersion: string;
  strongestHorizon: HorizonKey;
  overallMicroDecision: string;
  forecastAgreementState: string;
  topFactors: string[];
  primaryResearchHorizon: HorizonKey;
  horizons: Record<HorizonKey, HorizonForecast>;
  shadowOnly: true;
  brokerExecutionEnabled: false;
};

type Status = {
  shadowOnly: boolean;
  brokerExecutionEnabled: boolean;
  modelVersion: string;
  featureVersion: string;
  costModelVersion: string;
  labelVersion: string;
  lastCandleCloseTs: string | null;
  disclaimer: string;
};

function pct(x: number | undefined): string {
  if (x == null || Number.isNaN(x)) return "—";
  return `${(x * 100).toFixed(1)}%`;
}

function num(x: number | undefined, d = 3): string {
  if (x == null || Number.isNaN(x)) return "—";
  return x.toFixed(d);
}

export function MicroEdgePage() {
  const { api } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [latest, setLatest] = useState<MicroPrediction | null>(null);
  const [history, setHistory] = useState<MicroPrediction[]>([]);
  const [perf, setPerf] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [s, l, h, p] = await Promise.all([
          api.microEdgeStatus() as Promise<Status>,
          api.microEdgeLatest() as Promise<{ prediction: MicroPrediction | null }>,
          api.microEdgeHistory(30),
          api.microEdgePerformance()
        ]);
        if (cancelled) return;
        setStatus(s);
        setLatest(l.prediction);
        setHistory((h.items ?? []) as unknown as MicroPrediction[]);
        setPerf(p.summary ?? null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load Micro Edge");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const horizons: HorizonKey[] = ["1m", "5m", "15m"];

  return (
    <div className="gm-page gm-micro-edge-page" data-testid="micro-edge-page">
      <header className="gm-page-header">
        <div>
          <h1 className="gm-page-title">Micro Edge</h1>
          <p className="gm-page-sub">
            Isolated shadow research bot — not Core AutoTrade.
          </p>
        </div>
        <div className="gm-micro-badges">
          <span className="gm-chip gm-chip-warn" data-testid="micro-shadow-badge">
            SHADOW ONLY
          </span>
          <span className="gm-chip" data-testid="micro-no-orders-badge">
            NO BROKER ORDERS
          </span>
        </div>
      </header>

      {loading ? <p className="gm-muted">Loading Micro Edge…</p> : null}
      {error ? (
        <div className="gm-banner gm-banner-danger" data-testid="micro-edge-error">
          {error}
        </div>
      ) : null}

      <section className="gm-card gm-micro-status" data-testid="micro-edge-status">
        <h2>Status</h2>
        <div className="gm-micro-grid">
          <div>
            <div className="gm-label">Symbol</div>
            <div>XAUUSD</div>
          </div>
          <div>
            <div className="gm-label">Bid / Ask</div>
            <div>
              {latest ? `${num(latest.bid, 2)} / ${num(latest.ask, 2)}` : "—"}
            </div>
          </div>
          <div>
            <div className="gm-label">Spread</div>
            <div>{latest ? num(latest.spread, 2) : "—"}</div>
          </div>
          <div>
            <div className="gm-label">Freshness</div>
            <div>
              {latest?.dataFreshness ?? "—"}
              {latest ? ` · ${Math.round(latest.quoteAgeMs)}ms` : ""}
            </div>
          </div>
          <div>
            <div className="gm-label">Session / Regime</div>
            <div>
              {latest?.session ?? "—"} / {latest?.regime ?? "—"}
            </div>
          </div>
          <div>
            <div className="gm-label">Model / Cost</div>
            <div className="gm-mono">
              {status?.modelVersion ?? "—"}
              <br />
              {status?.costModelVersion ?? "—"}
            </div>
          </div>
          <div>
            <div className="gm-label">Last M1 evaluation</div>
            <div>{latest?.candleCloseTs ?? status?.lastCandleCloseTs ?? "—"}</div>
          </div>
          <div>
            <div className="gm-label">Execution</div>
            <div>Disabled (shadow)</div>
          </div>
        </div>
        <p className="gm-muted gm-micro-disclaimer">
          Shadow signal only — no broker order is submitted.
        </p>
      </section>

      <section className="gm-micro-horizons" data-testid="micro-edge-horizons">
        <h2>Next move forecasts</h2>
        <div className="gm-micro-horizon-row">
          {horizons.map((h) => {
            const hz = latest?.horizons?.[h];
            const primary = latest?.primaryResearchHorizon === h;
            const strongest = latest?.strongestHorizon === h;
            return (
              <article
                key={h}
                className={`gm-card gm-micro-horizon-card${strongest ? " is-strongest" : ""}`}
                data-testid={`micro-horizon-${h}`}
              >
                <header>
                  <strong>{h.toUpperCase()}</strong>
                  {primary ? (
                    <span className="gm-chip gm-chip-soft">PRIMARY RESEARCH HORIZON</span>
                  ) : null}
                  {strongest ? <span className="gm-chip">Strongest now</span> : null}
                </header>
                <div className="gm-micro-probs">
                  <div>UP {pct(hz?.pUp)}</div>
                  <div>DOWN {pct(hz?.pDown)}</div>
                  <div>NO EDGE {pct(hz?.pNoEdge)}</div>
                </div>
                <div className="gm-micro-meta">
                  <div>E[signed] {num(hz?.expectedSignedMove)}</div>
                  <div>E[abs] {num(hz?.expectedAbsoluteMove)}</div>
                  <div>Friction {num(hz?.estimatedFriction)}</div>
                  <div>
                    Best NET {num(Math.max(hz?.netEdgeUp ?? -Infinity, hz?.netEdgeDown ?? -Infinity))}
                  </div>
                  <div>Decision {hz?.decision ?? "—"}</div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="gm-card" data-testid="micro-edge-decision">
        <h2>Micro decision</h2>
        <p className="gm-micro-decision-value">
          {latest?.overallMicroDecision ?? "WAIT"}
        </p>
        <ul>
          {(latest?.topFactors ?? ["Awaiting first completed M1 evaluation"]).map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className="gm-muted">
          Agreement: {latest?.forecastAgreementState ?? "—"} · Regime:{" "}
          {latest?.regime ?? "—"}
        </p>
        <p className="gm-micro-disclaimer">
          Shadow signal only — no broker order is submitted.
        </p>
      </section>

      <section className="gm-card" data-testid="micro-edge-performance">
        <h2>Performance (hypothetical)</h2>
        <p className="gm-muted">
          Normalized in XAUUSD price units (USD/oz). Not an executable Pepperstone position.
        </p>
        {perf ? (
          <div className="gm-micro-grid">
            <div>
              <div className="gm-label">Predictions</div>
              <div>{String(perf.predictions ?? 0)}</div>
            </div>
            <div>
              <div className="gm-label">Eligible</div>
              <div>{String(perf.eligible ?? 0)}</div>
            </div>
            <div>
              <div className="gm-label">Direction accuracy</div>
              <div>{pct(perf.directionAccuracy as number | undefined)}</div>
            </div>
            <div>
              <div className="gm-label">NET hypothetical</div>
              <div>{num(perf.netHypotheticalPl as number | undefined)}</div>
            </div>
            <div>
              <div className="gm-label">Est. costs</div>
              <div>{num(perf.estimatedCosts as number | undefined)}</div>
            </div>
            <div>
              <div className="gm-label">Win rate</div>
              <div>{pct(perf.winRate as number | undefined)}</div>
            </div>
            <div>
              <div className="gm-label">Profit factor</div>
              <div>{num(perf.profitFactor as number | undefined, 2)}</div>
            </div>
            <div>
              <div className="gm-label">Expectancy</div>
              <div>{num(perf.expectancy as number | undefined)}</div>
            </div>
            <div>
              <div className="gm-label">Max drawdown</div>
              <div>{num(perf.maxDrawdown as number | undefined)}</div>
            </div>
          </div>
        ) : (
          <p className="gm-muted">No scored outcomes yet.</p>
        )}
      </section>

      <section className="gm-card" data-testid="micro-edge-history">
        <h2>Prediction history</h2>
        <div className="gm-table-wrap">
          <table className="gm-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Mid</th>
                <th>5M decision</th>
                <th>Best NET</th>
                <th>Regime</th>
                <th>Model</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={6}>No Micro predictions yet.</td>
                </tr>
              ) : (
                history.map((row) => {
                  const hz = row.horizons?.["5m"];
                  const best = Math.max(hz?.netEdgeUp ?? 0, hz?.netEdgeDown ?? 0);
                  return (
                    <tr key={row.predictionId}>
                      <td>{row.candleCloseTs}</td>
                      <td>{num(row.mid, 2)}</td>
                      <td>{hz?.decision ?? "—"}</td>
                      <td>{num(best)}</td>
                      <td>{row.regime}</td>
                      <td className="gm-mono">{row.modelVersion}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
