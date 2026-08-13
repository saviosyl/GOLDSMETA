import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { MICRO_EDGE_OAUTH_SESSION_KEY } from "./MicroEdgeConnectCallbackPage";

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
  boundaryQuoteCount?: number;
  labelReadyMinutes?: number;
  backfillStatus?: Record<string, { status?: string } | null>;
  dataCollectionActive?: boolean;
};

type OAuthStatus = {
  status?: string;
  configured?: boolean;
  environment?: string | null;
  selectedAccountIdMasked?: string | null;
  authorizedAccountCount?: number;
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
  oauth?: OAuthStatus;
  oauthAppConfigured?: boolean;
  realConnectionStatus?: string;
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, l, h] = await Promise.all([
        api.microEdgeStatus() as Promise<Status>,
        api.microEdgeLatest() as Promise<{ prediction: MicroPrediction | null }>,
        api.microEdgeHistory(30)
      ]);
      setStatus(s);
      setLatest(l.prediction);
      setHistory((h.items ?? []) as unknown as MicroPrediction[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Micro Edge");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const md = status?.marketData;
  const oauth = status?.oauth;
  const tokenPresent =
    Boolean(oauth?.configured) &&
    oauth?.status !== "DISCONNECTED" &&
    oauth?.status !== "AWAITING_USER_AUTHORIZATION";
  const liveConnected = Boolean(status?.marketFeedConnected || md?.liveConnected);
  const connectionState =
    status?.connectionState ?? md?.connectionState ?? "LIVE_NOT_CONNECTED";
  const isMock = connectionState === "MOCK_SEEDED";
  const readOnlyConnected = tokenPresent || liveConnected;

  async function onConfirmConnect() {
    setBusy(true);
    setError(null);
    try {
      const started = await api.microEdgeOAuthStart();
      sessionStorage.setItem(MICRO_EDGE_OAUTH_SESSION_KEY, started.sessionId);
      window.location.assign(started.authorizationUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start Micro OAuth");
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  async function onDisconnect() {
    setBusy(true);
    setError(null);
    try {
      await api.microEdgeOAuthDisconnect();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  }

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
          {liveConnected ? (
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

      <section className="gm-card gm-micro-connection" data-testid="micro-edge-connection">
        <h2>Connection</h2>
        <p className="gm-muted" style={{ marginTop: 0 }}>
          READ-ONLY CONNECTION — Micro Edge cannot place trades. Market/account-data access
          only.
        </p>
        <div
          className={`gm-banner ${readOnlyConnected ? "gm-banner-info" : "gm-banner-danger"}`}
          data-testid="micro-connection-state"
        >
          {readOnlyConnected ? "Read-only connected" : "Not connected"}
          {oauth?.status ? ` · ${oauth.status}` : ""}
        </div>
        <div className="gm-micro-grid">
          <div>
            <div className="gm-label">Broker</div>
            <div>Pepperstone</div>
          </div>
          <div>
            <div className="gm-label">Environment</div>
            <div>{oauth?.environment ?? "DEMO"}</div>
          </div>
          <div>
            <div className="gm-label">Account</div>
            <div>{oauth?.selectedAccountIdMasked ?? "—"}</div>
          </div>
          <div>
            <div className="gm-label">Symbol</div>
            <div>{md?.symbol ?? "XAUUSD"}</div>
          </div>
          <div>
            <div className="gm-label">Quote freshness</div>
            <div>
              {liveConnected && md?.quoteAgeMs != null
                ? `${Math.round(md.quoteAgeMs)}ms`
                : "—"}
            </div>
          </div>
          <div>
            <div className="gm-label">Last M1</div>
            <div>{md?.lastCompletedM1Ts ?? "—"}</div>
          </div>
        </div>

        {!confirmOpen ? (
          <div className="gm-micro-actions" style={{ marginTop: 14, display: "flex", gap: 10 }}>
            {!tokenPresent ? (
              <button
                type="button"
                className="gm-btn gm-btn-primary"
                data-testid="micro-connect-readonly"
                disabled={busy}
                onClick={() => setConfirmOpen(true)}
              >
                Connect Micro Edge — Read Only
              </button>
            ) : (
              <button
                type="button"
                className="gm-btn"
                data-testid="micro-disconnect"
                disabled={busy}
                onClick={() => void onDisconnect()}
              >
                Disconnect Micro Edge
              </button>
            )}
          </div>
        ) : (
          <div
            className="gm-banner gm-banner-info"
            data-testid="micro-oauth-confirm"
            style={{ marginTop: 14 }}
          >
            <strong>Permission requested:</strong> VIEW-ONLY ACCOUNT ACCESS
            <br />
            <strong>Trading permission:</strong> NOT REQUESTED
            <br />
            <strong>Broker orders:</strong> IMPOSSIBLE FROM MICRO EDGE
            <p className="gm-muted" style={{ marginBottom: 10 }}>
              Technical guarantee: scope=accounts + Micro mutation-ban architecture.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="gm-btn gm-btn-primary"
                disabled={busy}
                data-testid="micro-oauth-continue"
                onClick={() => void onConfirmConnect()}
              >
                Continue
              </button>
              <button
                type="button"
                className="gm-btn"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        <p className="gm-muted" style={{ marginTop: 12 }}>
          Market-data access only. Micro Edge cannot place broker orders.
        </p>
      </section>

      <section className="gm-card gm-micro-status" data-testid="micro-edge-status">
        <h2>Status</h2>
        <div
          className={`gm-banner ${liveConnected ? "gm-banner-info" : "gm-banner-danger"}`}
          data-testid="micro-market-feed-status"
        >
          {status?.marketFeedStatus ?? md?.marketFeedStatus ?? "Market feed not connected"}
          {connectionState ? ` · ${connectionState}` : ""}
        </div>
        <div className="gm-micro-grid">
          <div>
            <div className="gm-label">Collector health</div>
            <div data-testid="micro-collector-health">
              {md?.collectorHealthy || status?.collector?.healthy ? "Healthy" : "Unhealthy"}
            </div>
          </div>
          <div>
            <div className="gm-label">Observations</div>
            <div>
              M1 {md?.historicalObservationCounts?.M1 ?? 0} · quotes{" "}
              {md?.quoteSamplesStored ?? 0}
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
            <div className="gm-label">Boundary quotes</div>
            <div>{md?.boundaryQuoteCount ?? 0}</div>
          </div>
          <div>
            <div className="gm-label">Label-ready minutes</div>
            <div>{md?.labelReadyMinutes ?? 0}</div>
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
          {!liveConnected ? "WAIT / DATA UNAVAILABLE" : "DATA COLLECTION"}
        </p>
        <p className="gm-muted">
          Model status:{" "}
          {status?.modelStatus ?? "DATA COLLECTION / NOT TRAINED ON REAL DATA"}
        </p>
        <p className="gm-micro-disclaimer">
          Shadow signal only — no broker order is submitted.
        </p>
      </section>

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
