import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { Decision, SetupRecord } from "../types/models";
import { cacheKeys, loadCache, saveCache } from "../lib/offlineCache";
import { describeClientError } from "../lib/errors";
import { formatSession, humanDecisionState, plainLanguageReason } from "../lib/plainLanguage";
import { FriendlyErrorBanner } from "../components/FriendlyErrorBanner";
import {
  formatCompactLocalTime,
  formatLocalTimestamp,
  loadTimezonePreference,
  type FormattedTimestamp
} from "../lib/timezone";
import { buildOvernightReview } from "../lib/overnight";
import type { BuildSnapshotInput } from "../lib/promoSnapshot";
import { usePromoSnapshot } from "../hooks/usePromoSnapshot";
import { useDashboardDecisionPoll } from "../lib/useDashboardDecisionPoll";
import { EmptyState, PageHeader, SectionCard } from "../components/ui/primitives";
import { PrimarySignalCard } from "../components/v5/PrimarySignalCard";
import { MarketLevelLadder } from "../components/v5/MarketLevelLadder";
import { ScoreBreakdown } from "../components/v5/ScoreBreakdown";
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
      alertClose: decision?.ohlcv?.close ?? decision?.lastKnownPrice ?? null,
      poc: args.poc,
      vah: args.vah,
      val: args.val,
      barHigh: decision?.ohlcv?.high ?? null,
      barLow: decision?.ohlcv?.low ?? null,
      dataSourceLabel: decision?.dataSourceLabel ?? null,
      isTestDecision: decision?.isTestDecision ?? null,
      marketDataTime: decision?.marketDataTime ?? decision?.generatedAt ?? null,
      isUiReviewFixture: true
    },
    plan: args.setup,
    scoreComponents: args.score?.components
  };
}

