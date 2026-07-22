import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { Decision, SetupRecord } from "../types/models";
import { cacheKeys, loadCache, saveCache } from "../lib/offlineCache";
import { formatClientError } from "../lib/errors";
import { formatSession, plainLanguageReason } from "../lib/plainLanguage";
import {
  formatCompactLocalTime,
  formatLocalTimestamp,
  loadTimezonePreference,
  type FormattedTimestamp
} from "../lib/timezone";
import { buildOvernightReview } from "../lib/overnight";
import type { BuildSnapshotInput } from "../lib/promoSnapshot";
import { usePromoSnapshot } from "../hooks/usePromoSnapshot";
import { EmptyState, PageHeader, SectionCard } from "../components/ui/primitives";
import { PrimarySignalCard } from "../components/v5/PrimarySignalCard";
import { MarketStoryCard } from "../components/v5/MarketStoryCard";
import { MarketLevelLadder } from "../components/v5/MarketLevelLadder";
import { ScoreBreakdown } from "../components/v5/ScoreBreakdown";
import { CurrentPlanCard } from "../components/v5/CurrentPlanCard";
import { OvernightReviewCard } from "../components/v5/OvernightReviewCard";
import { PromoSnapshotButton } from "../components/v5/PromoSnapshotButton";
import { PromoSnapshotModal } from "../components/v5/PromoSnapshotModal";

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

function buildSnapshotFromPage(args: {
  decision: Decision | null;
  briefing: Briefing | null;
  decisionCode: string;
  score: Score | null;
  livePrice: number | null;
  sessionLabel: string;
  compactTime: string;
  localTs: FormattedTimestamp;
  poc: number | null;
  vah: number | null;
  val: number | null;
  hasPlan: boolean;
  setup: SetupRecord | null;
}): BuildSnapshotInput | null {
  const { decision, briefing } = args;
  if (!decision && !briefing) return null;
  return {
    decision: args.decisionCode,
    scoreTotal: args.score?.total ?? null,
    livePrice: args.livePrice,
    sessionLabel: args.sessionLabel,
    compactTime: args.compactTime,
    timeZone: args.localTs.timeZone,
    utcSecondary: args.localTs.secondaryUtc,
    storyInput: {
      decision: args.decisionCode,
      session: briefing?.session ?? decision?.currentSession,
      regime: briefing?.marketRegime ?? decision?.marketRegime,
      positionVsPoc: briefing?.positionVsPoc,
      atrLabel: briefing?.atrLabel,
      poc: args.poc,
      vah: args.vah,
      val: args.val,
      livePrice: args.livePrice,
      reasonCodes: decision?.reasonCodes,
      hasValidatedPlan: args.hasPlan,
      insufficientData: Boolean(briefing?.insufficientData) && !decision,
      components: args.score?.components
    },
    ladder: {
      livePrice: args.livePrice,
      poc: args.poc,
      vah: args.vah,
      val: args.val,
      barHigh: decision?.ohlcv?.high ?? null,
      barLow: decision?.ohlcv?.low ?? null
    },
    plan: args.setup,
    scoreComponents: args.score?.components
  };
}

