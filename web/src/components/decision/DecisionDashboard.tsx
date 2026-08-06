import type { IntradayPlan } from "../../types/intradayPlan";
import type { MarketFeedHealth } from "../../types/models";
import { deriveDecisionDashboardState } from "../../lib/decisionDashboardState";
import { fmtPrice } from "../../lib/intradayFormat";
import { sanitizePlanText } from "../../lib/planTextFormat";
import {
  premiumDecisionChip,
  premiumDecisionSubtitle,
  premiumStatusLabel
} from "../../lib/premiumDecisionCopy";
import { NextPlanUpdate } from "../intraday/NextPlanUpdate";
import { MarketFeedStatus } from "./MarketFeedStatus";
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
    <div className="gm-decision-level-grid" data-testid="plan-levels-strip">
      <div data-testid="plan-level-entry">
        <span className="gm-label">Entry</span>
        <strong>{state.levels.entry ?? "--"}</strong>
      </div>
      <div data-testid="plan-level-stop">
        <span className="gm-label">Stop</span>
        <strong>{fmtPrice(state.levels.stop)}</strong>
      </div>
      <div data-testid="plan-level-tp1">
        <span className="gm-label">TP1</span>
        <strong>{fmtPrice(state.levels.tp1)}</strong>
      </div>
      <div data-testid="plan-level-tp2">
        <span className="gm-label">TP2</span>
        <strong>{state.levels.tp2 != null ? fmtPrice(state.levels.tp2) : "—"}</strong>
      </div>
      {state.levels.rr && (
        <div className="gm-decision-level-wide" data-testid="plan-level-rr">
          <span className="gm-label">R:R</span>
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
    <details className="gm-wait-reason" data-testid="why-waiting" id="why-waiting">
      <summary>Why waiting?</summary>
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
  const isWaiting = state.mode === "WAIT";
  const isReady = state.mode === "BUY_READY" || state.mode === "SELL_READY";
  const isPotential = state.mode === "POTENTIAL_BUY" || state.mode === "POTENTIAL_SELL";
  const isNoTrade = state.mode === "NO_TRADE";
  const showWhy = isWaiting || (isNoTrade && chip !== "PREPARE");

  return (
    <section
      className={`gm-decision-dashboard gm-decision-premium tone-${state.tone}`}
      data-testid="todays-intraday-plan"
      data-state={state.mode}
      aria-label={`Today's XAUUSD decision: ${chip}`}
    >
      <div className="gm-premium-hero" data-testid="intraday-action-card" data-tone={state.tone}>
        <div className="gm-premium-hero-top">
          <span className="gm-premium-hero-kicker">XAUUSD Decision</span>
          <span className="gm-premium-hero-icon" aria-hidden>
            ⏱
          </span>
        </div>
        <h1 data-testid="intraday-action-label">
          <span data-testid="intraday-action-short">{chip}</span>
        </h1>
        <p className="gm-decision-state" data-testid="decision-plan-state">
          {isWaiting ? "No valid plan yet" : subtitle}
        </p>
        {/* Keep WAIT-compatible test surface when prepare maps from NO_TRADE */}
        <span className="gm-sr-only" data-testid="premium-decision-chip">
          {chip}
        </span>

        <div className="gm-premium-hero-metrics">
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
            <strong className="gm-premium-status-live" data-testid="premium-hero-status">
              <span className="gm-premium-dot" aria-hidden />
              {statusLabel}
            </strong>
          </div>
        </div>

        <p className="gm-premium-hero-foot">GoldMeta is monitoring XAUUSD</p>
      </div>

      {!isWaiting && !isNoTrade && <LevelGrid state={state} />}

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
          {isReady && state.confidenceLabel && (
            <div data-testid="decision-confidence">
              <span className="gm-label">Confidence</span>
              <strong>{state.confidenceLabel}</strong>
            </div>
          )}
        </div>
      )}

      {isPotential && (
        <p className="gm-meta gm-potential-note" data-testid="potential-not-ready">
          Not ready — wait for 5M confirmation.
        </p>
      )}

      <div className="gm-premium-quick-actions" data-testid="premium-quick-actions">
        <button
          type="button"
          className="gm-premium-action-btn"
          onClick={onRefresh}
          disabled={refreshing}
          data-testid="premium-refresh"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
        <a className="gm-premium-action-btn" href="#phone-alerts" data-testid="premium-enable-alerts-link">
          Enable alerts
        </a>
        <a className="gm-premium-action-btn" href="#why-waiting" data-testid="premium-explain-link">
          Explain
        </a>
      </div>

      <div className="gm-next-action gm-next-action-compact" data-testid="decision-next-action">
        <span className="gm-label">Next</span>
        <strong>{state.nextAction}</strong>
      </div>

      <MarketFeedStatus health={marketFeedHealth} compact />
      <PhoneAlertsControl compact />

      {showWhy && <WhyWaiting plan={plan} state={state} />}
      {chip === "PREPARE" && (
        <details className="gm-wait-reason" data-testid="why-waiting" id="why-waiting">
          <summary>Explain</summary>
          <p data-testid="wait-monitoring-copy">
            GoldMeta is monitoring XAUUSD. You can be notified when a valid opportunity becomes ready.
          </p>
          <p>{sanitizePlanText(plan.oneSentence) || subtitle}</p>
        </details>
      )}

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
      className="gm-decision-dashboard gm-decision-dashboard-skeleton gm-decision-premium"
      data-testid="decision-dashboard-skeleton"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="gm-skel-block gm-skel-line" />
      <div className="gm-skel-block gm-skel-bar" />
      <div className="gm-skel-block gm-skel-card" />
    </div>
  );
}
