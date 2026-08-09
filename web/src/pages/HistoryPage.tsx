import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { Decision, SetupRecord, SignalOutcomeRecord } from "../types/models";
import {
  filterHistory,
  formatPercent,
  formatWhen,
  primaryReason,
  type HistoryFilter
} from "../lib/decisionDisplay";
import { formatWaitGroupLabel, groupHistoryItems } from "../lib/historyGrouping";
import { plainReason } from "../lib/reasonCodePlain";
import { historyRecordKind } from "../lib/historyRecordKind";
import { cacheKeys, loadCache, saveCache } from "../lib/offlineCache";

const PRIMARY_FILTERS: Array<{ id: HistoryFilter; label: string }> = [
  { id: "ALL", label: "All" },
  { id: "BUY", label: "BUY" },
  { id: "SELL", label: "SELL" },
  { id: "WAIT", label: "Waits" },
  { id: "WON", label: "Won" },
  { id: "LOST", label: "Lost" }
];

const MORE_FILTERS: Array<{ id: HistoryFilter; label: string }> = [
  { id: "ACTIVE", label: "Active" },
  { id: "EXPIRED", label: "Expired" },
  { id: "LIVE", label: "Demo/Live" },
  { id: "TEST", label: "Signals" }
];

function formatR(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}R`;
}

function compactWhen(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return formatWhen(iso);
    return d.toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return formatWhen(iso);
  }
}

function resultLabel(
  decision: Decision,
  outcome: SignalOutcomeRecord | undefined
): { text: string; tone: string } {
  if (decision.decision === "WAIT") {
    return { text: "WAIT", tone: "wait" };
  }
  const fin = outcome?.finalResult;
  if (fin?.outcome) {
    const r = formatR(fin.netR);
    const outcomeText = String(fin.outcome).toUpperCase();
    if (/WIN|TP|TARGET/i.test(outcomeText)) {
      return { text: `WIN · ${r}`, tone: "win" };
    }
    if (/LOSS|STOP|SL/i.test(outcomeText)) {
      return { text: `LOSS · ${r}`, tone: "loss" };
    }
    return { text: `${outcomeText} · ${r}`, tone: "neutral" };
  }
  if (outcome?.monitoring?.lifecycle) {
    return { text: String(outcome.monitoring.lifecycle).replace(/_/g, " "), tone: "pending" };
  }
  return { text: "Pending", tone: "pending" };
}

export function HistoryPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Decision[]>([]);
  const [setups, setSetups] = useState<SetupRecord[]>([]);
  const [outcomes, setOutcomes] = useState<SignalOutcomeRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [filter, setFilter] = useState<HistoryFilter>("ALL");
  const [moreOpen, setMoreOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [decisions, setupList, outcomeList] = await Promise.all([
          api.decisionHistory(40),
          api.listSetups(100).catch(() => [] as SetupRecord[]),
          api.listSignalOutcomes(100).catch(() => [] as SignalOutcomeRecord[])
        ]);
        setItems(decisions);
        setSetups(setupList);
        setOutcomes(outcomeList);
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

  const setupsByDecisionId = useMemo(() => {
    const map = new Map<string, { status: string; resolution: string; environment: string }>();
    for (const s of setups) {
      map.set(s.decisionId, {
        status: s.status,
        resolution: s.resolution,
        environment: s.environment
      });
    }
    return map;
  }, [setups]);

  const outcomesByDecisionId = useMemo(() => {
    const map = new Map<string, SignalOutcomeRecord>();
    for (const o of outcomes) map.set(o.snapshot.decisionId, o);
    return map;
  }, [outcomes]);

  const visible = useMemo(
    () => filterHistory(items, filter, setupsByDecisionId),
    [items, filter, setupsByDecisionId]
  );

  const grouped = useMemo(
    () =>
      groupHistoryItems(
        visible.map((item) => ({
          decisionId: item.decisionId,
          decision: item.decision,
          generatedAt: item.generatedAt,
          reasonCodes: item.reasonCodes,
          oneLineReason: plainReason(primaryReason(item))
        }))
      ),
    [visible]
  );

  return (
    <div className="history-page gm-history-redesign gm-history-compact" data-testid="signal-history-page">
      {!embedded ? (
        <div className="history-header-row">
          <h1 className="brand" style={{ fontSize: "1.4rem" }}>
            History
          </h1>
          <Link
            className="history-perf-link"
            to="/insights/signals"
            data-testid="signal-performance-link"
          >
            Hypothetical performance
          </Link>
        </div>
      ) : null}
      <p className="muted history-disclaimer" data-testid="hypothetical-disclaimer">
        Past hypothetical results do not guarantee future trading performance.
      </p>
      {(error || offline) && (
        <div className="banner stale" role="status">
          {error ?? "Offline"} — showing cached history when available.
        </div>
      )}

      <div className="history-filters" role="tablist" aria-label="Filter decisions">
        {PRIMARY_FILTERS.map((item) => (
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
        <button
          type="button"
          className={`history-filter ${moreOpen ? "active" : ""}`}
          aria-expanded={moreOpen}
          data-testid="history-more-filters"
          onClick={() => setMoreOpen((v) => !v)}
        >
          More
        </button>
      </div>
      {moreOpen ? (
        <div className="history-filters history-filters-more" role="group" aria-label="More filters">
          {MORE_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`history-filter ${filter === item.id ? "active" : ""}`}
              onClick={() => {
                setFilter(item.id);
                setMoreOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="card history-list-card">
        {visible.length === 0 ? (
          <p className="muted">No signals yet.</p>
        ) : (
          <ul className="history-list">
            {grouped.map((row) => {
              if (row.kind === "wait_group") {
                return (
                  <li key={row.id}>
                    <div
                      className="history-item history-wait-group history-item--compact"
                      data-testid={`history-wait-group-${row.id}`}
                    >
                      <div className="history-item-top">
                        <strong className="history-decision WAIT">WAIT</strong>
                        <span className="badge">Grouped · {row.count}</span>
                      </div>
                      <div className="history-item-reason">{plainReason(row.reason)}</div>
                      <div className="history-item-meta muted">{formatWaitGroupLabel(row)}</div>
                    </div>
                  </li>
                );
              }
              const item = visible.find((d) => d.decisionId === row.item.decisionId);
              if (!item) return null;
              const setup = setupsByDecisionId.get(item.decisionId);
              const outcome = outcomesByDecisionId.get(item.decisionId);
              const kind = historyRecordKind({ decision: item, setup, outcome });
              const result = resultLabel(item, outcome);
              const reason = plainReason(primaryReason(item));
              const isWait = item.decision === "WAIT";
              const expanded = expandedId === item.decisionId;
              return (
                <li key={item.decisionId}>
                  <div
                    role="button"
                    tabIndex={0}
                    className={`history-item history-item--compact${isWait ? " history-item--wait" : ""}`}
                    data-testid={`history-item-${item.decisionId}`}
                    onClick={() => navigate(`/history/${encodeURIComponent(item.decisionId)}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate(`/history/${encodeURIComponent(item.decisionId)}`);
                      }
                    }}
                  >
                    <div className="history-item-top">
                      <time className="history-when muted">{compactWhen(item.generatedAt)}</time>
                      <strong className={`history-decision ${item.decision}`}>
                        {item.decision}
                        {!isWait ? (
                          <span className="history-confidence"> · {formatPercent(item.confidence)}</span>
                        ) : null}
                      </strong>
                      {!isWait ? (
                        <span className={`badge history-result history-result--${result.tone}`}>
                          {result.text}
                        </span>
                      ) : null}
                      <span
                        className={`badge history-env history-kind-${kind.kind.toLowerCase()}`}
                        data-testid={`env-badge-${item.decisionId}`}
                        data-environment={item.environment ?? ""}
                      >
                        {kind.label}
                      </span>
                    </div>
                    <p className="history-item-reason">{reason}</p>
                    <div className="history-item-actions">
                      <span className="gm-linkish" data-testid={`history-details-${item.decisionId}`}>
                        View details &gt;
                      </span>
                      <button
                        type="button"
                        className="gm-linkish muted"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedId((id) => (id === item.decisionId ? null : item.decisionId));
                        }}
                      >
                        {expanded ? "Hide advanced" : "Advanced"}
                      </button>
                    </div>
                    {expanded ? (
                      <details className="history-diagnostics" open data-testid={`history-advanced-${item.decisionId}`}>
                        <summary>Advanced diagnostics</summary>
                        <pre className="muted">{(item.reasonCodes ?? []).join(", ") || "—"}</pre>
                        {outcome?.finalResult ? (
                          <p className="muted">
                            Entry {outcome.finalResult.entryPrice ?? "—"} · SL{" "}
                            {outcome.snapshot.stopLoss ?? "—"} · Exit{" "}
                            {outcome.finalResult.exitPrice ?? "—"}
                          </p>
                        ) : null}
                        {outcome && !outcome.finalResult ? (
                          <p className="muted">HYPOTHETICAL SIGNAL PERFORMANCE</p>
                        ) : null}
                      </details>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