/** V5.4.1 Dashboard — compact mobile, local time, ladder, semantic score + snapshot. */
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
  const [errorDetail, setErrorDetail] = useState<ReturnType<typeof describeClientError> | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** Set on successful load (including empty/404 decision) so Last refresh is never stuck on pending. */
  const [lastLoadSuccessAt, setLastLoadSuccessAt] = useState<string | null>(null);
  const tzPref = loadTimezonePreference();

  const load = useCallback(async () => {
    setErrorDetail(null);
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
      // Empty decision (404→null) still counts as a completed refresh.
      setLastLoadSuccessAt(new Date().toISOString());
    } catch (err) {
      const cached = loadCache<Decision>(cacheKeys.decision);
      if (cached) {
        setDecision(cached.value);
        setSource(navigator.onLine ? "cached" : "offline");
        setCachedAt(cached.savedAt);
      }
      setErrorDetail(describeClientError(err, "Unable to load market state"));
      throw err;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const pollTick = useCallback(async () => {
    await load();
  }, [load]);

  const { lastSuccessAt: lastPollSuccessAt, pollError } = useDashboardDecisionPoll({
    enabled: !loading,
    intervalMs: 30_000,
    onTick: pollTick
  });

  const lastSuccessAt = lastPollSuccessAt ?? lastLoadSuccessAt;

  const refresh = () => {
    setRefreshing(true);
    void load().catch(() => undefined);
  };

  const decisionCode = decision?.decision ?? "WAIT";
  const reason = plainLanguageReason(
    decision?.reasonCodes ??
      (Array.isArray(decision?.reasonSummary) ? decision.reasonSummary : undefined),
    undefined
  );
  const confidence =
    typeof decision?.confidence === "number"
      ? decision.confidence
      : typeof score?.total === "number"
        ? score.total
        : null;
  const planEntry = decision?.entry?.price ?? setup?.levels?.entryPrice ?? null;
  const planStop = decision?.stopLoss?.price ?? setup?.levels?.stopLoss ?? null;
  const planTp1 =
    decision?.takeProfits?.find((t) => t.label === "TP1")?.price ?? setup?.levels?.tp1 ?? null;
  const planTp2 =
    decision?.takeProfits?.find((t) => t.label === "TP2")?.price ?? setup?.levels?.tp2 ?? null;
  const planTp3 =
    decision?.takeProfits?.find((t) => t.label === "TP3")?.price ?? setup?.levels?.tp3 ?? null;
  const estimatedRisk =
    planEntry != null && planStop != null
      ? `About ${Math.abs(planEntry - planStop).toFixed(2)} points to stop (not guaranteed)`
      : "Not available — open Risk planner to size a position";

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
  // Prefer same-source decision OHLC + structure. Briefing levels are only used when
  // they agree with the decision close (server also omits mismatched V4 levels).
  const livePrice = decision?.lastKnownPrice ?? decision?.ohlcv?.close ?? null;
  const poc = briefing?.levels?.poc ?? decision?.marketStructure?.poc ?? null;
  const vah = briefing?.levels?.vah ?? decision?.marketStructure?.vah ?? null;
  const val = briefing?.levels?.val ?? decision?.marketStructure?.val ?? null;
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
    <div data-testid="overview-page" className="gm-dashboard">
      <div className="gm-page-header-row" style={{ display: "flex", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <PageHeader title="Dashboard" freshness={freshness} />
        </div>
        <button
          type="button"
          className="gm-btn-outline"
          data-testid="dashboard-refresh"
          onClick={refresh}
          disabled={refreshing || loading}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <p className="gm-meta" data-testid="dashboard-last-refresh" style={{ marginTop: 0 }}>
        Last refresh:{" "}
        {lastSuccessAt
          ? formatCompactLocalTime(lastSuccessAt, tzPref)
          : loading
            ? "…"
            : "pending"}
      </p>

      {errorDetail && (
        <FriendlyErrorBanner detail={errorDetail} onRetry={refresh} testId="dashboard-error" />
      )}
      {pollError && (
        <div className="banner stale" role="status" data-testid="dashboard-poll-stale">
          Live refresh is temporarily unavailable. Showing the last loaded decision — use Refresh to
          retry.
        </div>
      )}
      {(source === "cached" || source === "offline") && (
        <div className="banner stale" role="status" data-testid="stale-data-warning">
          Showing stored data{cachedAt ? ` from ${formatCompactLocalTime(cachedAt, tzPref)}` : ""}.
          Tap Refresh when you are back online.
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
        confidence={confidence}
        marketTrend={briefing?.marketRegime ?? decision?.marketRegime ?? decision?.marketStructure?.trend}
        localPrimary={localTs.primary}
        localZone={localTs.timeZone}
        utcSecondary={localTs.secondaryUtc}
        poc={poc}
        vah={vah}
        val={val}
        setup={setup}
        entry={planEntry}
        stopLoss={planStop}
        tp1={planTp1}
        tp2={planTp2}
        tp3={planTp3}
        estimatedRisk={estimatedRisk}
        source={source}
        technicalId={decision?.decisionId}
        reasonCodes={decision?.reasonCodes}
        brokerConnected={false}
        autoTradeOff
      />

      <SectionCard title="Safety">
        <div className="gm-trading-status-row" data-testid="dashboard-safety">
          <span className="gm-badge warning">Trading locked</span>
          <span className="gm-badge neutral" data-testid="dashboard-autotrade-off">
            AutoTrade OFF
          </span>
          <span className="gm-badge negative" data-testid="dashboard-emergency-stop">
            Emergency STOP ready
          </span>
        </div>
        <p className="gm-meta" style={{ marginBottom: 0 }}>
          Broker execution stays disabled.{" "}
          <Link to="/help">Open the first-use guide</Link> ·{" "}
          <Link to="/brokers">Broker setup</Link>
        </p>
      </SectionCard>

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

      <SectionCard title="Market Structure Map">
        <MarketLevelLadder
          input={{
            livePrice,
            alertClose: decision?.ohlcv?.close ?? decision?.lastKnownPrice ?? null,
            poc,
            vah,
            val,
            barHigh: decision?.ohlcv?.high ?? null,
            barLow: decision?.ohlcv?.low ?? null,
            entry: setup?.levels?.entryPrice ?? null,
            stop: setup?.levels?.stopLoss ?? null,
            tp1: setup?.levels?.tp1 ?? null,
            tp2: setup?.levels?.tp2 ?? null,
            tp3: setup?.levels?.tp3 ?? null,
            dataSourceLabel: decision?.dataSourceLabel ?? null,
            isTestDecision: decision?.isTestDecision ?? null,
            marketDataTime: decision?.marketDataTime ?? decision?.generatedAt ?? null,
            // LIVE label only when decision is verified LIVE and not a test fixture.
            brokerQuoteVerified:
              decision?.dataSourceLabel === "LIVE" && !decision?.isTestDecision,
            marketStatus: "UNKNOWN",
            priceSource: decision?.isTestDecision
              ? "TEST_FIXTURE"
              : decision?.symbolIdentity?.exchange ??
                decision?.dataSourceLabel ??
                "DECISION"
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
