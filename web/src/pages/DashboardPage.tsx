import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BrandHeader } from "../components/BrandHeader";
import { DecisionCard } from "../components/DecisionCard";
import { SetupTimeline } from "../components/SetupTimeline";
import { ManualRiskPlanner } from "../components/ManualRiskPlanner";
import { LiveForwardAck } from "../components/LiveForwardAck";
import { ManualTradeActions } from "../components/ManualTradeActions";
import { DailyRiskStatus } from "../components/DailyRiskStatus";
import { useAuth } from "../lib/auth";
import type {
  BackendSettings,
  Decision,
  ManualRiskSettings,
  SetupRecord,
  SystemStatus
} from "../types/models";
import { cacheKeys, loadCache, saveCache } from "../lib/offlineCache";
import { formatClientError } from "../lib/errors";
import { formatWhen } from "../lib/format";
import { computeDailyManualRiskStatus } from "../lib/manualRisk";

const DEFAULT_RISK: ManualRiskSettings = {
  currency: "EUR",
  maxCashRiskPerTrade: 20,
  maxSimultaneousManualTrades: 1,
  maxDailyRealisedLoss: 40,
  stopAfterConsecutiveLosses: 2,
  valuePerPoint: null,
  estimatedSpreadPoints: null,
  noAveragingDown: true,
  noMartingale: true,
  noAutomaticRecovery: true
};

