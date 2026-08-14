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

type GhFastLive = {
  state?: string;
  bid?: number | null;
  ask?: number | null;
  spread?: number | null;
  eventRate1s?: number | null;
  bidDepth?: number | null;
  askDepth?: number | null;
  depthImbalance?: number | null;
  velocity?: number | null;
  acceleration?: number | null;
  setup?: string | null;
  setupQuality?: number | null;
  action?: string | null;
  decisionLatencyMs?: number | null;
  open?: {
    side?: string;
    entry?: number;
    executableExit?: number;
    openPnl?: number;
    mfe?: number;
    mae?: number;
    durationMs?: number;
    profitLock?: boolean;
    trail?: number | null;
    exitPressure?: string | null;
  } | null;
  realMarketData?: boolean;
  pepperstoneDemo?: boolean;
  soakLabel?: string | null;
  engineVersion?: string | null;
  configSha256?: string | null;
  tuningAllowed?: boolean;
  completedShadowTrades?: number;
  todayNetMove?: number;
  wins?: number;
  losses?: number;
  profitFactor?: number | null;
  rejectionsTop?: Record<string, number>;
  setupDetections?: Record<string, number>;
  brokerOrders?: number;
  shadowOnly?: boolean;
};

type FastSoakHealth = {
  serviceHealthy?: boolean;
  liveConnected?: boolean;
  spotSubscribed?: boolean;
  depthSubscribed?: boolean;
  engineVersion?: string;
  configSha256?: string;
  soakLabel?: string;
  tuningAllowed?: boolean;
  mutationSurface?: string;
  permissionScope?: string;
  brokerOrders?: number;
  brokerRequests?: number;
  completedShadowTrades?: number;
  openShadowTrade?: GhFastLive["open"];
  ui?: GhFastLive | null;
  recentTrades?: Array<{
    tradeId: string;
    side: string;
    setup: string;
    entryTs: number;
    exitTs: number;
    entryPrice: number;
    exitPrice: number;
    durationMs: number;
    netMove: number;
    mfe: number;
    mae: number;
    result: string;
    exitReason: string;
  }>;
  todaySummary?: {
    netMove: number;
    trades: number;
    wins: number;
    losses: number;
    winRate: number | null;
    profitFactor: number | null;
    expectancy: number | null;
    maxDrawdown: number;
  };
  activity?: {
    eventsPerSec?: number | null;
    decisionsPerSec?: number | null;
    signalsPerHour?: number | null;
    entriesPerHour?: number | null;
    tradesPerHour?: number | null;
    medianEntryIntervalSec?: number | null;
  } | null;
  setupDetections?: Record<string, number>;
  fast?: {
    spotAgeMs?: number | null;
    depthAgeMs?: number | null;
    depthBookAvailable?: boolean;
    queueDepth?: number;
    eventsDropped?: number;
    eventToDecision?: { p50: number | null; p95: number | null; p99: number | null };
    durableMode?: string;
    persistenceHealthWarning?: string | null;
    eventsReceived?: number;
    decisions?: number;
    shadowEntries?: number;
    shadowExits?: number;
    fastAttached?: boolean;
  } | null;
  replayParity?: { code?: string; ok?: boolean } | null;
  disclaimer?: string;
};

function mapSoakTrades(
  rows: NonNullable<FastSoakHealth["recentTrades"]>
): ShadowTrade[] {
  return [...rows].reverse().map((t) => ({
    tradeId: t.tradeId,
    date: dublinToday(),
    strategyVersion: "GOLD_HUNTER_FAST_V1",
    modelVersion: "GH_FAST_EVENT_V1",
    entryTimestampMs: t.entryTs,
    exitTimestampMs: t.exitTs,
    durationSeconds: Math.max(0, Math.round(t.durationMs / 1000)),
    side: t.side === "SELL" ? "SELL" : "BUY",
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    entrySpread: 0,
    netMove: t.netMove,
    mfe: t.mfe,
    mae: t.mae,
    entryProbs: {},
    entryReason: t.setup,
    exitReason: t.exitReason,
    result:
      t.result === "WIN" || t.result === "LOSS" || t.result === "BREAKEVEN"
        ? t.result
        : "BREAKEVEN"
  }));
}

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
    available?: boolean;
  };
  pepperstoneDemoBalance?: {
    balance: number | null;
    depositCurrency: string | null;
    available?: boolean;
  };
  marketData?: {
    symbol?: string;
    liveConnected?: boolean;
    marketFeedStatus?: string;
    quoteAgeMs?: number | null;
  };
  /** GOLD_HUNTER FAST event-driven live strip (shadow-only). */
  fast?: GhFastLive | null;
  banner?: string;
};

