import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { Decision, SetupRecord } from "../types/models";
import type { IntradayPlan } from "../types/intradayPlan";
import { cacheKeys, loadCache, saveCache } from "../lib/offlineCache";
import { describeClientError } from "../lib/errors";
import { formatSession, plainLanguageReason } from "../lib/plainLanguage";
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
import { EmptyState, PageHeader, SectionCard, Tabs } from "../components/ui/primitives";
import { MarketLevelLadder } from "../components/v5/MarketLevelLadder";
import { OvernightReviewCard } from "../components/v5/OvernightReviewCard";
import { PromoSnapshotButton } from "../components/v5/PromoSnapshotButton";
import { PromoSnapshotModal } from "../components/v5/PromoSnapshotModal";
import { IntradayHeaderCard } from "../components/intraday/IntradayHeaderCard";
import { IntradayActionCard } from "../components/intraday/IntradayActionCard";
import { ExpectedRangeCard } from "../components/intraday/ExpectedRangeCard";
import { ScenarioCards } from "../components/intraday/ScenarioCards";
import { ImportantLevelsPanel } from "../components/intraday/ImportantLevelsPanel";
import { SystemStatusCollapse } from "../components/intraday/SystemStatusCollapse";
import { ResearchMatrix } from "../components/intraday/ResearchMatrix";
import { IndicatorChips } from "../components/intraday/IndicatorChips";
import { ExplainThisPage } from "../components/intraday/ExplainThisPage";
import { CockpitAlerts } from "../components/intraday/CockpitAlerts";
import { shortActionLabel } from "../lib/cockpitHelpers";

type Briefing = {
  session?: string | null;
  marketRegime?: string | null;
  positionVsPoc?: string;
  atrLabel?: string;
  atrValue?: number | null;
  levels?: { poc?: number | null; vah?: number | null; val?: number | null };
  tradingViewAlertClose?: number | null;
  decisionClose?: number | null;
  currentState?: string;
  insufficientData?: boolean;
  dataTimestamp?: string;
  disclaimer?: string;
  explanations?: string[];
};

type Score = {
  total?: number;
  components?: Array<{ label: string; score: number; max: number; reason: string }>;
  disclaimer?: string;
};

type ResearchTab = "overview" | "structure" | "momentum" | "volume" | "history";

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
      alertClose:
        briefing?.tradingViewAlertClose ??
        decision?.ohlcv?.close ??
        decision?.lastKnownPrice ??
        null,
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

function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
      const mq = window.matchMedia("(min-width: 721px)");
      mq.addEventListener("change", onStoreChange);
      return () => mq.removeEventListener("change", onStoreChange);
    },
    () =>
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(min-width: 721px)").matches
        : true,
    () => true
  );
}

function StickyActionSummary({
  actionLabel,
  livePrice,
  trigger,
  triggerPrice
}: {
  actionLabel: string;
  livePrice: number | null;
  trigger: string | null;
  triggerPrice: number | null;
}) {
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const anchor = document.getElementById("gm-main-action-anchor");
    if (!anchor || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        setPinned(!(entry?.isIntersecting ?? true));
      },
      { root: null, threshold: 0, rootMargin: "-8px 0px 0px 0px" }
    );
    obs.observe(anchor);
    return () => obs.disconnect();
  }, [actionLabel]);

  const triggerBit =
    triggerPrice != null
      ? `Trigger ${triggerPrice.toFixed(2)}`
      : trigger
        ? trigger.slice(0, 42)
        : "No trigger";

  return (
    <div
      className={`gm-sticky-action${pinned ? " is-visible" : ""}`}
      data-testid="sticky-action-summary"
      data-pinned={pinned ? "1" : "0"}
      aria-hidden={!pinned}
    >
      <strong>
        XAUUSD | {actionLabel}
        {livePrice != null ? ` | ${livePrice.toFixed(2)}` : ""} | {triggerBit} | AutoTrade OFF
      </strong>
    </div>
  );
}

