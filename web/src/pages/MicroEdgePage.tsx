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

type MarketDataStatus = {
  connectionState?: string;
  liveConnected?: boolean;
  marketFeedStatus?: string;
  symbol?: string;
  symbolId?: string | null;
  lastQuoteTs?: string | null;
  quoteAgeMs?: number | null;
  lastCompletedM1Ts?: string | null;
  lastCompletedM5Ts?: string | null;
  lastCompletedM15Ts?: string | null;
  collectorHealthy?: boolean;
  healthReasons?: string[];
  historicalObservationCounts?: { M1?: number; M5?: number; M15?: number };
  quoteSamplesStored?: number;
  backfillStatus?: Record<string, { status?: string } | null>;
  dataCollectionActive?: boolean;
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
  marketFeedConnected?: boolean;
  marketFeedStatus?: string;
  connectionState?: string;
  interfaceReady?: boolean;
  overallMicroDecision?: string;
  dataUnavailable?: boolean;
  degradedReason?: string | null;
  dataCollectionActive?: boolean;
  modelStatus?: string;
  marketData?: MarketDataStatus;
  collector?: {
    healthy?: boolean;
    reasons?: string[];
  };
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [s, l, h] = await Promise.all([
          api.microEdgeStatus() as Promise<Status>,
          api.microEdgeLatest() as Promise<{ prediction: MicroPrediction | null }>,
          api.microEdgeHistory(30)
        ]);
        if (cancelled) return;
        setStatus(s);
        setLatest(l.prediction);
        setHistory((h.items ?? []) as unknown as MicroPrediction[]);
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

  const md = status?.marketData;
  const connected = Boolean(status?.marketFeedConnected || md?.liveConnected);
  const connectionState = status?.connectionState ?? md?.connectionState ?? "LIVE_NOT_CONNECTED";
  const isMock = connectionState === "MOCK_SEEDED";

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
          {connected ? (
            <span className="gm-chip" data-testid="micro-collection-badge">
              DATA COLLECTION ACTIVE
            </span>
          ) : null}
          {isMock ? (
            <span className="gm-chip gm-chip-warn" data-testid="micro-test-data-badge">
              TEST DATA
            </span>
          ) : null}
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
        <div
          className={`gm-banner ${connected ? "gm-banner-info" : "gm-banner-danger"}`}
          data-testid="micro-market-feed-status"
        >
          {status?.marketFeedStatus ?? md?.marketFeedStatus ?? "Market feed not connected"}
          {connectionState ? ` · ${connectionState}` : ""}
        </div>
        <div className="gm-micro-grid">
          <div>
            <div className="gm-label">Symbol</div>
            <div>{md?.symbol ?? "XAUUSD"}</div>
          </div>
          <div>
            <div className="gm-label">cTrader connection</div>
            <div>{connected ? "Connected (read-only)" : "Not connected"}</div>
          </div>
          <div>
            <div className="gm-label">Quote freshness</div>
            <div>
              {connected && md?.quoteAgeMs != null
                ? `${Math.round(md.quoteAgeMs)}ms`
                : "DATA UNAVAILABLE"}
            </div>
          </div>
          <div>
            <div className="gm-label">Last completed M1</div>
            <div>{md?.lastCompletedM1Ts ?? "—"}</div>
          </div>
          <div>
            <div className="gm-label">Collector health</div>
            <div data-testid="micro-collector-health">
              {md?.collectorHealthy || status?.collector?.healthy ? "Healthy" : "Unhealthy"}
            </div>
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

      <section className="gm-card" data-testid="micro-edge-data-collection">
        <h2>Data collection</h2>
        <div className="gm-micro-grid">
          <div>
            <div className="gm-label">M1 observations</div>
            <div>{md?.historicalObservationCounts?.M1 ?? 0}</div>
          </div>
          <div>
            <div className="gm-label">M5 observations</div>
            <div>{md?.historicalObservationCounts?.M5 ?? 0}</div>
          </div>
          <div>
            <div className="gm-label">M15 observations</div>
            <div>{md?.historicalObservationCounts?.M15 ?? 0}</div>
          </div>
          <div>
            <div className="gm-label">Quote samples</div>
            <div>{md?.quoteSamplesStored ?? 0}</div>
          </div>
          <div>
            <div className="gm-label">Backfill M1</div>
            <div>{md?.backfillStatus?.M1?.status ?? "IDLE"}</div>
          </div>
          <div>
            <div className="gm-label">Backfill M5 / M15</div>
            <div>
              {md?.backfillStatus?.M5?.status ?? "IDLE"} /{" "}
              {md?.backfillStatus?.M15?.status ?? "IDLE"}
            </div>
          </div>
        </div>
        {(md?.healthReasons?.length || status?.collector?.reasons?.length) ? (
          <p className="gm-muted" style={{ marginTop: 10 }}>
            Reasons: {(md?.healthReasons ?? status?.collector?.reasons ?? []).join(", ")}
          </p>
        ) : null}
      </section>

      <section className="gm-card" data-testid="micro-edge-decision">
        <h2>Micro decision</h2>
        <p className="gm-micro-decision-value" data-testid="micro-overall-decision">
          {status?.dataUnavailable || !connected
            ? "WAIT / DATA UNAVAILABLE"
            : "DATA COLLECTION"}
        </p>
        <p className="gm-muted">
          Model status: {status?.modelStatus ?? "RESEARCH / NOT TRAINED ON LIVE DATA"}
        </p>
        <p className="gm-micro-disclaimer">
          Shadow signal only — no broker order is submitted.
        </p>
      </section>

      {/* Placeholder forecasts hidden until a live-trained model exists.
          If a residual prediction document is present, badge it clearly. */}
      {latest ? (
        <section className="gm-card" data-testid="micro-edge-placeholder-model">
          <h2>
            Research placeholder{" "}
            <span className="gm-chip gm-chip-warn">UNTRAINED PLACEHOLDER</span>{" "}
            <span className="gm-chip gm-chip-warn">NOT FOR TRADING</span>
          </h2>
          <p className="gm-muted">
            Probabilities below are not trained on live Micro observations and must not be
            treated as trading signals.
          </p>
          <div className="gm-micro-horizon-row">
            {(["1m", "5m", "15m"] as HorizonKey[]).map((h) => {
              const hz = latest.horizons?.[h];
              return (
                <article key={h} className="gm-card gm-micro-horizon-card">
                  <header>
                    <strong>{h.toUpperCase()}</strong>
                  </header>
                  <div className="gm-micro-probs">
                    <div>UP {pct(hz?.pUp)}</div>
                    <div>DOWN {pct(hz?.pDown)}</div>
                    <div>NO EDGE {pct(hz?.pNoEdge)}</div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="gm-card" data-testid="micro-edge-history">
        <h2>Prediction history</h2>
        <p className="gm-muted">
          Empty until a trained research model is activated. Data collection does not create
          tradeable forecasts.
        </p>
        <div className="gm-table-wrap">
          <table className="gm-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Mid</th>
                <th>5M decision</th>
                <th>Model</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={4}>No Micro predictions yet.</td>
                </tr>
              ) : (
                history.map((row) => (
                  <tr key={row.predictionId}>
                    <td>{row.candleCloseTs}</td>
                    <td>{num(row.mid, 2)}</td>
                    <td>{row.horizons?.["5m"]?.decision ?? "—"}</td>
                    <td className="gm-mono">{row.modelVersion}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
