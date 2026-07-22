import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { Decision, SetupRecord } from "../types/models";
import { cacheKeys, loadCache, saveCache } from "../lib/offlineCache";
import { formatClientError } from "../lib/errors";
import { formatSession, humanDecisionState, plainLanguageReason } from "../lib/plainLanguage";
import {
  formatCompactLocalTime,
  formatLocalTimestamp,
  loadTimezonePreference
} from "../lib/timezone";
import { buildOvernightReview } from "../lib/overnight";
import { EmptyState, PageHeader, SectionCard } from "../components/ui/primitives";
import { PrimarySignalCard } from "../components/v5/PrimarySignalCard";
import { MarketLevelLadder } from "../components/v5/MarketLevelLadder";
import { ScoreBreakdown } from "../components/v5/ScoreBreakdown";
import { OvernightReviewCard } from "../components/v5/OvernightReviewCard";

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

/** V5.4.1 Dashboard — compact mobile, local time, ladder, semantic score. */
export function OverviewPage() {
  const { api } = useAuth();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [setup, setSetup] = useState<SetupRecord | null>(null);
  const [recent, setRecent] = useState<SetupRecord[]>([]);
  const [overnightSetups, setOvernightSetups] = useState<SetupRecord[]>([]);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [score, setScore] = useState<Score | null>(null);
  const [source, setSource] = useState<"live" | "cached" | "offline">("live");
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const tzPref = loadTimezonePreference();

  const load = useCallback(async () => {
    setError(null);
    try {
      const [latest, active, recentSetups, overnight, b, s] = await Promise.all([
        api.latestDecision(),
        api.listActiveSetups().catch(() => [] as SetupRecord[]),
        api.listSetups(6, "LIVE").catch(() => [] as SetupRecord[]),
        api.listSetups(20, "LIVE").catch(() => [] as SetupRecord[]),
        api.v5Briefing("LIVE").catch(() => null),
        api.v5Score("LIVE").catch(() => null)
      ]);
      setDecision(latest);
      setRecent(recentSetups.slice(0, 3));
      setOvernightSetups(overnight);
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

  const stampIso = decision?.generatedAt ?? briefing?.dataTimestamp ?? cachedAt;
  const localTs = formatLocalTimestamp(stampIso, tzPref);
  const compactTime = formatCompactLocalTime(stampIso, tzPref);

  const freshness =
    source === "offline"
      ? `Offline · last stored ${compactTime}`
      : source === "cached"
        ? `Cached · ${compactTime}`
        : `Updated ${compactTime} local time`;

  const sessionLabel = formatSession(briefing?.session ?? decision?.currentSession);
  const poc = briefing?.levels?.poc ?? decision?.marketStructure?.poc ?? null;
  const vah = briefing?.levels?.vah ?? decision?.marketStructure?.vah ?? null;
  const val = briefing?.levels?.val ?? decision?.marketStructure?.val ?? null;

  const overnight = buildOvernightReview(overnightSetups, new Date(), localTs.timeZone);

  return (
    <div data-testid="overview-page" className="gm-dashboard">
      <PageHeader title="Dashboard" freshness={freshness} />

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

      {/* Compact 2×2 summary — no email, no duplicate LIVE */}
      <div className="gm-dash-summary" data-testid="dashboard-summary">
        <div className="gm-dash-cell">
          <span className="gm-label">XAUUSD</span>
          <strong data-testid="summary-decision">{humanDecisionState(decisionCode)}</strong>
        </div>
        <div className="gm-dash-cell">
          <span className="gm-label">Score</span>
          <strong>{score?.total != null ? `${score.total} / 100` : "—"}</strong>
        </div>
        <div className="gm-dash-cell">
          <span className="gm-label">Session</span>
          <strong>{sessionLabel}</strong>
        </div>
        <div className="gm-dash-cell">
          <span className="gm-label">Your time</span>
          <strong>{compactTime}</strong>
          <span className="gm-meta">{localTs.timeZone}</span>
        </div>
      </div>

      <PrimarySignalCard
        decisionCode={decisionCode}
        sessionLabel={sessionLabel}
        reason={reason}
        scoreTotal={score?.total}
        localPrimary={localTs.primary}
        localZone={localTs.timeZone}
        utcSecondary={localTs.secondaryUtc}
        poc={poc}
        vah={vah}
        val={val}
        setup={setup}
        source={source}
        technicalId={decision?.decisionId}
        reasonCodes={decision?.reasonCodes}
      />

      <SectionCard title="Market Structure Map">
        <MarketLevelLadder
          input={{
            livePrice: decision?.lastKnownPrice ?? decision?.ohlcv?.close ?? null,
            poc,
            vah,
            val,
            barHigh: decision?.ohlcv?.high ?? null,
            barLow: decision?.ohlcv?.low ?? null,
            entry: setup?.levels?.entryPrice ?? null,
            stop: setup?.levels?.stopLoss ?? null,
            tp1: setup?.levels?.tp1 ?? null,
            tp2: setup?.levels?.tp2 ?? null,
            tp3: setup?.levels?.tp3 ?? null
          }}
          dataTimestamp={stampIso}
        />
      </SectionCard>

      <SectionCard title="Setup readiness">
        <ScoreBreakdown
          total={score?.total}
          components={score?.components}
          disclaimer={score?.disclaimer}
          compact
        />
      </SectionCard>

      <OvernightReviewCard review={overnight} />

      <div className="gm-two-col">
        <SectionCard title="Market briefing">
          {briefing?.insufficientData ? (
            <EmptyState title="Insufficient verified data for a full briefing." />
          ) : (
            <p style={{ margin: 0, maxWidth: 720, color: "var(--text-secondary)" }}>
              Session {sessionLabel}. Regime {briefing?.marketRegime ?? "unknown"}. Position vs POC{" "}
              {briefing?.positionVsPoc?.replace(/_/g, " ") ?? "—"}. ATR {briefing?.atrLabel ?? "—"}.
              This summary is informational only.
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
                  <div className="gm-meta">{formatLocalTimestamp(s.createdAt, tzPref).primary}</div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Risk planner"
        action={
          <Link
            className="gm-btn-outline"
            to="/planner"
            style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
          >
            Open planner
          </Link>
        }
      >
        <p className="gm-meta" style={{ margin: 0 }}>
          Manual sizing aid only. GoldMeta never places broker orders.
        </p>
      </SectionCard>
    </div>
  );
}
