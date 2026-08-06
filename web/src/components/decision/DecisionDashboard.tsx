import type { IntradayPlan } from "../../types/intradayPlan";
import type { MarketFeedHealth } from "../../types/models";
import { deriveDecisionDashboardState } from "../../lib/decisionDashboardState";
import { fmtPrice } from "../../lib/intradayFormat";
import { sanitizePlanText } from "../../lib/planTextFormat";
import { NextPlanUpdate } from "../intraday/NextPlanUpdate";
import { MarketFeedStatus } from "./MarketFeedStatus";
import { PhoneAlertsControl } from "./PhoneAlertsControl";

type Props = {
  plan: IntradayPlan;
  marketFeedHealth?: MarketFeedHealth | null;
  marketStructureMode?: string | null;
  livePrice?: number | null;
};

function LevelGrid({ state }: { state: ReturnType<typeof deriveDecisionDashboardState> }) {
  if (!state.showLevels) return null;
  return (
    <div className="gm-decision-level-grid" data-testid="plan-levels-strip">
      <div data-testid="plan-level-entry">
        <span className="gm-label">Entry zone</span>
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
        <strong>{state.levels.tp2 != null ? fmtPrice(state.levels.tp2) : "Optional"}</strong>
      </div>
      {state.levels.rr && (
        <div className="gm-decision-level-wide" data-testid="plan-level-rr">
          <span className="gm-label">Risk : Reward</span>
          <strong>{state.levels.rr}</strong>
        </div>
      )}
    </div>
  );
}

function WaitingContext({ plan, state }: { plan: IntradayPlan; state: ReturnType<typeof deriveDecisionDashboardState> }) {
  return (
    <div className="gm-wait-context">
      <p data-testid="wait-monitoring-copy">
        GoldMeta is monitoring XAUUSD. You can be notified when a valid opportunity becomes ready.
      </p>
      <NextPlanUpdate plan={plan} />
      <p className="gm-meta" data-testid="analysis-timing-disclaimer">
        This is the next analysis review, not a guaranteed signal time.
      </p>
      <div className="gm-nearest-sr" data-testid="no-valid-nearest-sr">
        <div>
          <span className="gm-label">Nearest support</span>
          <strong data-testid="nearest-support">{fmtPrice(state.nearestSupport)}</strong>
        </div>
        <div>
          <span className="gm-label">Nearest resistance</span>
          <strong data-testid="nearest-resistance">{fmtPrice(state.nearestResistance)}</strong>
        </div>
      </div>
      <p className="gm-meta" data-testid="no-valid-bias-note">
        Market bias and support/resistance are context only - not an entry signal.
      </p>
      <details className="gm-wait-reason" data-testid="why-waiting">
        <summary>Why am I waiting?</summary>
        <p>{state.reason || "No valid trade plan yet."}</p>
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
      </details>
    </div>
  );
}

export function DecisionDashboard({ plan, marketFeedHealth, marketStructureMode, livePrice }: Props) {
  const state = deriveDecisionDashboardState({ plan, marketStructureMode, livePrice });
  const isWaiting = state.mode === "WAIT";
  const isReady = state.mode === "BUY_READY" || state.mode === "SELL_READY";
  const isPotential = state.mode === "POTENTIAL_BUY" || state.mode === "POTENTIAL_SELL";

  return (
    <section
      className={`gm-decision-dashboard tone-${state.tone}`}
      data-testid="todays-intraday-plan"
      data-state={state.mode}
      aria-label={`Today's XAUUSD decision: ${state.headline}`}
    >
      <MarketFeedStatus health={marketFeedHealth} />

      <div className="gm-decision-hero" data-testid="intraday-action-card" data-tone={state.tone}>
        <p className="gm-label">XAUUSD decision</p>
        <h1 data-testid="intraday-action-label">
          <span data-testid="intraday-action-short">{state.headline}</span>
        </h1>
        <p className="gm-decision-state" data-testid="decision-plan-state">
          {state.planState}
        </p>
      </div>

      {isWaiting ? (
        <WaitingContext plan={plan} state={state} />
      ) : (
        <>
          <LevelGrid state={state} />
          <div className="gm-decision-facts">
            <div data-testid="decision-confirmation">
              <span className="gm-label">5M confirmation</span>
              <strong>{state.confirmationPassed ? "Passed" : state.confirmationLabel}</strong>
              <p>{state.confirmationDetail}</p>
            </div>
            {state.priceVsEntryZone && (
              <div data-testid="decision-price-vs-entry">
                <span className="gm-label">Price vs entry</span>
                <strong>{state.priceVsEntryZone}</strong>
              </div>
            )}
            {isReady && state.confidenceLabel && (
              <div data-testid="decision-confidence">
                <span className="gm-label">Confidence</span>
                <strong>{state.confidenceLabel}</strong>
              </div>
            )}
            {state.lifecycleLabel && (
              <div data-testid="decision-lifecycle">
                <span className="gm-label">Lifecycle</span>
                <strong>{state.lifecycleLabel}</strong>
              </div>
            )}
          </div>
          {isPotential && (
            <p className="gm-meta" data-testid="potential-not-ready">
              This plan is not ready yet. Wait for 5M confirmation before considering any manual
              entry.
            </p>
          )}
        </>
      )}

      <div className="gm-next-action" data-testid="decision-next-action">
        <span className="gm-label">Next useful action</span>
        <strong>{state.nextAction}</strong>
      </div>

      <PhoneAlertsControl />

      <p className="gm-decision-safety" data-testid="dashboard-safety">
        Manual plan only {"\u00b7"} Review your own risk before entering {"\u00b7"} Analysis only
      </p>
      <span className="gm-badge neutral" data-testid="dashboard-autotrade-off">
        AutoTrade OFF
      </span>
      {sanitizePlanText(plan.disclaimer) && (
        <p className="gm-sr-only">{sanitizePlanText(plan.disclaimer)}</p>
      )}
    </section>
  );
}

export function DecisionDashboardSkeleton() {
  return (
    <div
      className="gm-decision-dashboard gm-decision-dashboard-skeleton"
      data-testid="decision-dashboard-skeleton"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="gm-skel-block gm-skel-bar" />
      <div className="gm-skel-block gm-skel-card" />
      <div className="gm-skel-block gm-skel-card" />
    </div>
  );
}
