import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../lib/auth";
import { MICRO_EDGE_OAUTH_SESSION_KEY } from "./MicroEdgeConnectCallbackPage";

type HorizonProb = {
  horizonSec: number;
  pUp: number;
  pDown: number;
  pNoEdge: number;
  expectedNetBuy: number;
  expectedNetSell: number;
};

type GhForecast = {
  timestampMs: number;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  quoteAgeMs: number;
  session: string;
  regime: string;
  dataQuality: string;
  modelVersion: string;
  strategyVersion: string;
  horizons: Record<string, HorizonProb>;
  action: "BUY" | "SELL" | "WAIT";
};

type ShadowTrade = {
  tradeId: string;
  date: string;
  strategyVersion: string;
  modelVersion: string;
  entryTimestampMs: number;
  exitTimestampMs: number;
  durationSeconds: number;
  side: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  entrySpread: number;
  netMove: number;
  mfe: number;
  mae: number;
  entryProbs: Record<string, HorizonProb>;
  entryReason: string;
  exitReason: string;
  result: "WIN" | "LOSS" | "BREAKEVEN";
};

type DailySummary = {
  date: string;
  strategyVersion: string;
  modelVersion: string;
  netPnl: number;
  returnPct: number;
  tradeCount: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  buyPnl: number;
  sellPnl: number;
};

type GhStatus = {
  huntState?: string;
  forecast?: GhForecast | null;
  openTrade?: {
    side: string;
    entryPrice: number;
    entryReason: string;
    entryTimestampMs: number;
  } | null;
  openPnl?: number | null;
  strategyVersion?: string;
  modelVersion?: string;
  qualificationStatus?: string;
  researchModel?: boolean;
  accountBalance?: {
    balance: number | null;
    depositCurrency: string | null;
    available: boolean;
  };
  pepperstoneDemoBalance?: {
    balance: number | null;
    depositCurrency: string | null;
  };
  marketData?: {
    symbol?: string;
    liveConnected?: boolean;
    marketFeedStatus?: string;
    quoteAgeMs?: number | null;
  };
  banner?: string;
};

function pct(x: number | undefined | null): string {
  if (x == null || Number.isNaN(x)) return "—";
  return `${(x * 100).toFixed(1)}%`;
}

function num(x: number | undefined | null, d = 2): string {
  if (x == null || Number.isNaN(x)) return "—";
  return x.toFixed(d);
}

function signed(x: number | undefined | null, d = 3): string {
  if (x == null || Number.isNaN(x)) return "—";
  const s = x >= 0 ? "+" : "";
  return `${s}${x.toFixed(d)}`;
}

function fmtTime(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(ms));
}

function dublinToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export function MicroEdgePage() {
  const { api } = useAuth();
  const [gh, setGh] = useState<GhStatus | null>(null);
  const [daily, setDaily] = useState<DailySummary | null>(null);
  const [explanations, setExplanations] = useState<string[]>([]);
  const [equityCurve, setEquityCurve] = useState<Array<{ t: number; equity: number }>>([]);
  const [trades, setTrades] = useState<ShadowTrade[]>([]);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [date, setDate] = useState(dublinToday());
  const [modelInfo, setModelInfo] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [oauthOk, setOauthOk] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [status, dailyRes, tradesRes, modelRes, microStatus] = await Promise.all([
        api.goldHunterStatus() as Promise<GhStatus>,
        api.goldHunterDaily(date) as Promise<{
          summary: DailySummary;
          explanations?: string[];
          availableDates?: string[];
          equityCurve?: Array<{ t: number; equity: number }>;
        }>,
        api.goldHunterTrades(date) as Promise<{ trades: ShadowTrade[] }>,
        api.goldHunterModel() as Promise<Record<string, unknown>>,
        api.microEdgeStatus() as Promise<{
          authorizationStatus?: string;
          oauth?: { configured?: boolean; status?: string };
        }>
      ]);
      setGh(status);
      setDaily(dailyRes.summary);
      setExplanations(dailyRes.explanations ?? []);
      setAvailableDates(dailyRes.availableDates ?? []);
      setEquityCurve(dailyRes.equityCurve ?? []);
      setTrades(tradesRes.trades ?? []);
      setModelInfo(modelRes);
      setOauthOk(
        microStatus.authorizationStatus === "READ_ONLY_AUTHORIZED" ||
          Boolean(microStatus.oauth?.configured && microStatus.oauth?.status === "CONNECTED")
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load GOLD_HUNTER");
    } finally {
      setLoading(false);
    }
  }, [api, date]);

  useEffect(() => {
    void reload();
    const id = window.setInterval(() => void reload(), 5000);
    return () => window.clearInterval(id);
  }, [reload]);

  const forecast = gh?.forecast ?? null;
  const huntState = gh?.huntState ?? "HUNTING";
  const balance = gh?.pepperstoneDemoBalance ?? gh?.accountBalance;
  const researchModel = Boolean(gh?.researchModel);

  const curvePath = useMemo(() => {
    if (!equityCurve.length) return "";
    const w = 320;
    const h = 64;
    const ys = equityCurve.map((p) => p.equity);
    const min = Math.min(0, ...ys);
    const max = Math.max(0, ...ys);
    const span = max - min || 1;
    return equityCurve
      .map((p, i) => {
        const x = (i / Math.max(1, equityCurve.length - 1)) * w;
        const y = h - ((p.equity - min) / span) * (h - 4) - 2;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [equityCurve]);

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
    try {
      await api.microEdgeOAuthDisconnect();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  }

  function shiftDate(delta: number) {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    setDate(d.toISOString().slice(0, 10));
  }

  return (
    <div className="gm-page gm-gold-hunter-page" data-testid="gold-hunter-page">
      <header className="gm-gh-header">
        <div>
          <h1 className="gm-gh-brand" data-testid="gold-hunter-brand">
            GOLD_HUNTER
          </h1>
          <p className="gm-gh-subtitle">Continuous XAUUSD Opportunity Engine</p>
          <p className="gm-gh-powered">Powered by Micro Edge Research</p>
        </div>
        <div className="gm-micro-badges">
          <span className="gm-chip gm-chip-warn" data-testid="gh-shadow-badge">
            SHADOW
          </span>
          <span className="gm-chip" data-testid="gh-no-orders-badge">
            NO BROKER ORDERS
          </span>
          {researchModel ? (
            <span className="gm-chip gm-chip-soft" data-testid="gh-research-model">
              RESEARCH MODEL
            </span>
          ) : null}
        </div>
      </header>

      {loading ? <p className="gm-muted">Loading GOLD_HUNTER…</p> : null}
      {error ? (
        <div className="gm-banner gm-banner-danger" data-testid="gold-hunter-error">
          {error}
        </div>
      ) : null}

      {/* Top daily summary */}
      <section className="gm-gh-summary" data-testid="gh-daily-summary">
        <div className="gm-gh-stat">
          <span className="gm-label">Date</span>
          <strong>{daily?.date ?? date}</strong>
        </div>
        <div className="gm-gh-stat">
          <span className="gm-label">Pepperstone DEMO Balance</span>
          <strong data-testid="gh-broker-balance">
            {balance?.available === false || balance?.balance == null
              ? "—"
              : `${num(balance.balance, 2)} ${balance.depositCurrency ?? ""}`.trim()}
          </strong>
        </div>
        <div className="gm-gh-stat">
          <span className="gm-label">Today&apos;s SHADOW P/L</span>
          <strong data-testid="gh-shadow-pnl">{signed(daily?.netPnl)}</strong>
        </div>
        <div className="gm-gh-stat">
          <span className="gm-label">Today&apos;s %</span>
          <strong>{num(daily?.returnPct, 2)}%</strong>
        </div>
        <div className="gm-gh-stat">
          <span className="gm-label">Open Shadow P/L</span>
          <strong>{signed(gh?.openPnl)}</strong>
        </div>
        <div className="gm-gh-stat">
          <span className="gm-label">Trades</span>
          <strong>{daily?.tradeCount ?? 0}</strong>
        </div>
        <div className="gm-gh-stat">
          <span className="gm-label">Wins / Losses</span>
          <strong>
            {daily?.wins ?? 0} / {daily?.losses ?? 0}
          </strong>
        </div>
        <div className="gm-gh-stat">
          <span className="gm-label">Win Rate</span>
          <strong>{pct(daily?.winRate)}</strong>
        </div>
        <div className="gm-gh-stat">
          <span className="gm-label">Profit Factor</span>
          <strong>{num(daily?.profitFactor, 2)}</strong>
        </div>
        <div className="gm-gh-stat">
          <span className="gm-label">Max Drawdown</span>
          <strong>{num(daily?.maxDrawdown, 3)}</strong>
        </div>
        <div className="gm-gh-stat">
          <span className="gm-label">Strategy</span>
          <strong className="gm-gh-version">{gh?.strategyVersion ?? "—"}</strong>
        </div>
      </section>
      <p className="gm-muted gm-gh-balance-note">
        SHADOW P/L is hypothetical research and does not change Pepperstone DEMO balance.
      </p>

      {/* Live strip */}
      <section className="gm-gh-live" data-testid="gh-live-strip">
        <div className="gm-gh-live-top">
          <span className="gm-gh-state" data-testid="gh-hunt-state">
            {huntState.replace(/_/g, " ")}
          </span>
          <span className="gm-gh-action" data-testid="gh-action">
            {forecast?.action ?? "WAIT"}
          </span>
        </div>
        <div className="gm-gh-quote">
          <span>Bid {num(forecast?.bid, 2)}</span>
          <span>Ask {num(forecast?.ask, 2)}</span>
          <span>Mid {num(forecast?.mid, 2)}</span>
          <span>Spread {num(forecast?.spread, 3)}</span>
          <span>Age {forecast?.quoteAgeMs != null ? `${Math.round(forecast.quoteAgeMs)}ms` : "—"}</span>
        </div>
        <div className="gm-gh-horizons" data-testid="gh-horizons">
          {[5, 15, 30, 60].map((h) => {
            const hz = forecast?.horizons?.[String(h)] ?? forecast?.horizons?.[h as never];
            return (
              <div key={h} className="gm-gh-hz">
                <div className="gm-gh-hz-title">{h}s</div>
                <div>↑ {pct(hz?.pUp)}</div>
                <div>↓ {pct(hz?.pDown)}</div>
                <div className="gm-muted">∅ {pct(hz?.pNoEdge)}</div>
                <div className="gm-gh-edge">
                  Edge {signed(Math.max(hz?.expectedNetBuy ?? 0, hz?.expectedNetSell ?? 0))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="gm-gh-meta-row">
          <span>Session {forecast?.session ?? "—"}</span>
          <span>Regime {forecast?.regime ?? "—"}</span>
          <span>Quality {forecast?.dataQuality ?? "—"}</span>
          <span>Model {gh?.modelVersion ?? "—"}</span>
        </div>
      </section>

      {/* Active shadow trade */}
      {gh?.openTrade ? (
        <section className="gm-gh-open" data-testid="gh-open-trade">
          <h2>Active Shadow Trade</h2>
          <div className="gm-gh-open-grid">
            <div>
              <span className="gm-label">Side</span>
              <strong>{gh.openTrade.side}</strong>
            </div>
            <div>
              <span className="gm-label">Entry</span>
              <strong>{num(gh.openTrade.entryPrice, 2)}</strong>
            </div>
            <div>
              <span className="gm-label">Current mid</span>
              <strong>{num(forecast?.mid, 2)}</strong>
            </div>
            <div>
              <span className="gm-label">P/L</span>
              <strong>{signed(gh.openPnl)}</strong>
            </div>
            <div>
              <span className="gm-label">Duration</span>
              <strong>
                {Math.max(
                  0,
                  Math.round((Date.now() - gh.openTrade.entryTimestampMs) / 1000)
                )}
                s
              </strong>
            </div>
            <div>
              <span className="gm-label">Entry reason</span>
              <strong>{gh.openTrade.entryReason}</strong>
            </div>
          </div>
        </section>
      ) : null}

      {/* Date nav */}
      <section className="gm-gh-date-nav" data-testid="gh-date-nav">
        <button type="button" className="gm-btn" onClick={() => shiftDate(-1)}>
          Previous
        </button>
        <button type="button" className="gm-btn" onClick={() => setDate(dublinToday())}>
          Today
        </button>
        <button
          type="button"
          className="gm-btn"
          onClick={() => shiftDate(1)}
          disabled={!availableDates.includes(
            new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10)
          )}
        >
          Next
        </button>
        <span className="gm-muted">{date} · Europe/Dublin</span>
      </section>

      {/* Equity curve */}
      <section className="gm-gh-equity" data-testid="gh-equity-curve">
        <h2>SHADOW Equity (day)</h2>
        {curvePath ? (
          <svg viewBox="0 0 320 64" className="gm-gh-equity-svg" role="img" aria-label="Shadow equity">
            <path d={curvePath} fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        ) : (
          <p className="gm-muted">No completed shadow trades for this day.</p>
        )}
      </section>

      {/* Desktop trade table */}
      <section className="gm-gh-trades-desktop" data-testid="gh-trades-desktop">
        <h2>Daily Trade History</h2>
        <table className="gm-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Side</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>Duration</th>
              <th>Result</th>
              <th>P/L</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.tradeId}>
                <td>{fmtTime(t.entryTimestampMs)}</td>
                <td>{t.side}</td>
                <td>{num(t.entryPrice, 2)}</td>
                <td>{num(t.exitPrice, 2)}</td>
                <td>{t.durationSeconds}s</td>
                <td>{t.result}</td>
                <td>{signed(t.netMove)}</td>
                <td>{t.exitReason}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!trades.length ? <p className="gm-muted">No shadow trades.</p> : null}
      </section>

      {/* Mobile trade rows — no horizontal scroll */}
      <section className="gm-gh-trades-mobile" data-testid="gh-trades-mobile">
        <h2>Daily Trade History</h2>
        <div className="gm-gh-mobile-list">
          {trades.map((t) => {
            const open = expanded === t.tradeId;
            return (
              <button
                type="button"
                key={t.tradeId}
                className="gm-gh-mobile-row"
                data-testid="gh-mobile-trade-row"
                onClick={() => setExpanded(open ? null : t.tradeId)}
              >
                <div className="gm-gh-mobile-main">
                  <div>
                    {t.side} · {fmtTime(t.entryTimestampMs)} · {t.durationSeconds}s
                  </div>
                  <div className={t.netMove >= 0 ? "gm-gh-pos" : "gm-gh-neg"}>
                    {signed(t.netMove)}
                  </div>
                </div>
                <div className="gm-gh-mobile-sub">
                  <span>
                    {num(t.entryPrice, 2)} → {num(t.exitPrice, 2)}
                  </span>
                  <span>{t.result}</span>
                </div>
                <div className="gm-gh-mobile-reason">{t.entryReason}</div>
                {open ? (
                  <div className="gm-gh-mobile-expand" data-testid="gh-mobile-expand">
                    <div>
                      In {fmtTime(t.entryTimestampMs)} · Out {fmtTime(t.exitTimestampMs)}
                    </div>
                    <div>
                      5s {pct(t.entryProbs?.["5"]?.pUp)} / {pct(t.entryProbs?.["5"]?.pDown)}
                    </div>
                    <div>
                      15s {pct(t.entryProbs?.["15"]?.pUp)} / {pct(t.entryProbs?.["15"]?.pDown)}
                    </div>
                    <div>
                      30s {pct(t.entryProbs?.["30"]?.pUp)} / {pct(t.entryProbs?.["30"]?.pDown)}
                    </div>
                    <div>
                      60s {pct(t.entryProbs?.["60"]?.pUp)} / {pct(t.entryProbs?.["60"]?.pDown)}
                    </div>
                    <div>
                      Spread {num(t.entrySpread, 3)} · MFE {signed(t.mfe)} · MAE {signed(t.mae)}
                    </div>
                    <div>
                      Exit {t.exitReason} · {t.modelVersion}
                    </div>
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      {/* Explanations */}
      {explanations.length ? (
        <section className="gm-gh-explain" data-testid="gh-explanations">
          <h2>Day notes</h2>
          <ul>
            {explanations.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Model / data status */}
      <section className="gm-gh-model" data-testid="gh-model-status">
        <h2>Model / Data Status</h2>
        <div className="gm-micro-grid">
          <div>
            <div className="gm-label">Qualification</div>
            <div>{String(modelInfo?.qualificationStatus ?? gh?.qualificationStatus ?? "NOT_TRAINED")}</div>
          </div>
          <div>
            <div className="gm-label">Model version</div>
            <div>{gh?.modelVersion ?? "—"}</div>
          </div>
          <div>
            <div className="gm-label">Live claim</div>
            <div>NOT QUALIFIED FOR LIVE</div>
          </div>
        </div>
      </section>

      {/* OAuth connection (compact) */}
      <section className="gm-card gm-micro-connection" data-testid="micro-edge-connection">
        <h2>Read-only connection</h2>
        <p className="gm-muted" style={{ marginTop: 0 }}>
          OAuth scope=accounts · VIEW only · SHADOW engine never places orders.
        </p>
        <div className="gm-micro-actions" style={{ display: "flex", gap: 10 }}>
          {!oauthOk ? (
            !confirmOpen ? (
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
              <>
                <button
                  type="button"
                  className="gm-btn gm-btn-primary"
                  disabled={busy}
                  onClick={() => void onConfirmConnect()}
                >
                  Confirm read-only connect
                </button>
                <button type="button" className="gm-btn" onClick={() => setConfirmOpen(false)}>
                  Cancel
                </button>
              </>
            )
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
      </section>
    </div>
  );
}
