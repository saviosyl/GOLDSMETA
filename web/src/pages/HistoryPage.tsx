import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import type { Decision } from "../types/models";
import { formatPercent, formatWhen } from "../lib/format";
import { cacheKeys, loadCache, saveCache } from "../lib/offlineCache";

export function HistoryPage() {
  const { api } = useAuth();
  const [items, setItems] = useState<Decision[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

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

  return (
    <>
      <h1 className="brand" style={{ fontSize: "1.4rem" }}>
        Signal history
      </h1>
      {(error || offline) && (
        <div className="banner stale" role="status">
          {error ?? "Offline"} — showing cached history when available.
        </div>
      )}
      <div className="card">
        {items.length === 0 ? (
          <p className="muted">No signals yet.</p>
        ) : (
          <ul className="list">
            {items.map((item) => (
              <li key={item.decisionId}>
                <strong className={item.decision}>{item.decision}</strong> ·{" "}
                {formatPercent(item.confidence)} · {formatWhen(item.generatedAt)}
                <div className="muted">{item.decisionId}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
