import {
  CircleHelp,
  RefreshCw,
  Bell,
  Timer
} from "lucide-react";
import type { IntradayPlan } from "../../types/intradayPlan";
import type { MarketFeedHealth } from "../../types/models";
import {
  deriveDecisionDashboardState,
  leanConfidenceLabel
} from "../../lib/decisionDashboardState";
import { fmtPrice } from "../../lib/intradayFormat";
import { sanitizePlanText } from "../../lib/planTextFormat";
import {
  PREMIUM_STATUS_COPY_VERSION,
  premiumDecisionChip,
  premiumDecisionSubtitle,
  premiumStatusLabel
} from "../../lib/premiumDecisionCopy";
import { NextPlanUpdate } from "../intraday/NextPlanUpdate";
import { FeedStatusStrip } from "../gm/FeedStatusStrip";
import { PhoneAlertsControl } from "./PhoneAlertsControl";
import { useAutoTradeHeaderStatus } from "../../hooks/useAutoTradeHeaderStatus";

type Props = {
  plan: IntradayPlan;
  marketFeedHealth?: MarketFeedHealth | null;
  marketStructureMode?: string | null;
  livePrice?: number | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  /**
   * hero = compact decision card only (chart sits immediately below).
   * full = include secondary controls/details under the hero.
   */
  density?: "hero" | "full";
};

function WhyWaiting({
  plan,
  state
}: {
  plan: IntradayPlan;
  state: ReturnType<typeof deriveDecisionDashboardState>;
}) {
  return (
    <details className="gm-wait-reason gm-accordion-card" data-testid="why-waiting" id="why-waiting">
      <summary>
        <CircleHelp aria-hidden />
        Why waiting?
      </summary>
      <div className="gm-collapse-body">
        <p data-testid="wait-monitoring-copy">
          GoldMeta is monitoring XAUUSD. You can be notified when a valid opportunity becomes ready.
        </p>
        <p>{state.reason || "No valid trade plan yet."}</p>
        <p className="gm-meta" data-testid="analysis-timing-disclaimer">
          Next check is the next analysis review, not a guaranteed signal time.
        </p>
        <p className="gm-meta" data-testid="no-valid-bias-note">
          Market bias and support/resistance are context only — not an entry signal.
        </p>
        {state.technicalDetails.length > 0 && (
          <details>
            <summary>Technical details</summary>
            <ul>
              {state.technicalDetails.map((detail, idx) => (
                <li key={`${detail}-${idx}`}>{detail}</li>
              ))}
            </ul>
          </details>
        )}
        {sanitizePlanText(plan.disclaimer) && (
          <p className="gm-meta">{sanitizePlanText(plan.disclaimer)}</p>
        )}
      </div>
    </details>
  );
}