/** V5.4.3 Dashboard — Primary Signal first + promotional Market Snapshot. */
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
      ? `Offline · ${compactTime}`
      : source === "cached"
        ? `Cached · ${compactTime}`
        : `Updated ${compactTime}`;

  const sessionLabel = formatSession(briefing?.session ?? decision?.currentSession);
  const poc = briefing?.levels?.poc ?? decision?.marketStructure?.poc ?? null;
  const vah = briefing?.levels?.vah ?? decision?.marketStructure?.vah ?? null;
  const val = briefing?.levels?.val ?? decision?.marketStructure?.val ?? null;
  const livePrice = decision?.lastKnownPrice ?? decision?.ohlcv?.close ?? null;
  const hasPlan = Boolean(
    setup &&
      (setup.levels?.entryPrice != null ||
        setup.levels?.stopLoss != null ||
        setup.levels?.tp1 != null)
  );

  const overnight = buildOvernightReview(overnightSetups, new Date(), localTs.timeZone);

  const snapshotInputRef = useRef<() => BuildSnapshotInput | null>(() => null);
  useEffect(() => {
    snapshotInputRef.current = () =>
      buildSnapshotFromPage({
        decision,
        briefing,
        decisionCode,
        score,
        livePrice,
        sessionLabel,
        compactTime,
        localTs,
        poc,
        vah,
        val,
        hasPlan,
        setup
      });
  });

  const buildSnapshotInput = useCallback(() => snapshotInputRef.current(), []);

  const snapshot = usePromoSnapshot(buildSnapshotInput);

  return (
    <div data-testid="overview-page" className="gm-dashboard gm-dashboard--v542">
      <PageHeader title="Dashboard" freshness={freshness} />

      {error && (
        <div className="banner error gm-state-card" role="alert" data-testid="dashboard-error">
          <strong>Could not refresh market state.</strong>
          <p className="gm-meta">{error}</p>
          <button type="button" className="gm-btn-outline" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      {loading && (
        <div className="gm-skeleton-stack" data-testid="dashboard-loading" aria-busy="true">
          <div className="gm-skeleton gm-skeleton--hero" />
          <div className="gm-skeleton" />
          <div className="gm-skeleton" />
        </div>
      )}

      {!loading && !decision && !error && (
        <div className="gm-empty gm-state-card" role="status" data-testid="dashboard-empty">
          <strong>No market data yet.</strong>
          <p className="gm-meta">Connect TradingView alerts or wait for the next verified snapshot.</p>
        </div>
      )}

      {/* 1. Primary Signal */}
      {!loading && (
        <>
          <PrimarySignalCard
            decisionCode={decisionCode}
            sessionLabel={sessionLabel}
            reason={reason}
            scoreTotal={score?.total}
            compactTime={compactTime}
            timeZone={localTs.timeZone}
            utcSecondary={localTs.secondaryUtc}
            livePrice={livePrice}
            setup={setup}
            source={source}
            technicalId={decision?.decisionId}
            reasonCodes={decision?.reasonCodes}
          />
          <div className="gm-snapshot-actions-row">
            <PromoSnapshotButton
              onClick={snapshot.openModal}
              disabled={!decision && !briefing}
            />
          </div>
          <PromoSnapshotModal
            open={snapshot.open}
            onClose={snapshot.closeModal}
            options={snapshot.options}
            onOptionsChange={snapshot.updateOptions}
            status={snapshot.status}
            statusMessage={snapshot.statusMessage}
            previewUrl={snapshot.previewUrl}
            generating={snapshot.generating}
            onShare={() => void snapshot.share()}
            onDownload={snapshot.download}
          />
        </>
      )}

      {/* 2. Market Story */}
      {!loading && (
        <MarketStoryCard
          decision={decisionCode}
          session={briefing?.session ?? decision?.currentSession}
          regime={briefing?.marketRegime ?? decision?.marketRegime}
          positionVsPoc={briefing?.positionVsPoc}
          atrLabel={briefing?.atrLabel}
          poc={poc}
          vah={vah}
          val={val}
          livePrice={livePrice}
          reasonCodes={decision?.reasonCodes}
          hasValidatedPlan={hasPlan}
          insufficientData={Boolean(briefing?.insufficientData) && !decision}
          components={score?.components}
        />
      )}

      {/* 3 + 4 desktop grid: Map + Setup readiness */}
      <div className="gm-dash-grid">
        <SectionCard title="Market Structure Map" className="gm-dash-map">
          <MarketLevelLadder
            input={{
              livePrice,
              poc,
              vah,
              val,
              barHigh: decision?.ohlcv?.high ?? null,
              barLow: decision?.ohlcv?.low ?? null
            }}
            dataTimestamp={stampIso}
          />
        </SectionCard>

        <SectionCard title="Setup readiness" className="gm-dash-score">
          <ScoreBreakdown
            total={score?.total}
            components={score?.components}
            disclaimer={score?.disclaimer}
          />
        </SectionCard>
      </div>

      {/* 5. Current Plan */}
      {!loading && <CurrentPlanCard setup={setup} />}

      {/* 6. Overnight Review (only when relevant) */}
      <OvernightReviewCard review={overnight} />

      {/* 7. Recent Activity */}
      <SectionCard
        title="Recent activity"
        action={
          <Link className="gm-linkish" to="/history">
            View history
          </Link>
        }
      >
        {recent.length === 0 ? (
          <EmptyState title="No recent setups yet." body="Shadow setups will appear here when created." />
        ) : (
          <ul className="list">
            {recent.map((s) => (
              <li key={s.setupId}>
                <Link to={`/setups/${s.setupId}`}>
                  {s.direction ?? "—"} · {String(s.status).replace(/_/g, " ")}
                </Link>
                <div className="gm-meta">{formatCompactLocalTime(s.createdAt, tzPref)}</div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
