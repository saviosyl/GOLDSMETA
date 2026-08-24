import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DecisionCard } from "../components/DecisionCard";
import { useAuth } from "../lib/auth";
import type { Decision } from "../types/models";
import { cacheKeys, loadCache } from "../lib/offlineCache";
import { formatClientError } from "../lib/errors";

export function HistoryDetailPage() {
  const { decisionId = "" } = useParams();
  const { api } = useAuth();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"live" | "cached" | "offline">("live");

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const remote = await api.getDecision(decisionId);
        if (remote) {
          setDecision(remote);
          setSource("live");
          return;
        }
        const cached = loadCache<Decision[]>(cacheKeys.history);
        const local = cached?.value.find((item) => item.decisionId === decisionId) ?? null;
        setDecision(local);
        setSource(navigator.onLine ? "cached" : "offline");
        if (!local) {
          setError("Decision not found.");
        }
      } catch (err) {
        const cached = loadCache<Decision[]>(cacheKeys.history);
        const local = cached?.value.find((item) => item.decisionId === decisionId) ?? null;
        setDecision(local);
        setSource(navigator.onLine ? "cached" : "offline");
        setError(formatClientError(err, "Failed to load decision"));
      } finally {
        setLoading(false);
      }
    })();
  }, [api, decisionId]);

  return (
    <div className="history-detail-page">
      <p className="muted">
        <Link to="/history">← Signal history</Link>
      </p>
      <h1 className="brand" style={{ fontSize: "1.4rem" }}>
        Decision detail
      </h1>
      {loading && (
        <div className="card" role="status">
          Loading decision…
        </div>
      )}
      {error && (
        <div className="banner stale" role="status">
          {error}
        </div>
      )}
      {!loading && decision && <DecisionCard decision={decision} source={source} />}
      {!loading && !decision && (
        <div className="card">
          <p className="muted">This decision is not available.</p>
          <Link className="btn block" to="/history">
            Back to history
          </Link>
        </div>
      )}
    </div>
  );
}
