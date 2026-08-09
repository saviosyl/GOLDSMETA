import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { Decision, MarketFeedHealth, SetupRecord } from "../types/models";
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
import { EmptyState, PageHeader, SectionCard } from "../components/ui/primitives";
import { MarketLevelLadder } from "../components/v5/MarketLevelLadder";
import { OvernightReviewCard } from "../components/v5/OvernightReviewCard";
import { PromoSnapshotButton } from "../components/v5/PromoSnapshotButton";
import { PromoSnapshotModal } from "../components/v5/PromoSnapshotModal";
import { SetupChecklist } from "../components/intraday/SetupChecklist";
import { Confirmation5MCard } from "../components/intraday/Confirmation5MCard";
import { TimeframeAlignmentPanel } from "../components/intraday/TimeframeAlignmentPanel";
import { ExpectedRangeCard } from "../components/intraday/ExpectedRangeCard";
import { NextDecisionStrip } from "../components/intraday/NextDecisionStrip";
import { AlternativeScenario } from "../components/intraday/AlternativeScenario";
import { ScenarioCards } from "../components/intraday/ScenarioCards";
import { ImportantLevelsPanel } from "../components/intraday/ImportantLevelsPanel";
import { SystemStatusCollapse } from "../components/intraday/SystemStatusCollapse";
import { ResearchMatrix } from "../components/intraday/ResearchMatrix";
import { IndicatorChips } from "../components/intraday/IndicatorChips";
import { CockpitAlerts } from "../components/intraday/CockpitAlerts";
import { StickyMobileActionBar } from "../components/intraday/StickyMobileActionBar";
import { DecisionDashboard } from "../components/decision/DecisionDashboard";
import { DetailedReportSections } from "../components/decision/DetailedReportSections";
import { TradePlanSummary } from "../components/decision/TradePlanSummary";
import { SetupStatusCard } from "../components/decision/SetupStatusCard";
import { XauusdChartCard } from "../components/decision/XauusdChartCard";
import { PremiumMarketStrip } from "../components/premium/PremiumMarketStrip";
import { PremiumPlanCard } from "../components/premium/PremiumPlanCard";
import { SystemHealthStrip } from "../components/premium/SystemHealthStrip";
import { Bell, CircleHelp, RefreshCw } from "lucide-react";
import { deriveDecisionDashboardState } from "../lib/decisionDashboardState";
import { useShellQuote } from "../lib/quoteContext";
import { resolveDisplayAction } from "../lib/planDisplay";
import { applyStablePlanToIntraday } from "../lib/sessionPlanBridge";
import {
  isNoValidIntradayPlan,
  NO_VALID_PLAN_NEXT,
  WAIT_NO_VALID_PLAN_LABEL
} from "../lib/planTextFormat";
import { fmtPrice } from "../lib/intradayFormat";
import type { QualificationPublicView } from "../lib/broker/qualificationTypes";
import type {
  DailySafetyPublicView,
  SystemHealthView
} from "../lib/broker/ctraderTypes";

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

type ResearchTab = "plan" | "structure" | "momentum" | "levels" | "history";

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
      isUiReviewFixture: false
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
  showTrigger,
  trigger,
  triggerPrice
}: {
  actionLabel: string;
  livePrice: number | null;
  showTrigger: boolean;
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

  const triggerBit = !showTrigger
    ? "Observation only"
    : triggerPrice != null
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
        {livePrice != null ? ` | ${livePrice.toFixed(2)}` : ""} | {triggerBit}
      </strong>
    </div>
  );
}

function PlanSkeleton() {
  return (
    <div className="gm-plan-skeleton" data-testid="plan-skeleton" aria-busy="true" aria-live="polite">
      <div className="gm-skel-block gm-skel-bar" />
      <div className="gm-skel-block gm-skel-card" />
      <div className="gm-skel-block gm-skel-rail" />
      <p className="gm-meta">Loading today&apos;s plan…</p>
    </div>
  );
}

