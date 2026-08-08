import {
  CircleHelp,
  RefreshCw,
  Bell,
  Timer,
  Crosshair,
  Shield,
  Flag,
  Scale
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

type Props = {
  plan: IntradayPlan;
  marketFeedHealth?: MarketFeedHealth | null;
  marketStructureMode?: string | null;
  livePrice?: number | null;
  onRefresh?: () => void;
  refreshing?: boolean;
};

function LevelGrid({ state }: { state: ReturnType<typeof deriveDecisionDashboardState> }) {
  if (!state.showLevels) return null;
  return (
    <div className="gm-decision-level-grid gm-trade-plan-summary" data-testid="plan-levels-strip">
      <div data-testid="plan-level-entry">
        <span className="gm-label">
          <Crosshair size={13} aria-hidden /> Entry Zone
        </span>
        <strong>{state.levels.entry ?? "--"}</strong>
      </div>
      <div data-testid="plan-level-stop">
        <span className="gm-label">
          <Shield size={13} aria-hidden /> Stop Loss
        </span>
        <strong>{fmtPrice(state.levels.stop)}</strong>
      </div>
      <div data-testid="plan-level-tp1">
        <span className="gm-label">
          <Flag size={13} aria-hidden /> TP1
        </span>
        <strong>{fmtPrice(state.levels.tp1)}</strong>
      </div>
      <div data-testid="plan-level-tp2">
        <span className="gm-label">
          <Flag size={13} aria-hidden /> TP2
        </span>
        <strong>{state.levels.tp2 != null ? fmtPrice(state.levels.tp2) : "—"}</strong>
      </div>
      {state.levels.rr && (
        <div className="gm-decision-level-wide" data-testid="plan-level-rr">
          <span className="gm-label">
            <Scale size={13} aria-hidden /> Risk / Reward
          </span>
          <strong>{state.levels.rr}</strong>
        </div>
      )}
    </div>
  );
}

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

export function DecisionDashboard({
  plan,
  marketFeedHealth,
  marketStructureMode,
  livePrice,
  onRefresh,
  refreshing
}: Props) {
  const state = deriveDecisionDashboardState({ plan, marketStructureMode, livePrice });
  const chip = premiumDecisionChip(state, plan);
  const subtitle = premiumDecisionSubtitle(state, livePrice, plan);
  const statusLabel = premiumStatusLabel(state, plan);
  const isWaiting = state.mode === "WAIT" || state.mode === "WATCHING";
  const isPotential = state.mode === "POTENTIAL_BUY" || state.mode === "POTENTIAL_SELL";
  const isHold = state.mode === "HOLD" || state.mode === "NO_TRADE";
  const showWhy =
    isWaiting ||
    state.mode === "WATCHING" ||
    state.mode === "HOLD" ||
    (isHold && !String(chip).startsWith("PREPARE")) ||
    String(chip).startsWith("PREPARE");
  const heroTone =
    chip === "PREPARE" || chip === "PREPARE BUY" || chip === "PREPARE SELL" || chip === "WATCHING"
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
  const feedFresh = marketFeedHealth?.status === "green";

  return (
    <section
      className={`gm-decision-dashboard gm-decision-premium tone-${state.tone}`}
      data-testid="todays-intraday-plan"
      data-state={state.mode}
      data-copy-version={PREMIUM_STATUS_COPY_VERSION}
      aria-label={`Today's XAUUSD decision: ${chip}`}
    >
      <FeedStatusStrip health={marketFeedHealth} detailsHref="/alerts" />

      <div
        className="gm-decision-hero-v2"
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

        <div className="gm-hero-metrics">
          <div>
            <span className="gm-label">Next 15M Check</span>
            <div className="gm-decision-next-row">
              <NextPlanUpdate plan={plan} />
            </div>
          </div>
          <div data-testid={isWaiting ? "no-valid-nearest-sr" : "wait-nearest-sr"}>
            <span className="gm-label">Nearest Support</span>
            <strong data-testid="nearest-support">{fmtPrice(state.nearestSupport)}</strong>
          </div>
          <div>
            <span className="gm-label">Nearest Resistance</span>
            <strong data-testid="nearest-resistance">{fmtPrice(state.nearestResistance)}</strong>
          </div>
          <div>
            <span className="gm-label">Status</span>
            <strong
              className={feedFresh ? "gm-hero-status" : undefined}
              data-testid="premium-hero-status"
            >
              {feedFresh ? <span className="gm-fresh-dot is-fresh" aria-hidden /> : null}
              {statusLabel}
            </strong>
          </div>
        </div>

        <p className="gm-hero-foot">GoldMeta is monitoring XAUUSD</p>
      </div>

      <div className="gm-action-row" data-testid="premium-quick-actions">
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
          Enable alerts
        </a>
        <a className="gm-action-btn" href="#why-waiting" data-testid="premium-explain-link">
          <CircleHelp aria-hidden />
          Explain
        </a>
        <a className="gm-action-btn gm-why-wait" href="#why-waiting">
          <CircleHelp aria-hidden />
          Why wait?
        </a>
      </div>

      {!isWaiting && !isHold && <LevelGrid state={state} />}

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
        Manual only · Review your risk · AutoTrade OFF
      </p>
      <span className="gm-sr-only" data-testid="dashboard-autotrade-off">
        AutoTrade OFF
      </span>
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
      <div className="gm-skeleton" style={{ height: 48, marginBottom: 12 }} />
      <div className="gm-skeleton" style={{ height: 220, marginBottom: 12 }} />
      <div className="gm-skeleton" style={{ height: 48 }} />
    </div>
  );
}
