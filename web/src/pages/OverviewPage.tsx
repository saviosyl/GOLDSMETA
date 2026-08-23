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

/** Redesigned Overview — calm market state first, no admin clutter. */
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
        : `Verified · ${formatUserTimestamp(decision?.generatedAt ?? briefing?.dataTimestamp)}`;

  const readiness = [
    { label: "Structure", ok: !(decision?.reasonCodes ?? []).some((c) => /structure|invalidation/i.test(c)) },
    { label: "Profile", ok: briefing?.levels?.poc != null },
    {
      label: "Confirmation",
      ok: !(decision?.reasonCodes ?? []).some((c) => /confirmation/i.test(c))
    },
    {
      label: "Risk geometry",
      ok: !(decision?.reasonCodes ?? []).some((c) => /risk|geometry/i.test(c))
    },
    {
      label: "News availability",
      ok: !(decision?.reasonCodes ?? []).some((c) => /news|blackout/i.test(c))
    }
  ];

  return (
    <div data-testid="overview-page">
      <PageHeader
        title="Overview"
        environment={decision?.environment ?? "LIVE"}
        freshness={freshness}
        accountLabel={user?.email ?? null}
      />

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

      <SectionCard className="gm-primary-state" title="Primary market state">
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <StatusBadge tone="gold">XAUUSD</StatusBadge>
          <StatusBadge tone="neutral">{formatSession(briefing?.session ?? decision?.currentSession)}</StatusBadge>
          {source !== "live" && <StatusBadge tone="warning">{source === "offline" ? "Offline" : "Stale"}</StatusBadge>}
        </div>
        <div className={`gm-decision ${decisionCode.toLowerCase()}`} data-testid="primary-decision">
          {humanDecisionState(decisionCode)}
        </div>
        <p style={{ margin: "0 0 8px", maxWidth: 640 }}>{reason}</p>
        <p className="gm-meta">
          Latest confirmed bar: {formatUserTimestamp(decision?.barTime ?? decision?.generatedAt)} ·
          Confidence {decision?.confidenceLabel ?? "—"}
        </p>
        <DisclosurePanel summary="Technical details">
          <p className="gm-meta">
            Decision ID: {decision?.decisionId ?? "—"}
            <br />
            Raw codes: {(decision?.reasonCodes ?? []).join(", ") || "none"}
          </p>
        </DisclosurePanel>
      </SectionCard>

      <SectionCard title="Key market context">
        <div className="gm-metrics-grid">
          <MetricCard label="POC position" value={briefing?.positionVsPoc?.replace(/_/g, " ") ?? "—"} />
          <MetricCard
            label="ATR regime"
            value={
              briefing?.atrLabel
                ? `${briefing.atrLabel}${briefing.atrValue != null ? ` (${briefing.atrValue})` : ""}`
                : "—"
            }
          />
          <MetricCard label="Market regime" value={briefing?.marketRegime ?? decision?.marketRegime ?? "—"} />
          <MetricCard
            label="Directional context"
            value={briefing?.currentState ?? decisionCode}
            hint="From verified V3 / V4 shadow context"
          />
        </div>
      </SectionCard>

      <SectionCard title="Setup readiness">
        <div className="gm-readiness">
          {readiness.map((r) => (
            <div className="gm-readiness-row" key={r.label}>
              <span>{r.label}</span>
              <StatusBadge tone={r.ok ? "positive" : "warning"}>{r.ok ? "Clear" : "Watch"}</StatusBadge>
            </div>
          ))}
        </div>
        <DisclosurePanel summary="View full score breakdown">
          {score?.total == null ? (
            <EmptyState title="Insufficient verified data." body="GoldMeta Score needs a verified V4 shadow analysis." />
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
      </SectionCard>

      <SectionCard title="Plan">
        {!setup ? (
          <EmptyState
            title="No validated shadow plan yet."
            body="V4 remains SHADOW only. GoldMeta will not place trades."
          />
        ) : (
          <div className="gm-metrics-grid">
            <MetricCard label="Status" value={String(setup.status).replace(/_/g, " ")} />
            <MetricCard label="Direction" value={setup.direction ?? "—"} />
            <MetricCard label="Entry" value={setup.levels?.entryPrice ?? "—"} />
            <MetricCard label="Stop" value={setup.levels?.stopLoss ?? "—"} />
          </div>
        )}
      </SectionCard>

      <SectionCard title="Briefing">
        {briefing?.insufficientData ? (
          <EmptyState title="Insufficient verified data for a full briefing." />
        ) : (
          <p style={{ margin: 0, maxWidth: 720 }}>
            Session {formatSession(briefing?.session)}. Regime {briefing?.marketRegime ?? "unknown"}. Levels POC{" "}
            {briefing?.levels?.poc ?? "—"} / VAH {briefing?.levels?.vah ?? "—"} / VAL {briefing?.levels?.val ?? "—"}.
            State {briefing?.currentState ?? "—"}. This summary is informational only.
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

      <p className="gm-meta">
        Risk planner and TradingView connection tools live in{" "}
        <Link to="/settings">Settings</Link>. Manual trade journaling is on{" "}
        <Link to="/journal">Journal</Link>.
      </p>
    </div>
  );
}