export function DashboardPage() {
  const { api } = useAuth();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [setup, setSetup] = useState<SetupRecord | null>(null);
  const [recentSetups, setRecentSetups] = useState<SetupRecord[]>([]);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [settings, setSettings] = useState<BackendSettings | null>(null);
  const [source, setSource] = useState<"live" | "cached" | "offline">("live");
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [ackBusy, setAckBusy] = useState(false);

  const risk = settings?.manualRisk ?? status?.manualRisk ?? DEFAULT_RISK;
  const liveAcked = Boolean(settings?.liveForwardAckAt ?? status?.liveForwardAckAt);
  const trackingEnvs = Array.isArray(status?.flags?.setupTrackingEnvironments)
    ? (status!.flags.setupTrackingEnvironments as string[])
    : [];

  const dailyStatus = useMemo(
    () => computeDailyManualRiskStatus(recentSetups, risk),
    [recentSetups, risk]
  );
  const suppressActions = dailyStatus.stopTradingToday;

  const load = useCallback(async () => {
    setError(null);
    try {
      const [latest, system, active, settingsRes, recent] = await Promise.all([
        api.latestDecision(),
        api.systemStatus().catch(() => null),
        api.listActiveSetups().catch(() => [] as SetupRecord[]),
        api.getSettings().catch(() => null),
        api.listSetups(40, "LIVE").catch(() => [] as SetupRecord[])
      ]);
      setDecision(latest);
      setStatus(system);
      setSettings(settingsRes);
      setRecentSetups(recent);
      setSource("live");
      setCachedAt(null);
      if (latest) {
        saveCache(cacheKeys.decision, latest);
        const linked =
          active.find((s) => s.decisionId === latest.decisionId) ??
          (await api
            .listSetups(20)
            .then((list) => list.find((s) => s.decisionId === latest.decisionId) ?? null)
            .catch(() => null));
        setSetup(linked);
      } else {
        setSetup(active[0] ?? null);
      }
    } catch (err) {
      const cached = loadCache<Decision>(cacheKeys.decision);
      if (cached) {
        setDecision(cached.value);
        setSource(navigator.onLine ? "cached" : "offline");
        setCachedAt(cached.savedAt);
      } else {
        setDecision(null);
      }
      setError(formatClientError(err, "Unable to load decision"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onOnline = () => {
      setRefreshing(true);
      void load();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [load]);

  const refresh = () => {
    setRefreshing(true);
    void load();
  };

  const acknowledgeLive = async () => {
    setAckBusy(true);
    try {
      const updated = await api.updateSettings({
        liveForwardAckAt: new Date().toISOString()
      });
      setSettings(updated);
    } catch (err) {
      setError(formatClientError(err, "Failed to save acknowledgement"));
    } finally {
      setAckBusy(false);
    }
  };

  const freshness =
    status?.latestDecision?.generatedAt != null
      ? formatWhen(status.latestDecision.generatedAt)
      : "—";

  const envLabel =
    decision?.environment ??
    setup?.environment ??
    status?.latestDecision?.environment ??
    null;

  const marketLabel = !navigator.onLine
    ? "Offline"
    : status?.tradingView.connectionStatus === "ACTIVE"
      ? "Market feed connected"
      : status
        ? `TradingView ${status.tradingView.connectionStatus}`
        : "Status unknown";

  return (
    <>
      <BrandHeader environment={envLabel} trackingEnvs={trackingEnvs} />

      <section className="card market-status" aria-label="Market status" data-testid="market-status">
        <h2 className="section-title">Market status</h2>
        <p className="market-status-line">{marketLabel}</p>
        <p className="muted">
          Broker execution:{" "}
          <strong>
            {String(status?.brokerMode ?? status?.flags?.brokerMode ?? "DISABLED")}
          </strong>{" "}
          · Analysis only
        </p>
      </section>

      {status && (
        <section className="card system-status" aria-label="Live pipeline status" data-testid="system-status">
          <h2 className="section-title">Pipeline</h2>
          <div className="grid-2 compact-metrics">
            <div className="metric">
              <span className="label">TradingView</span>
              <span className="value">{status.tradingView.connectionStatus}</span>
            </div>
            <div className="metric">
              <span className="label">Last alert</span>
              <span className="value">
                {status.tradingView.lastAlertAt ? formatWhen(status.tradingView.lastAlertAt) : "—"}
              </span>
            </div>
            <div className="metric">
              <span className="label">Latest bar</span>
              <span className="value">
                {status.latestDecision?.barTime ? formatWhen(status.latestDecision.barTime) : "—"}
              </span>
            </div>
            <div className="metric">
              <span className="label">Latest decision</span>
              <span className="value">{freshness}</span>
            </div>
            <div className="metric">
              <span className="label">Active setup</span>
              <span className="value">
                {status.activeSetups[0]
                  ? `${status.activeSetups[0].direction} · ${status.activeSetups[0].status}`
                  : "None"}
              </span>
            </div>
            <div className="metric">
              <span className="label">Backend</span>
              <span className="value">{status.backendVersion}</span>
            </div>
          </div>
          {status.latestSetupSkip && (
            <div className="banner stale" role="status" data-testid="setup-skip-banner">
              New signal blocked: {status.latestSetupSkip.reason}
            </div>
          )}
          <div className="dashboard-links">
            <Link to="/analytics">Analytics</Link>
            <Link to="/diagnostics">Diagnostics</Link>
          </div>
        </section>
      )}

      <LiveForwardAck
        acknowledged={liveAcked}
        busy={ackBusy}
        onAcknowledge={() => void acknowledgeLive()}
      />

      <DailyRiskStatus status={dailyStatus} />

      {loading && (
        <div className="card skeleton-card" role="status" data-testid="dashboard-loading">
          <div className="skeleton-line" />
          <div className="skeleton-line short" />
          Loading latest decision…
        </div>
      )}

      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      {!loading && !decision && (
        <div className="card empty-state" data-testid="empty-decision">
          <h2>No decision yet</h2>
          <p className="muted">
            Connect TradingView in Settings and wait for the backend to publish a decision. The web
            app never invents BUY / SELL / WAIT locally.
          </p>
          <button type="button" className="btn primary block" onClick={refresh}>
            Refresh
          </button>
        </div>
      )}

      {decision && (
        <>
          {suppressActions && decision.decision !== "WAIT" && (
            <div className="banner stale" role="status">
              Actionable recommendation visually suppressed — STOP TRADING FOR TODAY. Signals still
              record.
            </div>
          )}
          <DecisionCard
            decision={decision}
            setup={setup}
            source={source}
            cachedAt={cachedAt}
            onRefresh={refresh}
            refreshing={refreshing}
            actionsDisabled={suppressActions}
          />
        </>
      )}

      {setup && <SetupTimeline setup={setup} />}

      {setup && (
        <section className="card" aria-label="Setup levels" data-testid="setup-levels-card">
          <h2 className="section-title">Entry · SL · TP</h2>
          <div className="grid-2 compact-metrics">
            <div className="metric">
              <span className="label">Entry</span>
              <span className="value">{setup.levels.entryPrice ?? "—"}</span>
            </div>
            <div className="metric">
              <span className="label">Stop</span>
              <span className="value">{setup.levels.stopLoss ?? "—"}</span>
            </div>
            <div className="metric">
              <span className="label">TP1</span>
              <span className="value">{setup.levels.tp1 ?? "—"}</span>
            </div>
            <div className="metric">
              <span className="label">TP2</span>
              <span className="value">{setup.levels.tp2 ?? "—"}</span>
            </div>
            <div className="metric">
              <span className="label">TP3</span>
              <span className="value">{setup.levels.tp3 ?? "—"}</span>
            </div>
            <div className="metric">
              <span className="label">Session</span>
              <span className="value">{setup.session ?? "—"}</span>
            </div>
          </div>
        </section>
      )}

      <ManualRiskPlanner risk={risk} setup={setup} suppressed={suppressActions} />

      {setup && (
        <ManualTradeActions
          setup={setup}
          risk={risk}
          ackRequired={!liveAcked}
          disabled={suppressActions}
          save={(id, patch) => api.saveManualExecution(id, patch)}
          onSaved={(s) => {
            setSetup(s);
            setRecentSetups((prev) => {
              const rest = prev.filter((x) => x.setupId !== s.setupId);
              return [s, ...rest];
            });
          }}
        />
      )}

      <section className="card" aria-label="Recent signals" data-testid="recent-signals">
        <h2 className="section-title">Recent LIVE signals</h2>
        {recentSetups.length === 0 ? (
          <p className="muted">No LIVE setups yet. WAIT never creates a setup.</p>
        ) : (
          <ul className="list recent-list">
            {recentSetups.slice(0, 6).map((s) => (
              <li key={s.setupId}>
                <Link to={`/setups/${s.setupId}`}>
                  {s.direction} · {s.status.replaceAll("_", " ")}
                </Link>
                <div className="muted">{formatWhen(s.createdAt)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="disclaimer-footer" data-testid="disclaimer">
        GoldMeta is analysis and decision-support software. You execute trades manually. Past or
        early LIVE results do not prove future performance. Maximum intended personal risk: €20 per
        trade (editable).
      </p>
    </>
  );
}
