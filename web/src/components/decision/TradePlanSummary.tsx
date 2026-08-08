import {
  Crosshair,
  Flag,
  Percent,
  Scale,
  Shield,
  Wallet,
  Hourglass
} from "lucide-react";
import type { IntradayPlan } from "../../types/intradayPlan";
import {
  deriveDecisionDashboardState,
  type DecisionDashboardState
} from "../../lib/decisionDashboardState";
import { fmtPrice } from "../../lib/intradayFormat";

type Props = {
  plan: IntradayPlan;
  livePrice?: number | null;
  marketStructureMode?: string | null;
  state?: DecisionDashboardState | null;
};

export function TradePlanSummary({
  plan,
  livePrice = null,
  marketStructureMode = null,
  state: stateProp
}: Props) {
  const state =
    stateProp ??
    deriveDecisionDashboardState({ plan, marketStructureMode, livePrice });
  const waiting =
    state.mode === "WAIT" ||
    state.mode === "WATCHING" ||
    state.mode === "HOLD" ||
    state.mode === "NO_TRADE" ||
    !state.showLevels;

  if (waiting) {
    return (
      <section
        className="gm-trade-plan-summary gm-trade-plan-waiting"
        data-testid="plan-levels-strip"
        aria-label="Trade plan summary"
      >
        <div className="gm-trade-plan-summary__head">
          <Hourglass size={14} aria-hidden />
          <h2>Trade plan summary</h2>
        </div>
        <p className="gm-trade-plan-waiting__copy" data-testid="trade-plan-waiting">
          Potential plan / Waiting for setup
        </p>
        {state.nextRequiredCondition ? (
          <p className="gm-meta" data-testid="trade-plan-waiting-detail">
            {state.nextRequiredCondition}
          </p>
        ) : null}
      </section>
    );
  }

  const tp3 = plan.tradePlan?.tp3 ?? null;
  const positionSizeNote = plan.tradePlan?.positionSizeNote || null;
  const accountRiskNote = plan.tradePlan?.maxCashRiskNote || null;

  return (
    <section
      className="gm-decision-level-grid gm-trade-plan-summary"
      data-testid="plan-levels-strip"
      aria-label="Trade plan summary"
    >
      <div className="gm-trade-plan-summary__head">
        <h2>Trade plan summary</h2>
      </div>
      <div data-testid="plan-level-entry">
        <span className="gm-label">
          <Crosshair size={13} aria-hidden /> Entry Zone
        </span>
        <strong>{state.levels.entry ?? "—"}</strong>
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
      {tp3 != null && Number.isFinite(tp3) ? (
        <div data-testid="plan-level-tp3">
          <span className="gm-label">
            <Flag size={13} aria-hidden /> TP3
          </span>
          <strong>{fmtPrice(tp3)}</strong>
        </div>
      ) : null}
      {state.levels.rr ? (
        <div className="gm-decision-level-wide" data-testid="plan-level-rr">
          <span className="gm-label">
            <Scale size={13} aria-hidden /> Risk / Reward
          </span>
          <strong>{state.levels.rr}</strong>
        </div>
      ) : null}
      {positionSizeNote ? (
        <div data-testid="plan-position-size">
          <span className="gm-label">
            <Wallet size={13} aria-hidden /> Position Size
          </span>
          <strong>{positionSizeNote}</strong>
        </div>
      ) : null}
      {accountRiskNote ? (
        <div data-testid="plan-account-risk">
          <span className="gm-label">
            <Percent size={13} aria-hidden /> Account Risk
          </span>
          <strong>{accountRiskNote}</strong>
        </div>
      ) : null}
    </section>
  );
}
