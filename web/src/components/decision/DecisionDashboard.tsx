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

function SupportResistance({
  state,
  testId
}: {
  state: ReturnType<typeof deriveDecisionDashboardState>;
  testId: string;
}) {
  return (
    <div className="gm-nearest-sr gm-sr-compact" data-testid={testId}>
      <div>
        <span className="gm-label">Support</span>
        <strong data-testid="nearest-support">{fmtPrice(state.nearestSupport)}</strong>
      </div>
      <div>
        <span className="gm-label">Resistance</span>
        <strong data-testid="nearest-resistance">{fmtPrice(state.nearestResistance)}</strong>
      </div>
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
    <details className="gm-wait-reason" data-testid="why-waiting">
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

export function DecisionDashboard({ plan, marketFeedHealth, marketStructureMode, livePrice }: Props) {
  const state = deriveDecisionDashboardState({ plan, marketStructureMode, livePrice });
  const isWaiting = state.mode === "WAIT";
  const isReady = state.mode === "BUY_READY" || state.mode === "SELL_READY";
  const isPotential = state.mode === "POTENTIAL_BUY" || state.mode === "POTENTIAL_SELL";
  const isNoTrade = state.mode === "NO_TRADE";

  return (
    <section
      className={`gm-decision-dashboard gm-decision-compact tone-${state.tone}`}
      data-testid="todays-intraday-plan"
      data-state={state.mode}
      aria-label={`Today's XAUUSD decision: ${state.headline}`}
    >
      <MarketFeedStatus health={marketFeedHealth} compact />

      <div className="gm-decision-hero" data-testid="intraday-action-card" data-tone={state.tone}>
        <h1 data-testid="intraday-action-label">
          <span data-testid="intraday-action-short">{state.headline}</span>
        </h1>
        <p className="gm-decision-state" data-testid="decision-plan-state">
          {isWaiting ? "No valid plan yet" : state.planState}
        </p>
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

      <div className="gm-decision-next-row">
        <NextPlanUpdate plan={plan} />
      </div>

      <SupportResistance
        state={state}
        testId={isWaiting ? "no-valid-nearest-sr" : "wait-nearest-sr"}
      />

      <div className="gm-next-action gm-next-action-compact" data-testid="decision-next-action">
        <span className="gm-label">Next</span>
        <strong>{state.nextAction}</strong>
      </div>

      <PhoneAlertsControl compact />

      {(isWaiting || isNoTrade) && <WhyWaiting plan={plan} state={state} />}

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
      className="gm-decision-dashboard gm-decision-dashboard-skeleton gm-decision-compact"
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