/** Compact interactive intraday research cockpit. */
export function OverviewPage() {
  const { api, user } = useAuth();
  const isDesktop = useIsDesktop();
  const [structureOpen, setStructureOpen] = useState(false);
  const [researchTab, setResearchTab] = useState<ResearchTab>("overview");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [structureDecision, setStructureDecision] = useState<Decision | null>(null);
  const [intradayPlan, setIntradayPlan] = useState<IntradayPlan | null>(null);
  const [marketStructureMode, setMarketStructureMode] = useState<
    "COMPLETE" | "LIVE_RANGE_ONLY" | "MISMATCH" | "UNAVAILABLE" | null
  >(null);
  const [marketStructureDiagnostics, setMarketStructureDiagnostics] = useState<Record<
    string,
    unknown
  > | null>(null);
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
  const [lastLoadSuccessAt, setLastLoadSuccessAt] = useState<string | null>(null);
  const [previousPrice, setPreviousPrice] = useState<number | null>(null);
  const tzPref = loadTimezonePreference();

  const load = useCallback(async () => {
    setErrorDetail(null);
    try {
      const [pack, active, recentSetups, overnight, b, s] = await Promise.all([
        api.latestDecisionPack(),
        api.listActiveSetups().catch(() => [] as SetupRecord[]),
        api.listSetups(6, "LIVE").catch(() => [] as SetupRecord[]),
        api.listSetups(20, "LIVE").catch(() => [] as SetupRecord[]),
        api.v5Briefing("LIVE").catch(() => null),
        api.v5Score("LIVE").catch(() => null)
      ]);
      const latest = pack?.decision ?? null;
      const complete = pack?.latestCompleteStrategySignal ?? null;
      setDecision((prev) => {
        const nextPrice = latest?.lastKnownPrice ?? latest?.ohlcv?.close ?? null;
        const prevPrice = prev?.lastKnownPrice ?? prev?.ohlcv?.close ?? null;
        if (prevPrice != null && nextPrice != null && prevPrice !== nextPrice) {
          setPreviousPrice(prevPrice);
        }
        return latest;
      });
      setStructureDecision(complete);
      setIntradayPlan((pack?.intradayPlan as IntradayPlan | null | undefined) ?? null);
      setMarketStructureMode(pack?.marketStructureMode ?? null);
      setMarketStructureDiagnostics(
        (pack?.marketStructureDiagnostics as Record<string, unknown> | null | undefined) ?? null
      );
      setRecent(recentSetups.slice(0, 3));
      setOvernightSetups(overnight);
      setBriefing(b as Briefing | null);
      setScore(s as Score | null);
      setSource("live");
      setCachedAt(null);
      if (latest) {
        saveCache(cacheKeys.decision, latest);
        const structureId = pack?.structureDecisionId ?? complete?.decisionId ?? latest.decisionId;
        setSetup(
          active.find((x) => x.decisionId === structureId) ??
            active.find((x) => x.decisionId === latest.decisionId) ??
            active[0] ??
            null
        );
      } else {
        setSetup(active[0] ?? null);
      }
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
  const structure = structureDecision ?? decision;
  const planEntry = structure?.entry?.price ?? setup?.levels?.entryPrice ?? null;
  const planStop = structure?.stopLoss?.price ?? setup?.levels?.stopLoss ?? null;
  const planTp1 =
    structure?.takeProfits?.find((t) => t.label === "TP1")?.price ?? setup?.levels?.tp1 ?? null;
  const planTp2 =
    structure?.takeProfits?.find((t) => t.label === "TP2")?.price ?? setup?.levels?.tp2 ?? null;
  const planTp3 =
    structure?.takeProfits?.find((t) => t.label === "TP3")?.price ?? setup?.levels?.tp3 ?? null;

  const stampIso = decision?.generatedAt ?? briefing?.dataTimestamp ?? cachedAt;
  const localTs = formatLocalTimestamp(stampIso, tzPref);
  const compactTime = formatCompactLocalTime(stampIso, tzPref);

  const freshness =
    source === "offline"
      ? `Offline · last stored ${compactTime}`
      : source === "cached"
        ? `Cached · ${compactTime}`
        : `Updated ${compactTime} local time`;

  const sessionLabel = formatSession(
    intradayPlan?.session ?? briefing?.session ?? decision?.currentSession
  );
  const livePrice = decision?.lastKnownPrice ?? decision?.ohlcv?.close ?? null;
  const liveRangeOnly = marketStructureMode === "LIVE_RANGE_ONLY";
  const poc = liveRangeOnly
    ? null
    : structure?.marketStructure?.poc ?? briefing?.levels?.poc ?? null;
  const vah = liveRangeOnly
    ? null
    : structure?.marketStructure?.vah ?? briefing?.levels?.vah ?? null;
  const val = liveRangeOnly
    ? null
    : structure?.marketStructure?.val ?? briefing?.levels?.val ?? null;
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

  const upsideLevels =
    intradayPlan?.importantLevels.filter((l) => l.side === "UPSIDE") ?? [];
  const downsideLevels =
    intradayPlan?.importantLevels.filter((l) => l.side === "DOWNSIDE") ?? [];
  const orderedLevels = [...upsideLevels, ...downsideLevels];
  const shortAction = intradayPlan
    ? shortActionLabel(intradayPlan.action, intradayPlan.actionLabel)
    : "—";

  const tabItems = [
    { id: "overview", label: "Overview" },
    { id: "structure", label: "Structure" },
    { id: "momentum", label: "Momentum" },
    { id: "volume", label: "Volume" },
    { id: "history", label: "History" }
  ];

  return (
    <div data-testid="overview-page" className="gm-dashboard gm-cockpit">
      <div
        className="gm-page-header-row"
        style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <PageHeader title="GoldMeta" freshness={freshness} />
        </div>
        <ExplainThisPage />
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

      <CockpitAlerts
        marketStructureMode={marketStructureMode}
        loading={loading && !intradayPlan}
        signedOut={!user && !loading}
        apiError={Boolean(errorDetail) && !intradayPlan}
      />

      {intradayPlan ? (
        <div className="gm-cockpit-main" data-testid="cockpit-main">
          <StickyActionSummary
            actionLabel={shortAction}
            livePrice={livePrice}
            trigger={intradayPlan.trigger}
            triggerPrice={intradayPlan.triggerPrice}
          />
          <IntradayHeaderCard
            plan={intradayPlan}
            livePrice={livePrice}
            previousPrice={previousPrice}
            sessionLabel={sessionLabel}
            freshness={freshness}
            source={source}
            marketStructureMode={marketStructureMode}
            compactTime={compactTime}
          />
          <div data-testid="main-action-sentinel" id="gm-main-action-anchor">
            <IntradayActionCard plan={intradayPlan} />
          </div>

          <Tabs
            items={tabItems}
            value={researchTab}
            onChange={(id) => setResearchTab(id as ResearchTab)}
          />

          {researchTab === "overview" && (
            <div className="gm-cockpit-tab" data-testid="research-tab-overview">
              <ExpectedRangeCard range={intradayPlan.expectedRange} />
              <ScenarioCards
                plan={intradayPlan}
                bullish={intradayPlan.bullishScenario}
                bearish={intradayPlan.bearishScenario}
              />
              <ResearchMatrix
                plan={intradayPlan}
                decision={structureDecision ?? decision}
                scoreComponents={score?.components}
              />
              <ImportantLevelsPanel
                levels={orderedLevels}
                allLevels={intradayPlan.importantLevels}
                compactDefault
              />
              <IndicatorChips
                plan={intradayPlan}
                decision={structureDecision ?? decision}
                poc={poc}
                vah={vah}
                val={val}
                atrLabel={briefing?.atrLabel}
                atrValue={briefing?.atrValue}
                scoreComponents={score?.components}
              />
            </div>
          )}

          {researchTab === "structure" && (
            <div className="gm-cockpit-tab" data-testid="research-tab-structure">
              <IndicatorChips
                plan={intradayPlan}
                decision={structureDecision ?? decision}
                poc={poc}
                vah={vah}
                val={val}
                atrLabel={briefing?.atrLabel}
                atrValue={briefing?.atrValue}
                scoreComponents={score?.components}
              />
              <ImportantLevelsPanel
                levels={orderedLevels}
                allLevels={intradayPlan.importantLevels}
              />
              <details
                className="gm-structure-collapse"
                data-testid="market-structure-collapse"
                open={structureOpen || isDesktop}
                onToggle={(e) => setStructureOpen((e.currentTarget as HTMLDetailsElement).open)}
              >
                <summary>Market Structure Map</summary>
                <div className="gm-structure-collapse-body">
                  <MarketLevelLadder
                    input={{
                      livePrice,
                      alertClose:
                        briefing?.tradingViewAlertClose ??
                        structure?.ohlcv?.close ??
                        decision?.ohlcv?.close ??
                        decision?.lastKnownPrice ??
                        null,
                      poc,
                      vah,
                      val,
                      barHigh: decision?.ohlcv?.high ?? null,
                      barLow: decision?.ohlcv?.low ?? null,
                      entry: liveRangeOnly ? null : planEntry,
                      stop: liveRangeOnly ? null : planStop,
                      tp1: liveRangeOnly ? null : planTp1,
                      tp2: liveRangeOnly ? null : planTp2,
                      tp3: liveRangeOnly ? null : planTp3,
                      dataSourceLabel: decision?.dataSourceLabel ?? null,
                      isTestDecision: decision?.isTestDecision ?? null,
                      marketDataTime: decision?.marketDataTime ?? decision?.generatedAt ?? null,
                      brokerQuoteVerified:
                        decision?.dataSourceLabel === "LIVE" && !decision?.isTestDecision,
                      marketStatus: "UNKNOWN",
                      liveRangeOnly,
                      priceSource: decision?.isTestDecision
                        ? "TEST_FIXTURE"
                        : decision?.symbolIdentity?.exchange ??
                          decision?.dataSourceLabel ??
                          "DECISION"
                    }}
                    dataTimestamp={stampIso}
                    mode={marketStructureMode}
                    diagnostics={marketStructureDiagnostics}
                  />
                </div>
              </details>
            </div>
          )}

          {researchTab === "momentum" && (
            <div className="gm-cockpit-tab" data-testid="research-tab-momentum">
              <ResearchMatrix
                plan={intradayPlan}
                decision={structureDecision ?? decision}
                scoreComponents={score?.components}
              />
              <IndicatorChips
                plan={intradayPlan}
                decision={structureDecision ?? decision}
                poc={poc}
                vah={vah}
                val={val}
                atrLabel={briefing?.atrLabel}
                atrValue={briefing?.atrValue}
                scoreComponents={score?.components}
              />
              <SectionCard title="Momentum notes">
                <p className="gm-meta" style={{ margin: 0 }}>
                  RSI, ADX, EMA and VWAP chips appear only when verified in structure reasons or score
                  text. Missing values stay unavailable — GoldMeta does not invent them.
                </p>
              </SectionCard>
            </div>
          )}

          {researchTab === "volume" && (
            <div className="gm-cockpit-tab" data-testid="research-tab-volume">
              <SectionCard title="Volume research">
                <p style={{ margin: 0, color: "var(--text-secondary)" }}>
                  Session {sessionLabel}. Regime {briefing?.marketRegime ?? "unknown"}. Position vs
                  POC {briefing?.positionVsPoc?.replace(/_/g, " ") ?? "—"}. ATR{" "}
                  {briefing?.atrLabel ?? "—"}.
                </p>
                <p className="gm-meta">{briefing?.disclaimer}</p>
              </SectionCard>
              <IndicatorChips
                plan={intradayPlan}
                decision={structureDecision ?? decision}
                poc={poc}
                vah={vah}
                val={val}
                atrLabel={briefing?.atrLabel}
                atrValue={briefing?.atrValue}
                scoreComponents={score?.components}
              />
            </div>
          )}

          {researchTab === "history" && (
            <div className="gm-cockpit-tab" data-testid="research-tab-history">
              <OvernightReviewCard review={overnight} />
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
                        <div className="gm-meta">
                          {formatLocalTimestamp(s.createdAt, tzPref).primary}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </div>
          )}
        </div>
      ) : (
        !loading && (
          <SectionCard title="What should I do?">
            <EmptyState title="No intraday plan yet." />
            <p className="gm-meta">
              Waiting for a verified TradingView strategy alert. Manual trading only — AutoTrade stays
              OFF.
            </p>
          </SectionCard>
        )
      )}

      {!intradayPlan && (
        <details
          className="gm-structure-collapse"
          data-testid="market-structure-collapse"
          open={structureOpen}
          onToggle={(e) => setStructureOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>Market Structure Map</summary>
          <div className="gm-structure-collapse-body">
            <MarketLevelLadder
              input={{
                livePrice,
                alertClose:
                  briefing?.tradingViewAlertClose ??
                  structure?.ohlcv?.close ??
                  decision?.ohlcv?.close ??
                  decision?.lastKnownPrice ??
                  null,
                poc,
                vah,
                val,
                barHigh: decision?.ohlcv?.high ?? null,
                barLow: decision?.ohlcv?.low ?? null,
                entry: liveRangeOnly ? null : planEntry,
                stop: liveRangeOnly ? null : planStop,
                tp1: liveRangeOnly ? null : planTp1,
                tp2: liveRangeOnly ? null : planTp2,
                tp3: liveRangeOnly ? null : planTp3,
                dataSourceLabel: decision?.dataSourceLabel ?? null,
                isTestDecision: decision?.isTestDecision ?? null,
                marketDataTime: decision?.marketDataTime ?? decision?.generatedAt ?? null,
                brokerQuoteVerified:
                  decision?.dataSourceLabel === "LIVE" && !decision?.isTestDecision,
                marketStatus: "UNKNOWN",
                liveRangeOnly,
                priceSource: decision?.isTestDecision
                  ? "TEST_FIXTURE"
                  : decision?.symbolIdentity?.exchange ?? decision?.dataSourceLabel ?? "DECISION"
              }}
              dataTimestamp={stampIso}
              mode={marketStructureMode}
              diagnostics={marketStructureDiagnostics}
            />
          </div>
        </details>
      )}

      <div className="gm-snapshot-actions-row">
        <PromoSnapshotButton onClick={snapshot.openModal} disabled={!decision && !briefing} />
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

      <SystemStatusCollapse
        plan={intradayPlan}
        score={score}
        marketStructureMode={marketStructureMode}
        diagnostics={marketStructureDiagnostics}
        decisionId={decision?.decisionId}
      >
        <p className="gm-meta" data-testid="system-status-reasons">
          Legacy decision code: {decisionCode}. Reasons:{" "}
          {plainLanguageReason(
            decision?.reasonCodes ??
              (Array.isArray(decision?.reasonSummary) ? decision.reasonSummary : undefined),
            undefined
          )}
          <br />
          Raw codes: {(decision?.reasonCodes ?? []).join(", ") || "none"}
        </p>
        <div className="gm-trading-status-row" data-testid="dashboard-safety">
          <span className="gm-badge warning">Trading locked</span>
          <span className="gm-badge neutral" data-testid="dashboard-autotrade-off">
            AutoTrade OFF
          </span>
          <span className="gm-badge negative" data-testid="dashboard-emergency-stop">
            Emergency STOP ready
          </span>
        </div>
      </SystemStatusCollapse>

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
          Manual sizing aid only. GoldMeta never places broker orders.{" "}
          <Link to="/help">First-use guide</Link>
        </p>
      </SectionCard>
    </div>
  );
}
