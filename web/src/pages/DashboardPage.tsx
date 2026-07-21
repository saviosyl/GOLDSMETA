import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DecisionCard } from "../components/DecisionCard";
import { useAuth } from "../lib/auth";
import type { Decision, SetupRecord, SystemStatus } from "../types/models";
import { cacheKeys, loadCache, saveCache } from "../lib/offlineCache";
import { formatClientError } from "../lib/errors";
import { formatWhen } from "../lib/format";

export function DashboardPage() {
  const { api } = useAuth();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [setup, setSetup] = useState<SetupRecord | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [source, setSource] = useState<"live" | "cached" | "offline">("live");
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [latest, system, active] = await Promise.all([
        api.latestDecision(),
        api.systemStatus().catch(() => null),
        api.listActiveSetups().catch(() => [] as SetupRecord[])
      ]);
      setDecision(latest);
      setStatus(system);
      setSource("live");
      setCachedAt(null);
      if (latest) {
        saveCache(cacheKeys.decision, latest);
        const linked =
          active.find((s) => s.decisionId === latest.decisionId) ??
          (await api.listSetups(20).then((list) => list.find((s) => s.decisionId === latest.decisionId) ?? null).catch(() => null));
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

  const freshness =
    status?.latestDecision?.generatedAt != null
      ? formatWhen(status.latestDecision.generatedAt)
      : "—";

  return (
    <>
      <header>
        <h1 className="brand">GoldMeta</h1>
        <p className="subtitle">XAUUSD decision support</p>
      </header>

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
              <span className="label">Health</span>
              <span className="value">
                {status.brokerLiveExecutionEnabled ? "UNSAFE" : "Analysis only"}
              </span>
            </div>
          </div>
          <div className="dashboard-links">
            <Link to="/analytics">Analytics</Link>
            <Link to="/diagnostics">Diagnostics</Link>
          </div>
        </section>
      )}

      {loading && (
        <div className="card" role="status">
          Loading latest decision…
        </div>
      )}

      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      {!loading && !decision && (
        <div className="card">
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
        <DecisionCard
          decision={decision}
          setup={setup}
          source={source}
          cachedAt={cachedAt}
          onRefresh={refresh}
          refreshing={refreshing}
        />
      )}
    </>
  );
}
