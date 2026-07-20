import { useCallback, useEffect, useState } from "react";
import { DecisionCard } from "../components/DecisionCard";
import { useAuth } from "../lib/auth";
import { ApiError, type Decision } from "../types/models";
import { cacheKeys, loadCache, saveCache } from "../lib/offlineCache";

export function DashboardPage() {
  const { api } = useAuth();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [source, setSource] = useState<"live" | "cached" | "offline">("live");
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const latest = await api.latestDecision();
      setDecision(latest);
      setSource("live");
      setCachedAt(null);
      saveCache(cacheKeys.decision, latest);
    } catch (err) {
      const cached = loadCache<Decision>(cacheKeys.decision);
      if (cached) {
        setDecision(cached.value);
        setSource(navigator.onLine ? "cached" : "offline");
        setCachedAt(cached.savedAt);
      } else {
        setDecision(null);
      }
      const message =
        err instanceof ApiError ? `${err.code}: ${err.message}` : "Unable to load decision";
      setError(message);
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

  return (
    <>
      <header>
        <h1 className="brand">GoldMeta</h1>
        <p className="subtitle">XAUUSD decision support</p>
      </header>

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
          source={source}
          cachedAt={cachedAt}
          onRefresh={refresh}
          refreshing={refreshing}
          actionsDisabled={!navigator.onLine}
        />
      )}
    </>
  );
}
