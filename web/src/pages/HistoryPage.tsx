import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { Decision, SetupRecord, SignalOutcomeRecord } from "../types/models";
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
import { formatWaitGroupLabel, groupHistoryItems } from "../lib/historyGrouping";
import { plainReason } from "../lib/reasonCodePlain";
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

function formatPts(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

function formatR(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}R`;
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function outcomeBlock(outcome: SignalOutcomeRecord | undefined, decision: Decision) {
  if (decision.decision === "WAIT") {
    return (
      <div className="history-outcome muted" data-testid={`wait-no-trade-${decision.decisionId}`}>
        WAIT — analysis only (not counted as a trade)
      </div>
    );
  }
  if (!outcome) {
    return (
      <div className="history-outcome muted" data-testid={`outcome-pending-${decision.decisionId}`}>
        Hypothetical tracking pending
      </div>
    );
  }
  const snap = outcome.snapshot;
  const mon = outcome.monitoring;
  const fin = outcome.finalResult;
  const entryLabel =
    snap.entryZoneLow != null && snap.entryZoneHigh != null
      ? `${snap.entryZoneLow}–${snap.entryZoneHigh}`
      : snap.proposedEntryPrice != null
        ? String(snap.proposedEntryPrice)
        : "—";

  if (fin?.outcome) {
    return (
      <div
        className="history-outcome"
        data-testid={`outcome-final-${decision.decisionId}`}
      >
        <div className="history-outcome-row">
          Entry: {fin.entryPrice ?? entryLabel} · Stop: {snap.stopLoss ?? "—"}
        </div>
        <div className="history-outcome-row">
          TP1: {snap.tp1 ?? "—"} {mon.tp1Status === "HIT" ? "— HIT" : ""}
          {snap.tp2 != null ? ` · TP2: ${snap.tp2}${mon.tp2Status === "HIT" ? " — HIT" : ""}` : ""}
          {snap.tp3 != null ? ` · TP3: ${snap.tp3}${mon.tp3Status === "HIT" ? " — HIT" : ""}` : ""}
        </div>
        <div className="history-outcome-row">
          Closed: {fin.exitPrice ?? "—"} · Result: {formatPts(fin.netPoints)} | {formatR(fin.netR)}
        </div>
        <div className="history-outcome-row">
          Outcome: <strong>{fin.outcome}</strong> · Held {formatDuration(fin.holdingDurationMs)}
        </div>
        <div className="history-outcome-label muted">{fin.label}</div>
      </div>
    );
  }

  return (
    <div className="history-outcome" data-testid={`outcome-live-${decision.decisionId}`}>
      <div className="history-outcome-row">
        Entry: {outcome.entry.entryPrice ?? entryLabel} · Current: {mon.currentPrice ?? "—"}
      </div>
      <div className="history-outcome-row">
        Stop: {snap.stopLoss ?? "—"} · TP1: {snap.tp1 ?? "—"}
      </div>
      <div className="history-outcome-row">
        Status: <strong>{mon.lifecycle}</strong> · Current: {formatPts(mon.currentGrossPoints)} |{" "}
        {formatR(mon.currentRMultiple)}
      </div>
      <div className="history-outcome-label muted">HYPOTHETICAL SIGNAL PERFORMANCE</div>
    </div>
  );
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
    <div className="history-page gm-history-redesign" data-testid="signal-history-page">
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
                      className="history-item history-wait-group"
                      data-testid={`history-wait-group-${row.id}`}
                    >
                      <div className="history-item-top">
                        <strong className="history-decision WAIT">WAIT</strong>
                        <span className="badge">Grouped</span>
                      </div>
                      <div className="history-item-reason">{formatWaitGroupLabel(row)}</div>
                      <div className="history-item-meta muted">
                        {plainReason(row.reason)} · {row.count} identical checks collapsed
                      </div>
                      <details className="history-diagnostics">
                        <summary>View diagnostics</summary>
                        <ul>
                          {row.items.map((item) => (
                            <li key={item.decisionId}>
                              {formatWhen(item.generatedAt)} · {item.decisionId}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </div>
                  </li>
                );
              }
              const item = visible.find((d) => d.decisionId === row.item.decisionId);
              if (!item) return null;
              const quality = displayQualityLabel(item);
              const setup = setupsByDecisionId.get(item.decisionId);
              const outcome = outcomesByDecisionId.get(item.decisionId);
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
                      <span className="history-confidence" title="Setup quality score">
                        {formatPercent(item.confidence)}
                      </span>
                      <span
                        className={`badge history-env ${item.environment === "TEST" ? "test" : ""}`}
                        data-testid={`env-badge-${item.decisionId}`}
                      >
                        {item.environment === "TEST" ? "TEST" : "LIVE"}
                      </span>
                      <span className={`badge history-quality ${quality.toLowerCase()}`}>{quality}</span>
                      {setup && (
                        <span className="badge" data-testid={`setup-badge-${item.decisionId}`}>
                          {setup.resolution === "OPEN" ? setup.status : setup.resolution}
                        </span>
                      )}
                      {outcome && (
                        <span className="badge" data-testid={`lifecycle-badge-${item.decisionId}`}>
                          {outcome.finalResult?.outcome ?? outcome.monitoring.lifecycle}
                        </span>
                      )}
                    </div>
                    <div className="history-item-meta muted">
                      {item.symbol} · {timeframeLabel(item)} · {formatWhen(item.generatedAt)}
                      {item.currentSession ? ` · ${item.currentSession}` : ""}
                    </div>
                    <div className="history-item-meta muted">Trend {trendLabel(item)}</div>
                    <div className="history-item-reason">{plainReason(primaryReason(item))}</div>
                    <details className="history-diagnostics">
                      <summary>View diagnostics</summary>
                      <pre className="muted">{(item.reasonCodes ?? []).join(", ") || "—"}</pre>
                    </details>
                    {outcomeBlock(outcome, item)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
