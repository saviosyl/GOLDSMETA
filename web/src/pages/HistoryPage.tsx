import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { Decision } from "../types/models";
import {
  displayQualityLabel,
  filterHistory,
  formatPercent,
  formatWhen,
  primaryReason,
  timeframeLabel,
  trendLabel,
  type HistoryFilter
} from "../lib/decisionDisplay";
import { cacheKeys, loadCache, saveCache } from "../lib/offlineCache";

const FILTERS: Array<{ id: HistoryFilter; label: string }> = [
  { id: "ALL", label: "All" },
  { id: "BUY", label: "BUY" },
  { id: "SELL", label: "SELL" },
  { id: "WAIT", label: "WAIT" }
];

export function HistoryPage() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Decision[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [filter, setFilter] = useState<HistoryFilter>("ALL");

  useEffect(() => {
    void (async () => {
      try {
        const decisions = await api.decisionHistory(40);
        setItems(decisions);
        saveCache(cacheKeys.history, decisions);
        setOffline(false);
      } catch (err) {
        const cached = loadCache<Decision[]>(cacheKeys.history);
        setItems(cached?.value ?? []);
        setOffline(true);
        setError(err instanceof Error ? err.message : "Failed to load history");
      }
    })();
  }, [api]);

  const visible = useMemo(() => filterHistory(items, filter), [items, filter]);

  return (
    <div className="history-page">
      <h1 className="brand" style={{ fontSize: "1.4rem" }}>
        Signal history
      </h1>
      {(error || offline) && (
        <div className="banner stale" role="status">
          {error ?? "Offline"} — showing cached history when available.
        </div>
      )}

      <div className="history-filters" role="tablist" aria-label="Filter decisions">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            className={`history-filter ${filter === item.id ? "active" : ""}`}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="card history-list-card">
        {visible.length === 0 ? (
          <p className="muted">No signals yet.</p>
        ) : (
          <ul className="history-list">
            {visible.map((item) => {
              const quality = displayQualityLabel(item);
              return (
                <li key={item.decisionId}>
                  <button
                    type="button"
                    className="history-item"
                    onClick={() => navigate(`/history/${encodeURIComponent(item.decisionId)}`)}
                    data-testid={`history-item-${item.decisionId}`}
                  >
                    <div className="history-item-top">
                      <strong className={`history-decision ${item.decision}`}>{item.decision}</strong>
                      <span className="history-confidence">{formatPercent(item.confidence)}</span>
                      <span className={`badge history-quality ${quality.toLowerCase()}`}>{quality}</span>
                    </div>
                    <div className="history-item-meta muted">
                      {item.symbol} · {timeframeLabel(item)} · {formatWhen(item.generatedAt)}
                    </div>
                    <div className="history-item-meta muted">Trend {trendLabel(item)}</div>
                    <div className="history-item-reason">{primaryReason(item)}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="muted history-footnote">
        Tap a signal for the full plan. Analysis only — not broker execution.{" "}
        <Link to="/analysis">Open analysis</Link>
      </p>
    </div>
  );
}
