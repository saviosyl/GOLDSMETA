import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { Decision, SetupRecord } from "../types/models";
import { cacheKeys, loadCache, saveCache } from "../lib/offlineCache";
import { formatClientError } from "../lib/errors";
import {
  formatSession,
  formatUserTimestamp,
  humanDecisionState,
  plainLanguageReason
} from "../lib/plainLanguage";
import {
  DisclosurePanel,
  EmptyState,
  MetricCard,
  PageHeader,
  SectionCard,
  StatusBadge
} from "../components/ui/primitives";

type Briefing = {
  session?: string | null;
  marketRegime?: string | null;
  positionVsPoc?: string;
  atrLabel?: string;
  atrValue?: number | null;
  levels?: { poc?: number | null; vah?: number | null; val?: number | null };
  currentState?: string;
  insufficientData?: boolean;
  dataTimestamp?: string;
  disclaimer?: string;
};

type Score = {
  total?: number;
  components?: Array<{ label: string; score: number; max: number; reason: string }>;
  disclaimer?: string;
};

/** V5.4 Dashboard — clean light premium overview. */
export function OverviewPage() {
  const { api, user } = useAuth();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [setup, setSetup] = useState<SetupRecord | null>(null);
  const [recent, setRecent] = useState<SetupRecord[]>([]);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [score, setScore] = useState<Score | null>(null);
  const [source, setSource] = useState<"live" | "cached" | "offline">("live");
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [latest, active, recentSetups, b, s] = await Promise.all([
        api.latestDecision(),
        api.listActiveSetups().catch(() => [] as SetupRecord[]),
        api.listSetups(6, "LIVE").catch(() => [] as SetupRecord[]),
        api.v5Briefing("LIVE").catch(() => null),
        api.v5Score("LIVE").catch(() => null)
      ]);
      setDecision(latest);
      setRecent(recentSetups.slice(0, 3));
      setBriefing(b as Briefing | null);
      setScore(s as Score | null);
      setSource("live");
      setCachedAt(null);
      if (latest) {
        saveCache(cacheKeys.decision, latest);
        setSetup(active.find((x) => x.decisionId === latest.decisionId) ?? active[0] ?? null);
      } else {
        setSetup(active[0] ?? null);
      }
    } catch (err) {
      const cached = loadCache<Decision>(cacheKeys.decision);
      if (cached) {
        setDecision(cached.value);
        setSource(navigator.onLine ? "cached" : "offline");
        setCachedAt(cached.savedAt);
      }
      setError(formatClientError(err, "Unable to load market state"));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const decisionCode = decision?.decision ?? "WAIT";
  const reason = plainLanguageReason(
    decision?.reasonCodes ??
      (Array.isArray(decision?.reasonSummary) ? decision.reasonSummary : undefined),
    undefined
  );
  const freshness =
    source === "offline"
      ? `Offline · last stored ${formatUserTimestamp(cachedAt)}`
      : source === "cached"
        ? `Cached · ${formatUserTimestamp(cachedAt)}`
        : `Updated ${formatUserTimestamp(decision?.generatedAt ?? briefing?.dataTimestamp)}`;

  return (
    <div data-testid="overview-page">
      <PageHeader
        title="Dashboard"
        environment={decision?.environment ?? "LIVE"}
        freshness={freshness}
        accountLabel={user?.email ?? null}
      />
      <p className="gm-meta" style={{ marginTop: -12, marginBottom: 16 }}>
        Current XAUUSD context — analysis only. GoldMeta does not place trades.
      </p>

      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {loading && (
        <SectionCard>
          <p className="gm-meta">Loading market state…</p>
        </SectionCard>
      )}

      <div className="gm-summary-row" data-testid="dashboard-summary">
        <MetricCard label="Symbol" value="XAUUSD" />
        <MetricCard label="State" value={humanDecisionState(decisionCode)} />
        <MetricCard
          label="Setup quality"
          value={score?.total != null ? `${score.total}/100` : "—"}
          hint="Rules-based score, not win probability"
        />
        <MetricCard
          label="Session"
          value={formatSession(briefing?.session ?? decision?.currentSession)}
        />
      </div>

      <SectionCard className="gm-primary-state" title="Primary signal">
        <div className="row" style={{ gap: 8, marginBottom: 8, display: "flex", flexWrap: "wrap" }}>
          <StatusBadge tone="gold">XAUUSD</StatusBadge>
          <StatusBadge tone="neutral">
            {formatSession(briefing?.session ?? decision?.currentSession)}
          </StatusBadge>
          {source !== "live" && (
            <StatusBadge tone="warning">{source === "offline" ? "Offline" : "Stale"}</StatusBadge>
          )}
        </div>
        <div className={`gm-decision ${decisionCode.toLowerCase()}`} data-testid="primary-decision">
          {humanDecisionState(decisionCode)}
        </div>
        <p style={{ margin: "0 0 12px", maxWidth: 720, color: "var(--text-secondary)" }}>{reason}</p>
        <div className="gm-metrics-grid">
          <MetricCard label="POC" value={briefing?.levels?.poc ?? "—"} />
          <MetricCard label="VAH" value={briefing?.levels?.vah ?? "—"} />
          <MetricCard label="VAL" value={briefing?.levels?.val ?? "—"} />
          <MetricCard
            label="Confirmed bar"
            value={formatUserTimestamp(decision?.barTime ?? decision?.generatedAt)}
          />
        </div>
        {setup ? (
          <div className="gm-metrics-grid" style={{ marginTop: 12 }}>
            <MetricCard label="Plan status" value={String(setup.status).replace(/_/g, " ")} />
            <MetricCard label="Entry" value={setup.levels?.entryPrice ?? "—"} />
            <MetricCard label="Stop" value={setup.levels?.stopLoss ?? "—"} />
            <MetricCard label="TP1" value={setup.levels?.tp1 ?? "—"} />
          </div>
        ) : (
          <EmptyState
            title="No validated shadow plan yet."
            body="V4 remains SHADOW only."
          />
        )}
        <DisclosurePanel summary="Technical details">
          <p className="gm-meta">
            Decision ID: {decision?.decisionId ?? "—"}
            <br />
            Raw codes: {(decision?.reasonCodes ?? []).join(", ") || "none"}
          </p>
        </DisclosurePanel>
      </SectionCard>

      <div className="gm-two-col">
        <SectionCard title="Market briefing">
          {briefing?.insufficientData ? (
            <EmptyState title="Insufficient verified data for a full briefing." />
          ) : (
            <p style={{ margin: 0, maxWidth: 720, color: "var(--text-secondary)" }}>
              Session {formatSession(briefing?.session)}. Regime {briefing?.marketRegime ?? "unknown"}.
              Position vs POC {briefing?.positionVsPoc?.replace(/_/g, " ") ?? "—"}. ATR{" "}
              {briefing?.atrLabel ?? "—"}. This summary is informational only.
            </p>
          )}
          <p className="gm-meta">{briefing?.disclaimer}</p>
        </SectionCard>

        <SectionCard
          title="Recent activity"
          action={
            <Link className="gm-linkish" to="/history">
              View history
            </Link>
          }
        >
          {recent.length === 0 ? (
            <EmptyState title="No recent setups yet." />
          ) : (
            <ul className="list">
              {recent.map((s) => (
                <li key={s.setupId}>
                  <Link to={`/setups/${s.setupId}`}>
                    {s.direction ?? "—"} · {String(s.status).replace(/_/g, " ")}
                  </Link>
                  <div className="gm-meta">{formatUserTimestamp(s.createdAt)}</div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Risk planner"
        action={
          <Link className="gm-btn-outline" to="/planner" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            Open planner
          </Link>
        }
      >
        <p className="gm-meta" style={{ margin: 0 }}>
          Manual sizing aid only. Prefer the dedicated Risk planner for progressive inputs. GoldMeta
          never places broker orders.
        </p>
      </SectionCard>

      <DisclosurePanel summary="View full score breakdown">
        {score?.total == null ? (
          <EmptyState title="Insufficient verified data." />
        ) : (
          <>
            <p>
              <strong>{score.total} / 100</strong>
            </p>
            <p className="gm-meta" data-testid="score-disclaimer">
              {score.disclaimer ??
                "GoldMeta Score is a rules-based setup-quality measurement. It is not the probability of a profitable trade."}
            </p>
            <ul className="list compact">
              {(score.components ?? []).map((c) => (
                <li key={c.label}>
                  <strong>
                    {c.label} {c.score}/{c.max}
                  </strong>
                  <div className="gm-meta">{c.reason}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </DisclosurePanel>
    </div>
  );
}