export function DecisionSecondaryPanel({
  plan,
  marketStructureMode,
  livePrice,
  onRefresh,
  refreshing
}: {
  plan: IntradayPlan;
  marketStructureMode?: string | null;
  livePrice?: number | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const state = deriveDecisionDashboardState({ plan, marketStructureMode, livePrice });
  const chip = premiumDecisionChip(state, plan);
  const isWaiting = state.mode === "WAIT" || state.mode === "WATCHING";
  const isPotential = state.mode === "POTENTIAL_BUY" || state.mode === "POTENTIAL_SELL";
  const isHold = state.mode === "HOLD" || state.mode === "NO_TRADE";
  const showWhy =
    isWaiting ||
    state.mode === "WATCHING" ||
    state.mode === "HOLD" ||
    (isHold && !String(chip).startsWith("PREPARE")) ||
    String(chip).startsWith("PREPARE");
  const atHeader = useAutoTradeHeaderStatus();
  const atLabel =
    atHeader.stateKey === "QUALIFYING"
      ? "Qualification: Running · Demo Auto: Not enabled yet · Live Auto: Locked"
      : atHeader.stateKey === "OFF"
        ? "AutoTrade idle"
        : atHeader.label;

  return (
    <div className="gm-decision-secondary" data-testid="decision-secondary-panel">
      <div className="gm-action-row gm-action-row-compact" data-testid="premium-quick-actions">
        <button
          type="button"
          className="gm-action-btn"
          onClick={onRefresh}
          disabled={refreshing}
          data-testid="premium-refresh"
        >
          <RefreshCw aria-hidden />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
        <a className="gm-action-btn" href="#phone-alerts" data-testid="premium-enable-alerts-link">
          <Bell aria-hidden />
          Alerts
        </a>
        <a className="gm-action-btn" href="#why-waiting" data-testid="premium-explain-link">
          <CircleHelp aria-hidden />
          Why wait?
        </a>
      </div>

      {!isWaiting && (
        <div className="gm-decision-facts gm-decision-facts-compact">
          <div data-testid="decision-confirmation">
            <span className="gm-label">5M confirm</span>
            <strong>{state.confirmationPassed ? "Passed" : state.confirmationLabel}</strong>
          </div>
          {state.priceVsEntryZone && (
            <div data-testid="decision-price-vs-entry">
              <span className="gm-label">vs entry</span>
              <strong>{state.priceVsEntryZone}</strong>
            </div>
          )}
          {state.confidenceLabel && (
            <div data-testid="decision-confidence">
              <span className="gm-label">Setup quality</span>
              <strong>{state.confidenceLabel}</strong>
            </div>
          )}
        </div>
      )}

      {isPotential && (
        <p className="gm-meta gm-potential-note" data-testid="potential-not-ready">
          {state.nextRequiredCondition || "Not ready — wait for 5M confirmation."}
        </p>
      )}

      <div className="gm-next-action gm-next-action-compact" data-testid="decision-next-action">
        <span className="gm-label">Next</span>
        <strong>{state.nextAction}</strong>
      </div>

      <PhoneAlertsControl compact />
      {showWhy && <WhyWaiting plan={plan} state={state} />}
      <p className="gm-decision-safety" data-testid="dashboard-safety">
        Manual only · Review your risk · {atLabel}
      </p>
      <span className="gm-sr-only" data-testid="dashboard-autotrade-off">
        {atLabel}
      </span>
    </div>
  );
}

export function DecisionDashboard({
  plan,
  marketFeedHealth,
  marketStructureMode,
  livePrice,
  onRefresh,
  refreshing,
  density = "hero"
}: Props) {
  const state = deriveDecisionDashboardState({ plan, marketStructureMode, livePrice });
  const chip = premiumDecisionChip(state, plan);
  const subtitle = premiumDecisionSubtitle(state, livePrice, plan);
  const statusLabel = premiumStatusLabel(state, plan);
  const isWaiting = state.mode === "WAIT" || state.mode === "WATCHING";
  const heroTone =
    chip === "PREPARE" ||
    chip === "PREPARE BUY" ||
    chip === "PREPARE SELL" ||
    chip === "WATCHING" ||
    chip === "WAIT"
      ? "prepare"
      : chip === "BUY" || chip === "BUY READY"
        ? "buy"
        : chip === "SELL" || chip === "SELL READY"
          ? "sell"
          : chip === "HOLD" || chip === "NO TRADE"
            ? "wait"
            : state.tone;
  const planReady = state.mode === "BUY_READY" || state.mode === "SELL_READY";
  const showHeroConfidence =
    state.confidencePercent != null &&
    (chip === "BUY" ||
      chip === "SELL" ||
      chip === "BUY READY" ||
      chip === "SELL READY" ||
      chip === "HOLD" ||
      chip === "PREPARE" ||
      chip === "PREPARE BUY" ||
      chip === "PREPARE SELL");

  return (
    <section
      className={`gm-decision-dashboard gm-decision-premium gm-decision-compact tone-${state.tone}`}
      data-testid="todays-intraday-plan"
      data-state={state.mode}
      data-copy-version={PREMIUM_STATUS_COPY_VERSION}
      aria-label={`Today's XAUUSD decision: ${chip}`}
    >
      <FeedStatusStrip health={marketFeedHealth} detailsHref="/alerts" />

      <div
        className="gm-decision-hero-v2 gm-decision-hero-compact"
        data-testid="intraday-action-card"
        data-tone={heroTone}
      >
        <div className="gm-hero-top">
          <span className="gm-hero-kicker">XAUUSD Decision</span>
          <Timer className="gm-hero-icon" aria-hidden strokeWidth={1.75} />
        </div>
        {planReady ? (
          <span className="gm-plan-ready-badge" data-testid="plan-ready-badge">
            PLAN READY
          </span>
        ) : null}
        <h1 data-testid="intraday-action-label">
          <span data-testid="intraday-action-short">{chip}</span>
        </h1>
        {showHeroConfidence ? (
          <p className="gm-hero-confidence" data-testid="hero-confidence">
            {leanConfidenceLabel(state.confidencePercent, state.direction) ??
              `${Math.round(state.confidencePercent!)}% confidence`}
          </p>
        ) : null}
        {chip === "HOLD" && state.direction ? (
          <p className="gm-hero-lean" data-testid="hero-direction-lean">
            {state.direction === "BUY" ? "Bullish lean" : "Bearish lean"} — not an entry yet
          </p>
        ) : null}
        <p className="gm-hero-instruction" data-testid="decision-plan-state">
          {subtitle}
        </p>

        <div className="gm-hero-metrics gm-hero-metrics-compact">
          <div>
            <span className="gm-label">Next 15M</span>
            <div className="gm-decision-next-row">
              <NextPlanUpdate plan={plan} />
            </div>
          </div>
          <div data-testid={isWaiting ? "no-valid-nearest-sr" : "wait-nearest-sr"}>
            <span className="gm-label">Support</span>
            <strong data-testid="nearest-support">{fmtPrice(state.nearestSupport)}</strong>
          </div>
          <div>
            <span className="gm-label">Resistance</span>
            <strong data-testid="nearest-resistance">{fmtPrice(state.nearestResistance)}</strong>
          </div>
          <div>
            <span className="gm-label">Status</span>
            <strong data-testid="premium-hero-status">{statusLabel}</strong>
          </div>
        </div>
      </div>

      {density === "full" ? (
        <DecisionSecondaryPanel
          plan={plan}
          marketStructureMode={marketStructureMode}
          livePrice={livePrice}
          onRefresh={onRefresh}
          refreshing={refreshing}
        />
      ) : null}
    </section>
  );
}

export function DecisionDashboardSkeleton() {
  return (
    <div
      className="gm-decision-dashboard gm-decision-dashboard-skeleton"
      data-testid="decision-dashboard-skeleton"
      aria-busy="true"
    >
      <div className="gm-skeleton" style={{ height: 120, marginBottom: 12 }} />
      <div className="gm-skeleton" style={{ height: 280, marginBottom: 12 }} />
      <div className="gm-skeleton" style={{ height: 48 }} />
    </div>
  );
}