/** Compact interactive intraday research cockpit — Mobile Plan V2. */
export function OverviewPage() {
  const { api, user } = useAuth();
  const { quote, setQuote } = useShellQuote();
  const isDesktop = useIsDesktop();
  const [structureOpen, setStructureOpen] = useState(false);
  const [researchTab, setResearchTab] = useState<ResearchTab>("plan");
  const [marketContextOpen, setMarketContextOpen] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [intradayDetailsOpen, setIntradayDetailsOpen] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [structureDecision, setStructureDecision] = useState<Decision | null>(null);
  const [intradayPlan, setIntradayPlan] = useState<IntradayPlan | null>(null);
  const [marketFeedHealth, setMarketFeedHealth] = useState<MarketFeedHealth | null>(null);
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
  const [qualification, setQualification] = useState<QualificationPublicView | null>(null);
  const [dailySafety, setDailySafety] = useState<DailySafetyPublicView | null>(null);
  const [systemHealth, setSystemHealth] = useState<SystemHealthView | null>(null);
  const tzPref = loadTimezonePreference();

  const load = useCallback(async () => {
    setErrorDetail(null);
    try {
      const [pack, active, recentSetups, overnight, b, s, qual, daily, health] = await Promise.all([
        api.latestDecisionPack(),
        api.listActiveSetups().catch(() => [] as SetupRecord[]),
        api.listSetups(6, "LIVE").catch(() => [] as SetupRecord[]),
        api.listSetups(20, "LIVE").catch(() => [] as SetupRecord[]),
        api.v5Briefing("LIVE").catch(() => null),
        api.v5Score("LIVE").catch(() => null),
        typeof api.getAutoTradeQualification === "function"
          ? api.getAutoTradeQualification().catch(() => null)
          : Promise.resolve(null),
        typeof api.getDailySafety === "function"
          ? api.getDailySafety("demo").catch(() => null)
          : Promise.resolve(null),
        typeof api.getSystemHealth === "function"
          ? api.getSystemHealth().catch(() => null)
          : Promise.resolve(null)
      ]);
      setQualification(qual);
      setDailySafety(daily);
      setSystemHealth(health);
      const latest = pack?.decision ?? null;
      const complete = pack?.latestCompleteStrategySignal ?? null;
      setDecision(latest);
      setStructureDecision(complete);
      setIntradayPlan(
        applyStablePlanToIntraday(
          (pack?.intradayPlan as IntradayPlan | null | undefined) ?? null,
          pack?.stablePlan ?? pack?.sessionPlan ?? null
        )
      );
      setMarketStructureMode(pack?.marketStructureMode ?? null);
      setMarketStructureDiagnostics(
        (pack?.marketStructureDiagnostics as Record<string, unknown> | null | undefined) ?? null
      );
      setMarketFeedHealth(pack?.marketFeedHealth ?? null);
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
  const decisionPrice = decision?.lastKnownPrice ?? decision?.ohlcv?.close ?? null;
  const livePrice =
    quote?.source === "broker" && quote.price != null ? quote.price : decisionPrice;
  const displayUpdated =
    quote?.source === "broker" && quote.updatedLabel ? quote.updatedLabel : compactTime;
  const displayFresh =
    quote?.source === "broker" ? Boolean(quote.fresh) : source === "live" && livePrice != null;
  const marketOpen: boolean | null =
    quote?.freshness === "MARKET_CLOSED" || quote?.marketStatus === "CLOSED"
      ? false
      : quote?.marketStatus === "OPEN" || quote?.freshness === "LIVE"
        ? true
        : quote?.source === "broker"
          ? null
          : null;
  const quotesConnected =
    quote?.source === "broker" &&
    quote.price != null &&
    !quote.unavailable &&
    quote.freshness !== "UNAVAILABLE";
  const ohlcvOpen = decision?.ohlcv?.open ?? null;
  const priceChange =
    livePrice != null && ohlcvOpen != null && Number.isFinite(ohlcvOpen)
      ? livePrice - ohlcvOpen
      : null;
  const priceChangePct =
    priceChange != null && ohlcvOpen != null && ohlcvOpen !== 0
      ? (priceChange / ohlcvOpen) * 100
      : null;

  useEffect(() => {
    // Informational TV fallback only when no Pepperstone broker quote is driving the shell.
    // Never overwrite an authoritative broker mid-price with plan/decision close.
    setQuote((prev) => {
      if (prev?.source === "broker") return prev;
      return {
        price: decisionPrice,
        updatedLabel: compactTime,
        sessionLabel,
        fresh: source === "live" && decisionPrice != null,
        source: "decision"
      };
    });
  }, [decisionPrice, compactTime, sessionLabel, source, setQuote]);

  const liveRangeOnly = marketStructureMode === "LIVE_RANGE_ONLY";
  // Chart overlays use real structure levels whenever present — even in LIVE_RANGE_ONLY.
  // Trade geometry / ladder still respect liveRangeOnly separately below.
  const chartPoc = structure?.marketStructure?.poc ?? briefing?.levels?.poc ?? null;
  const chartVah = structure?.marketStructure?.vah ?? briefing?.levels?.vah ?? null;
  const chartVal = structure?.marketStructure?.val ?? briefing?.levels?.val ?? null;
  const poc = liveRangeOnly ? null : chartPoc;
  const vah = liveRangeOnly ? null : chartVah;
  const val = liveRangeOnly ? null : chartVal;
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

  const mode = marketStructureMode ?? intradayPlan?.freshness.marketStructureMode ?? null;
  const noValid = isNoValidIntradayPlan(intradayPlan, mode);
  const isNoTrade =
    !noValid &&
    Boolean(
      intradayPlan &&
        (String(intradayPlan.action).toUpperCase() === "NO_TRADE" ||
          String(intradayPlan.planStatus ?? "").toUpperCase() === "NO_TRADE")
    );
  const hideTradeActions = noValid || isNoTrade;
  const validActionable = Boolean(
    intradayPlan && !noValid && !isNoTrade && intradayPlan.tradePlan.actionable
  );
  const shortAction = noValid
    ? WAIT_NO_VALID_PLAN_LABEL
    : intradayPlan
      ? resolveDisplayAction(intradayPlan).shortLabel
      : "—";

  const tabItems = [
    { id: "plan", label: "Plan" },
    { id: "structure", label: "Structure" },
    { id: "momentum", label: "Momentum" },
    { id: "levels", label: "Levels" },
    { id: "history", label: "History" }
  ];

  const decisionState = intradayPlan
    ? deriveDecisionDashboardState({
        plan: intradayPlan,
        marketStructureMode: mode,
        livePrice
      })
    : null;

  return (
    <div
      data-testid="overview-page"
      className="gm-dashboard gm-cockpit gm-plan-page gm-plan-v2-page gm-premium-home gm-premium-v2"
    >
      <div
        className="gm-page-header-row gm-plan-header-compact"
        style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <PageHeader title="Today's Plan" freshness={freshness} />
        </div>
        <button
          type="button"
          className="gm-btn-outline gm-desktop-refresh"
          data-testid="dashboard-refresh"
          onClick={refresh}
          disabled={refreshing || loading}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <p className="gm-meta gm-sr-only" data-testid="dashboard-last-refresh">
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

      {loading && !intradayPlan && <PlanSkeleton />}

      {intradayPlan ? (
        <div className="gm-cockpit-main" data-testid="cockpit-main">
          <StickyActionSummary
            actionLabel={shortAction}
            livePrice={livePrice}
            showTrigger={!hideTradeActions}
            trigger={intradayPlan.trigger}
            triggerPrice={intradayPlan.triggerPrice}
          />
          <PremiumMarketStrip
            symbol="XAUUSD"
            livePrice={livePrice}
            updatedLabel={displayUpdated}
            sessionLabel={quote?.sessionLabel ?? sessionLabel}
            fresh={displayFresh}
            marketOpen={marketOpen}
            freshness={quote?.freshness}
            quotesConnected={quotesConnected}
            bid={quote?.bid ?? null}
            ask={quote?.ask ?? null}
            priceChange={priceChange}
            priceChangePct={priceChangePct}
          />

          <div data-testid="main-action-sentinel" id="gm-main-action-anchor">
            <DecisionDashboard
              plan={intradayPlan}
              marketFeedHealth={marketFeedHealth}
              marketStructureMode={mode}
              livePrice={livePrice}
              onRefresh={refresh}
              refreshing={refreshing}
              density="hero"
            />
          </div>

          <TradePlanSummary
            plan={intradayPlan}
            livePrice={livePrice}
            marketStructureMode={mode}
            state={decisionState}
          />

          <XauusdChartCard
            currentPrice={livePrice}
            vah={chartVah}
            poc={chartPoc}
            val={chartVal}
            support={decisionState?.nearestSupport ?? null}
            resistance={decisionState?.nearestResistance ?? null}
            marketClosed={marketOpen === false}
          />

          <section
            className="gm-prem-card gm-why-waiting"
            id="why-waiting"
            data-testid="why-waiting-card"
            aria-label="Why GoldMeta is waiting"
          >
            <p className="gm-label">Why GoldMeta is waiting</p>
            <SetupStatusCard
              plan={intradayPlan}
              marketStructureMode={mode}
              livePrice={livePrice}
              trendBias={intradayPlan.directionBias ?? briefing?.positionVsPoc ?? "Neutral"}
              volatility={briefing?.atrLabel ?? briefing?.marketRegime ?? "Moderate"}
              newsImpact="Low"
            />
            <a className="gm-linkish" href="/analysis" data-testid="view-full-analysis-link">
              View full analysis
            </a>
          </section>

          {systemHealth ? <SystemHealthStrip health={systemHealth} compact /> : null}

          <div className="gm-plan-mini-actions" data-testid="premium-quick-actions">
            <button
              type="button"
              className="gm-action-btn"
              onClick={refresh}
              disabled={refreshing}
              data-testid="premium-refresh"
            >
              <RefreshCw aria-hidden size={14} />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <a className="gm-action-btn" href="#phone-alerts" data-testid="premium-enable-alerts-link">
              <Bell aria-hidden size={14} />
              Alerts
            </a>
            <a className="gm-action-btn" href="#why-waiting" data-testid="premium-explain-link">
              <CircleHelp aria-hidden size={14} />
              Why wait?
            </a>
          </div>

          <CockpitAlerts
            marketStructureMode={marketStructureMode}
            loading={loading && !intradayPlan}
            signedOut={!user && !loading}
            apiError={Boolean(errorDetail) && !intradayPlan}
          />

          <details
            className="gm-collapse-section gm-advanced-analysis"
            data-testid="advanced-analysis-section"
            open={advancedOpen}
            onToggle={(e) => setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary>Advanced analysis</summary>
            <div className="gm-collapse-body">
          <div className="gm-segmented-tabs" data-testid="premium-detail-tabs" role="tablist">
            {tabItems.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={researchTab === tab.id}
                className={researchTab === tab.id ? "active" : undefined}
                data-testid={`research-tab-btn-${tab.id}`}
                onClick={() => setResearchTab(tab.id as ResearchTab)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {researchTab === "plan" && decisionState && (
            <div className="gm-cockpit-tab gm-plan-fold" data-testid="research-tab-plan">
              {/* Full setup analysis — not a second competing HOLD hero */}
              <div className="gm-confirm-strip" data-testid="confirm-5m-strip">
                <span>5M Confirmation</span>
                <strong>
                  {decisionState.confirmationPassed
                    ? "Confirmed"
                    : decisionState.confirmationLabel || "Pending"}
                </strong>
              </div>
              <SetupChecklist plan={intradayPlan} />
              {!hideTradeActions && (
                <>
                  <Confirmation5MCard
                    plan={intradayPlan}
                    decisionConfirmation={
                      structureDecision?.marketStructure?.confirmationClassification ??
                      decision?.marketStructure?.confirmationClassification
                    }
                  />
                  <NextDecisionStrip
                    plan={intradayPlan}
                    marketStructureMode={mode}
                    onOpenScenarios={() => {
                      const el = document.querySelector('[data-testid="alternative-scenario"]');
                      if (el instanceof HTMLDetailsElement) el.open = true;
                      el?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  />
                  <AlternativeScenario plan={intradayPlan} />
                </>
              )}
              {hideTradeActions && (
                <p className="gm-meta" data-testid="plan-fold-observation">
                  Observation only — trade actions are hidden until a verified plan is available.
                </p>
              )}
              <details className="gm-collapse-section" data-testid="full-setup-analysis">
                <summary>Full setup analysis</summary>
                <div className="gm-collapse-body">
                  <PremiumPlanCard
                    plan={intradayPlan}
                    state={decisionState}
                    updatedLabel={compactTime}
                  />
                </div>
              </details>
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
                      entry: liveRangeOnly || hideTradeActions ? null : planEntry,
                      stop: liveRangeOnly || hideTradeActions ? null : planStop,
                      tp1: liveRangeOnly || hideTradeActions ? null : planTp1,
                      tp2: liveRangeOnly || hideTradeActions ? null : planTp2,
                      tp3: liveRangeOnly || hideTradeActions ? null : planTp3,
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
            </div>
          )}

          {researchTab === "levels" && (
            <div className="gm-cockpit-tab" data-testid="research-tab-levels">
              <ImportantLevelsPanel
                levels={orderedLevels}
                allLevels={intradayPlan.importantLevels}
                compactDefault
                livePrice={livePrice}
              />
              <OvernightReviewCard review={overnight} />
              <p style={{ marginTop: 8 }}>
                <Link className="gm-linkish" to="/levels">
                  Open All Key Levels →
                </Link>
              </p>
              {!hideTradeActions && (
                <ScenarioCards
                  plan={intradayPlan}
                  bullish={intradayPlan.bullishScenario}
                  bearish={intradayPlan.bearishScenario}
                />
              )}
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

          <details
            className="gm-collapse-section gm-premium-accordion"
            data-testid="intraday-plan-details"
            open={intradayDetailsOpen}
            onToggle={(e) => setIntradayDetailsOpen((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary>Intraday Plan Details</summary>
            <div className="gm-collapse-body">
              <DetailedReportSections
                plan={intradayPlan}
                marketStructureMode={marketStructureMode}
                marketStructureDiagnostics={marketStructureDiagnostics}
                decision={structureDecision ?? decision}
                score={score}
              />
            </div>
          </details>

          <details
            className="gm-collapse-section gm-premium-accordion"
            data-testid="market-context-section"
            open={marketContextOpen}
            onToggle={(e) => setMarketContextOpen((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary>Market Structure & Context</summary>
            <div className="gm-collapse-body">
              <p className="gm-meta">
                Support and resistance below are market context only. They are not entry, stop or
                target instructions.
              </p>
              <div className="gm-nearest-sr" data-testid="market-context-nearest-sr">
                <div>
                  <span className="gm-label">Nearest support</span>
                  <strong>{fmtPrice(intradayPlan.zones?.nearestSupport)}</strong>
                </div>
                <div>
                  <span className="gm-label">Nearest resistance</span>
                  <strong>{fmtPrice(intradayPlan.zones?.nearestResistance)}</strong>
                </div>
                <div>
                  <span className="gm-label">Range location</span>
                  <strong>
                    {String(
                      intradayPlan.valueLocation ?? intradayPlan.expectedRange.valueLocation ?? "—"
                    ).replace(/_/g, " ")}
                  </strong>
                </div>
              </div>
              <TimeframeAlignmentPanel plan={intradayPlan} />
              <ExpectedRangeCard
                range={intradayPlan.expectedRange}
                zones={intradayPlan.zones}
                marketStructureMode={mode}
              />
            </div>
          </details>

          <details
            className="gm-collapse-section gm-premium-accordion"
            data-testid="view-research-gate"
            open={researchOpen}
            onToggle={(e) => setResearchOpen((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary data-testid="view-research-btn">Momentum & Volume</summary>
            <div className="gm-collapse-body">
              <SectionCard title="Volatility & session">
                <p style={{ margin: 0 }}>
                  ATR {briefing?.atrLabel ?? "—"}
                  {briefing?.atrValue != null ? ` (${briefing.atrValue})` : ""}. Regime{" "}
                  {briefing?.marketRegime ?? "unknown"}. Session {sessionLabel}.
                </p>
              </SectionCard>
              <ResearchMatrix
                plan={intradayPlan}
                decision={structureDecision ?? decision}
                scoreComponents={score?.components}
              />
            </div>
          </details>

          <details
            className="gm-collapse-section"
            data-testid="advanced-diagnostics-section"
            open={diagnosticsOpen}
            onToggle={(e) => setDiagnosticsOpen((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary>Advanced diagnostics</summary>
            <div className="gm-collapse-body">
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
                      (Array.isArray(decision?.reasonSummary)
                        ? decision.reasonSummary
                        : undefined),
                    undefined
                  )}
                  <br />
                  Raw codes: {(decision?.reasonCodes ?? []).join(", ") || "none"}
                </p>
                {(intradayPlan.geometryReasonCodes?.length ?? 0) > 0 && (
                  <ul data-testid="geometry-reason-codes">
                    {intradayPlan.geometryReasonCodes!.map((code) => (
                      <li key={code}>
                        <code>{code}</code>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="gm-meta">
                  Source timestamps: quote age {intradayPlan.freshness.quoteAgeSeconds ?? "—"}s ·
                  signal age {intradayPlan.freshness.signalAgeSeconds ?? "—"}s · source mode{" "}
                  {intradayPlan.freshness.sourceLabel}
                </p>
                <div className="gm-trading-status-row" data-testid="dashboard-safety">
                  <span className="gm-badge warning">Live trading locked</span>
                  <span className="gm-badge neutral" data-testid="dashboard-autotrade-off">
                    {qualification?.state === "PREVIEW_QUALIFICATION" ||
                    qualification?.state === "CONTROLLED_DEMO_QUALIFICATION" ||
                    qualification?.state === "OBSERVATION_PERIOD"
                      ? "Demo · Qualifying"
                      : qualification?.demoAuto?.enabled
                        ? "Demo Auto"
                        : qualification?.overallLabel || "AutoTrade idle"}
                  </span>
                  <span className="gm-badge negative" data-testid="dashboard-emergency-stop">
                    Emergency STOP ready
                  </span>
                </div>
              </SystemStatusCollapse>
            </div>
          </details>

          <div className="gm-snapshot-actions-row">
            <PromoSnapshotButton onClick={snapshot.openModal} disabled={!decision && !briefing} />
          </div>
            </div>
          </details>

        </div>
      ) : (
        !loading && (
          <div className="gm-cockpit-main" data-testid="cockpit-main-empty">
            <PremiumMarketStrip
              symbol="XAUUSD"
              livePrice={livePrice}
              updatedLabel={displayUpdated}
              sessionLabel={quote?.sessionLabel ?? sessionLabel}
              fresh={displayFresh}
              marketOpen={marketOpen}
              freshness={quote?.freshness}
              quotesConnected={quotesConnected}
              bid={quote?.bid ?? null}
              ask={quote?.ask ?? null}
              priceChange={priceChange}
              priceChangePct={priceChangePct}
            />
            <section
              className="gm-decision-dashboard gm-decision-premium tone-wait"
              data-testid="todays-intraday-plan"
              data-state="NO_VALID_PLAN"
              aria-label="Today's XAUUSD decision: WAIT"
            >
              <div
                className="gm-decision-hero-v2 gm-decision-hero-compact"
                data-testid="intraday-action-card"
                data-tone="prepare"
              >
                <div className="gm-hero-top">
                  <span className="gm-hero-kicker">XAUUSD Decision</span>
                </div>
                <h1 data-testid="intraday-action-label">
                  <span data-testid="intraday-action-short">{WAIT_NO_VALID_PLAN_LABEL}</span>
                </h1>
                <p className="gm-hero-instruction" data-testid="no-valid-plan-next">
                  {NO_VALID_PLAN_NEXT}
                </p>
                <p className="gm-hero-foot" data-testid="no-valid-plan-title">
                  Manual trading only — AutoTrade stays OFF.
                </p>
              </div>
            </section>
            <XauusdChartCard
              currentPrice={livePrice}
              vah={chartVah}
              poc={chartPoc}
              val={chartVal}
              marketClosed={marketOpen === false}
            />
          </div>
        )
      )}

      {!intradayPlan && !loading && (
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

      {/* Advanced diagnostics when no plan — keep system status reachable */}
      {!intradayPlan && (
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
            <span className="gm-badge warning">Live trading locked</span>
            <span className="gm-badge neutral" data-testid="dashboard-autotrade-off">
              {qualification?.overallLabel || "AutoTrade idle"}
            </span>
            <span className="gm-badge negative" data-testid="dashboard-emergency-stop">
              Emergency STOP ready
            </span>
          </div>
        </SystemStatusCollapse>
      )}

      {!intradayPlan ? (
        <div className="gm-snapshot-actions-row">
          <PromoSnapshotButton onClick={snapshot.openModal} disabled={!decision && !briefing} />
        </div>
      ) : null}
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

      {validActionable && (
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
      )}

      <StickyMobileActionBar
        onRefresh={refresh}
        refreshing={refreshing || loading}
        validPlan={validActionable}
      />
    </div>
  );
}