function formatGhState(state: string): string {
  const map: Record<string, string> = {
    HUNTING: "HUNTING",
    PRESSURE_DETECTED: "PRESSURE",
    PRESSURE_UP: "PRESSURE UP",
    PRESSURE_DOWN: "PRESSURE DOWN",
    ARMED: "ARMED",
    STRIKE_BUY: "STRIKE BUY",
    STRIKE_SELL: "STRIKE SELL",
    RUNNER: "RUNNER",
    HARVEST: "HARVEST",
    ABORT: "ABORT",
    REHUNT: "REHUNT",
    DATA_STALE: "DATA STALE",
    SPREAD_BLOCKED: "SPREAD BLOCKED",
    TARGET_FOUND: "TARGET FOUND",
    SHADOW_BUY: "SHADOW BUY",
    SHADOW_SELL: "SHADOW SELL",
    COOLDOWN: "COOLDOWN",
    MARKET_CLOSED: "MARKET CLOSED"
  };
  return map[state] ?? state.replace(/_/g, " ");
}

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
  const fastHealthUrl = (
    import.meta.env.VITE_GOLD_HUNTER_FAST_HEALTH_URL as string | undefined
  )?.trim();
  const isFastPreview =
    (import.meta.env.VITE_GOLD_HUNTER_FAST_PREVIEW as string | undefined) ===
    "true";
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
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [soak, setSoak] = useState<FastSoakHealth | null>(null);

  useEffect(() => {
    if (!isFastPreview) return;
    let meta = document.querySelector('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "robots");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", "noindex, nofollow");
    document.title = "GOLD_HUNTER FAST — Live-Shadow Preview (noindex)";
  }, [isFastPreview]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const soakPromise = fastHealthUrl
        ? fetch(fastHealthUrl, { cache: "no-store" })
            .then(async (r) => (await r.json()) as FastSoakHealth)
            .catch(() => null)
        : Promise.resolve(null);

      const soft = async <T,>(p: Promise<T>): Promise<T | null> => {
        try {
          return await p;
        } catch {
          return null;
        }
      };

      const [status, dailyRes, tradesRes, modelRes, microStatus, soakHealth] =
        await Promise.all([
          soft(api.goldHunterStatus() as Promise<GhStatus>),
          soft(
            api.goldHunterDaily(date) as Promise<{
              summary: DailySummary;
              explanations?: string[];
              availableDates?: string[];
              equityCurve?: Array<{ t: number; equity: number }>;
            }>
          ),
          soft(api.goldHunterTrades(date) as Promise<{ trades: ShadowTrade[] }>),
          soft(api.goldHunterModel() as Promise<Record<string, unknown>>),
          soft(
            api.microEdgeStatus() as Promise<{
              authorizationStatus?: string;
              oauth?: { configured?: boolean; status?: string };
            }>
          ),
          soakPromise
        ]);

      if (!soakHealth && !status) {
        throw new Error("Failed to load GOLD_HUNTER status");
      }

      if (soakHealth) {
        setSoak(soakHealth);
        const ui = soakHealth.ui ?? null;
        const summary = soakHealth.todaySummary;
        setGh({
          ...(status ?? {}),
          huntState: ui?.state ?? status?.huntState,
          researchModel: status?.researchModel ?? true,
          fast: {
            ...(status?.fast ?? {}),
            ...(ui ?? {}),
            soakLabel: soakHealth.soakLabel ?? ui?.soakLabel ?? null,
            engineVersion: soakHealth.engineVersion ?? ui?.engineVersion ?? null,
            configSha256: soakHealth.configSha256 ?? ui?.configSha256 ?? null,
            tuningAllowed: false,
            completedShadowTrades: soakHealth.completedShadowTrades,
            todayNetMove: summary?.netMove,
            wins: summary?.wins,
            losses: summary?.losses,
            profitFactor: summary?.profitFactor ?? null,
            setupDetections: soakHealth.setupDetections,
            brokerOrders: 0,
            shadowOnly: true,
            realMarketData: true,
            pepperstoneDemo: true,
            open: soakHealth.openShadowTrade ?? ui?.open ?? null
          },
          openPnl: soakHealth.openShadowTrade?.openPnl ?? status?.openPnl,
          banner: "SHADOW ONLY — NO BROKER ORDERS — LIVE-SHADOW PREVIEW"
        });
        if (summary) {
          setDaily({
            date: dublinToday(),
            strategyVersion: "GOLD_HUNTER_FAST_V1",
            modelVersion: soakHealth.engineVersion ?? "GH_FAST_EVENT_V1",
            netPnl: summary.netMove,
            returnPct: 0,
            tradeCount: summary.trades,
            wins: summary.wins,
            losses: summary.losses,
            winRate: summary.winRate ?? 0,
            profitFactor: summary.profitFactor ?? 0,
            maxDrawdown: summary.maxDrawdown,
            buyPnl: 0,
            sellPnl: 0
          });
        } else if (dailyRes?.summary) {
          setDaily(dailyRes.summary);
        }
        const mapped = mapSoakTrades(soakHealth.recentTrades ?? []);
        setTrades(mapped.length ? mapped : tradesRes?.trades ?? []);
        setEquityCurve(
          mapped
            .slice()
            .reverse()
            .reduce<Array<{ t: number; equity: number }>>((acc, t) => {
              const prev = acc.length ? acc[acc.length - 1]!.equity : 0;
              acc.push({ t: t.exitTimestampMs, equity: prev + t.netMove });
              return acc;
            }, [])
        );
      } else if (status) {
        setSoak(null);
        setGh(status);
        setDaily(dailyRes?.summary ?? null);
        setTrades(tradesRes?.trades ?? []);
        setEquityCurve(dailyRes?.equityCurve ?? []);
      }

      setExplanations(dailyRes?.explanations ?? []);
      setAvailableDates(dailyRes?.availableDates ?? []);
      setModelInfo(modelRes);
      setOauthOk(
        microStatus?.authorizationStatus === "READ_ONLY_AUTHORIZED" ||
          Boolean(
            microStatus?.oauth?.configured &&
              microStatus?.oauth?.status === "CONNECTED"
          )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load GOLD_HUNTER");
    } finally {
      setLoading(false);
    }
  }, [api, date, fastHealthUrl]);

  useEffect(() => {
    void reload();
    const id = window.setInterval(() => void reload(), fastHealthUrl ? 2000 : 5000);
    return () => window.clearInterval(id);
  }, [reload, fastHealthUrl]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const forecast = gh?.forecast ?? null;
  const fast = gh?.fast ?? null;
  const huntState = fast?.state ?? gh?.huntState ?? "HUNTING";
  const balance = gh?.pepperstoneDemoBalance ?? gh?.accountBalance;
  const researchModel = Boolean(gh?.researchModel);
  const expectancy = soak?.todaySummary?.expectancy ?? null;

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
          <p className="gm-gh-subtitle">FAST Event-Driven XAUUSD Scalper</p>
          <p className="gm-gh-powered">Powered by Micro Edge Research · Shadow Only</p>
        </div>
        <div className="gm-micro-badges">
          <span className="gm-chip gm-chip-warn" data-testid="gh-shadow-badge">
            SHADOW ONLY
          </span>
          <span className="gm-chip" data-testid="gh-no-orders-badge">
            NO BROKER ORDERS
          </span>
          <span className="gm-chip gm-chip-soft" data-testid="gh-real-market-badge">
            REAL MARKET DATA
          </span>
          <span className="gm-chip gm-chip-soft" data-testid="gh-pepperstone-demo-badge">
            PEPPERSTONE DEMO
          </span>
          <span className="gm-chip gm-chip-soft" data-testid="gh-fast-badge">
            GOLD_HUNTER FAST
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

      <section className="gm-gh-soak-banner" data-testid="gh-live-shadow-soak">
        <div className="gm-gh-soak-title">LIVE-SHADOW OBSERVATION</div>
        <div className="gm-gh-soak-grid">
          <span>Mode SHADOW ONLY</span>
          <span>Broker orders {fast?.brokerOrders ?? soak?.brokerOrders ?? 0}</span>
          <span>Engine {fast?.engineVersion ?? soak?.engineVersion ?? "—"}</span>
          <span>
            Config{" "}
            {(fast?.configSha256 ?? soak?.configSha256)
              ? `${(fast?.configSha256 ?? soak?.configSha256)!.slice(0, 12)}…`
              : "—"}
          </span>
          <span>Soak {fast?.soakLabel ?? soak?.soakLabel ?? "standby"}</span>
          <span>Tuning FROZEN</span>
          <span>
            Shadow trades {fast?.completedShadowTrades ?? soak?.completedShadowTrades ?? 0}
          </span>
          <span>Net move {signed(fast?.todayNetMove ?? soak?.todaySummary?.netMove)}</span>
          <span>
            W/L {(fast?.wins ?? soak?.todaySummary?.wins ?? 0)}/
            {(fast?.losses ?? soak?.todaySummary?.losses ?? 0)}
          </span>
          <span>PF {num(fast?.profitFactor ?? soak?.todaySummary?.profitFactor, 2)}</span>
          <span>Expectancy {signed(expectancy)}</span>
          <span>
            Setup A {fast?.setupDetections?.A_MOMENTUM_IGNITION ?? soak?.setupDetections?.A_MOMENTUM_IGNITION ?? 0}
          </span>
          <span>
            Setup B {fast?.setupDetections?.B_FAST_BREAKOUT ?? soak?.setupDetections?.B_FAST_BREAKOUT ?? 0}
          </span>
          <span>
            Setup C {fast?.setupDetections?.C_PULLBACK_REACCEL ?? soak?.setupDetections?.C_PULLBACK_REACCEL ?? 0}
          </span>
        </div>
        <p className="gm-muted gm-gh-balance-note">
          TODAY SHADOW RESULT ≠ broker account P/L. FAST places zero Demo/Live orders.
        </p>
      </section>

      {soak ? (
        <section className="gm-gh-summary" data-testid="gh-fast-health-activity">
          <div className="gm-gh-stat">
            <span className="gm-label">Spot</span>
            <strong>{soak.spotSubscribed ? "SUBSCRIBED" : "NO"}</strong>
          </div>
          <div className="gm-gh-stat">
            <span className="gm-label">Depth</span>
            <strong>{soak.depthSubscribed ? "SUBSCRIBED" : "NO"}</strong>
          </div>
          <div className="gm-gh-stat">
            <span className="gm-label">Spot age</span>
            <strong>
              {soak.fast?.spotAgeMs != null ? `${Math.round(soak.fast.spotAgeMs)}ms` : "—"}
            </strong>
          </div>
          <div className="gm-gh-stat">
            <span className="gm-label">Depth age</span>
            <strong>
              {soak.fast?.depthAgeMs != null ? `${Math.round(soak.fast.depthAgeMs)}ms` : "—"}
            </strong>
          </div>
          <div className="gm-gh-stat">
            <span className="gm-label">Depth book</span>
            <strong>{soak.fast?.depthBookAvailable ? "OK" : "NO"}</strong>
          </div>
          <div className="gm-gh-stat">
            <span className="gm-label">Queue / dropped</span>
            <strong>
              {soak.fast?.queueDepth ?? 0} / {soak.fast?.eventsDropped ?? 0}
            </strong>
          </div>
          <div className="gm-gh-stat">
            <span className="gm-label">Decision p50/p95/p99</span>
            <strong>
              {num(soak.fast?.eventToDecision?.p50, 1)}/
              {num(soak.fast?.eventToDecision?.p95, 1)}/
              {num(soak.fast?.eventToDecision?.p99, 1)}
            </strong>
          </div>
          <div className="gm-gh-stat">
            <span className="gm-label">GCS</span>
            <strong>{soak.fast?.durableMode ?? "—"}</strong>
          </div>
          <div className="gm-gh-stat">
            <span className="gm-label">Replay</span>
            <strong>{soak.replayParity?.code ?? "—"}</strong>
          </div>
          <div className="gm-gh-stat">
            <span className="gm-label">Evt/s</span>
            <strong>{num(soak.activity?.eventsPerSec, 1)}</strong>
          </div>
          <div className="gm-gh-stat">
            <span className="gm-label">Dec/s</span>
            <strong>{num(soak.activity?.decisionsPerSec, 1)}</strong>
          </div>
          <div className="gm-gh-stat">
            <span className="gm-label">Signals/h</span>
            <strong>{num(soak.activity?.signalsPerHour, 1)}</strong>
          </div>
          <div className="gm-gh-stat">
            <span className="gm-label">Entries/h</span>
            <strong>{num(soak.activity?.entriesPerHour, 1)}</strong>
          </div>
          <div className="gm-gh-stat">
            <span className="gm-label">Trades/h</span>
            <strong>{num(soak.activity?.tradesPerHour, 1)}</strong>
          </div>
          <div className="gm-gh-stat">
            <span className="gm-label">Median entry gap</span>
            <strong>
              {soak.activity?.medianEntryIntervalSec != null
                ? `${num(soak.activity.medianEntryIntervalSec, 1)}s`
                : "—"}
            </strong>
          </div>
        </section>
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
            {formatGhState(huntState)}
          </span>
          <span className="gm-gh-action" data-testid="gh-action">
            {fast?.action ?? forecast?.action ?? "WAIT"}
          </span>
        </div>
        <div className="gm-gh-quote" data-testid="gh-fast-metrics">
          <span>Bid {num(fast?.bid ?? forecast?.bid, 2)}</span>
          <span>Ask {num(fast?.ask ?? forecast?.ask, 2)}</span>
          <span>Spread {num(fast?.spread ?? forecast?.spread, 3)}</span>
          <span>Evt/s {num(fast?.eventRate1s, 0)}</span>
          <span>BidDepth {num(fast?.bidDepth, 0)}</span>
          <span>AskDepth {num(fast?.askDepth, 0)}</span>
          <span>Imb {num(fast?.depthImbalance, 3)}</span>
          <span>Vel {num(fast?.velocity, 5)}</span>
          <span>Accel {num(fast?.acceleration, 5)}</span>
          <span>Setup {fast?.setup ?? "—"}</span>
          <span>Qual {num(fast?.setupQuality, 2)}</span>
          <span>
            Lat{" "}
            {fast?.decisionLatencyMs != null
              ? `${Math.round(fast.decisionLatencyMs)}ms`
              : "—"}
          </span>
          <span>
            Age{" "}
            {forecast?.quoteAgeMs != null
              ? `${Math.round(forecast.quoteAgeMs)}ms`
              : "—"}
          </span>
        </div>
        {fast?.open ? (
          <div className="gm-gh-fast-open" data-testid="gh-fast-open">
            <span>{fast.open.side}</span>
            <span>Entry {num(fast.open.entry, 2)}</span>
            <span>Exit {num(fast.open.executableExit, 2)}</span>
            <span>P/L {signed(fast.open.openPnl)}</span>
            <span>MFE {num(fast.open.mfe, 3)}</span>
            <span>MAE {num(fast.open.mae, 3)}</span>
            <span>
              Dur{" "}
              {fast.open.durationMs != null
                ? `${(fast.open.durationMs / 1000).toFixed(1)}s`
                : "—"}
            </span>
            <span>Lock {fast.open.profitLock ? "ON" : "off"}</span>
            <span>Trail {num(fast.open.trail, 3)}</span>
          </div>
        ) : null}
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
                  Math.round((nowMs - gh.openTrade.entryTimestampMs) / 1000)
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
              <th>Setup</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>Duration</th>
              <th>Result</th>
              <th>Net move</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.tradeId}>
                <td>{fmtTime(t.entryTimestampMs)}</td>
                <td>{t.side}</td>
                <td>{t.entryReason}</td>
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
