import { Link } from "react-router-dom";
import type { IntradayPlan } from "../../types/intradayPlan";
import { fmtPrice } from "../../lib/intradayFormat";
import {
  formatLevelWithOptionalPrice,
  isLegacyPlanData,
  isNoValidIntradayPlan,
  LEGACY_PLAN_BANNER,
  NO_VALID_PLAN_NEXT,
  NO_VALID_PLAN_TITLE,
  sanitizePlanText
} from "../../lib/planTextFormat";
import {
  planStatusLabel,
  resolveDisplayAction,
  toneIcon
} from "../../lib/planDisplay";
import { ExplainThisPage } from "./ExplainThisPage";

type Props = {
  plan: IntradayPlan;
  marketStructureMode?: string | null;
  planQuality?: { grade?: string | null; reasons?: string[] | null } | null;
};

function setupTypeLabel(plan: IntradayPlan): string {
  const market = sanitizePlanText(plan.marketType.replace(/_/g, " "));
  const bias = sanitizePlanText(plan.directionBias.replace(/_/g, " "));
  return `${market} · ${bias}`;
}

function resolveLevels(plan: IntradayPlan) {
  const tp = plan.tradePlan;
  const entry =
    tp.entryZone != null
      ? sanitizePlanText(String(tp.entryZone))
      : plan.triggerPrice != null
        ? fmtPrice(plan.triggerPrice)
        : sanitizePlanText(plan.trigger);
  const stop =
    tp.stopLoss ??
    plan.bullishScenario?.invalidationPrice ??
    plan.bearishScenario?.invalidationPrice ??
    null;
  const tp1 =
    tp.tp1 ??
    plan.nextTargetPrice ??
    plan.bullishScenario?.firstTargetPrice ??
    plan.bearishScenario?.firstTargetPrice ??
    null;
  const tp2 =
    tp.tp2 ??
    plan.afterThatTargetPrice ??
    plan.bullishScenario?.secondTargetPrice ??
    plan.bearishScenario?.secondTargetPrice ??
    null;
  return { entry, stop, tp1, tp2 };
}

/**
 * Single primary card: Today's Intraday Plan (replaces duplicate PREPARE action card).
 */
export function PrimaryPlanCard({ plan, marketStructureMode, planQuality }: Props) {
  const display = resolveDisplayAction(plan);
  const noValid = isNoValidIntradayPlan(plan, marketStructureMode);
  const legacy = !noValid && isLegacyPlanData(plan);
  const levels = resolveLevels(plan);
  const showLevels = !noValid && plan.action !== "NO_TRADE";
  const confirmation =
    sanitizePlanText(plan.entryConfirmation?.[0]) ||
    sanitizePlanText(plan.confirmation5m?.detail) ||
    "Wait for a meaningful 5-minute confirmation.";
  const whatToDo = sanitizePlanText(plan.oneSentence) || sanitizePlanText(plan.whyNotReady);
  const invalidation = formatLevelWithOptionalPrice(plan.invalidation, null);
  const qualityGrade =
    planQuality?.grade ??
    (plan.confidence >= 80 ? "A" : plan.confidence >= 60 ? "B" : plan.confidence >= 40 ? "C" : null);
  const status = plan.planStatus ? planStatusLabel(plan.planStatus) : null;

  if (noValid) {
    return (
      <section
        className="gm-primary-plan tone-unavailable gm-primary-plan-unified"
        data-testid="todays-intraday-plan"
        data-state="NO_VALID_PLAN"
        aria-label="Today's intraday plan"
      >
        <div className="gm-section-head">
          <h2 className="gm-section-title">Today&apos;s Intraday Plan</h2>
          <span className="gm-tone-pill tone-unavailable" data-testid="plan-direction-pill">
            <span aria-hidden="true">{toneIcon("unavailable")}</span> NO PLAN
          </span>
        </div>
        <h3 className="gm-no-plan-title" data-testid="no-valid-plan-title">
          {NO_VALID_PLAN_TITLE}
        </h3>
        <p className="gm-primary-plan-sentence" data-testid="no-valid-plan-next">
          {NO_VALID_PLAN_NEXT}
        </p>
        <p className="gm-meta" data-testid="no-valid-plan-note">
          Live price may be available, but complete 15-minute market structure has not been received.
          Observation only — no actionable entry, stop or targets.
        </p>
        <div className="gm-primary-plan-footer">
          <ExplainThisPage />
        </div>
      </section>
    );
  }

  return (
    <section
      className={`gm-primary-plan gm-primary-plan-unified tone-${display.tone}`}
      data-testid="todays-intraday-plan"
      data-tone={display.tone}
      data-demoted={display.demotedFromNow ? "1" : "0"}
      aria-label="Today's intraday plan"
    >
      <div className="gm-section-head">
        <h2 className="gm-section-title">Today&apos;s Intraday Plan</h2>
        {plan.planUnchanged ? (
          <span className="gm-badge neutral" data-testid="plan-unchanged">
            Plan unchanged
          </span>
        ) : null}
      </div>

      <div className="gm-primary-action-row" data-testid="intraday-action-card" data-tone={display.tone}>
        <h3 className="gm-intra-action-label" data-testid="intraday-action-label">
          <span className="gm-action-icon" aria-hidden="true">
            {display.icon}
          </span>{" "}
          <span data-testid="intraday-action-short">{display.shortLabel}</span>
          {display.fullLabel !== display.shortLabel && (
            <span className="gm-action-sublabel">{sanitizePlanText(display.fullLabel)}</span>
          )}
        </h3>
        <span className={`gm-tone-pill tone-${display.tone}`} data-testid="plan-direction-pill">
          <span aria-hidden="true">{display.icon}</span> {display.shortLabel}
        </span>
      </div>

      <p className="gm-meta gm-setup-type" data-testid="primary-plan-setup-type">
        <strong>Setup:</strong> {setupTypeLabel(plan)}
      </p>

      {legacy && (
        <p className="gm-legacy-banner" data-testid="legacy-plan-banner" role="status">
          {LEGACY_PLAN_BANNER}
        </p>
      )}

      <div className="gm-what-now" data-testid="primary-what-to-do">
        <p className="gm-label">What to do now</p>
        <p className="gm-primary-plan-sentence" data-testid="intraday-one-sentence">
          {whatToDo || "Wait for the next verified plan update."}
        </p>
        {display.demotedFromNow && (
          <p className="gm-meta" data-testid="action-now-gated" role="status">
            BUY NOW / SELL NOW only when all six conditions pass.
          </p>
        )}
      </div>

      {showLevels ? (
        <div className="gm-plan-levels-grid gm-plan-levels-2x2" data-testid="plan-levels-strip">
          <div data-testid="plan-level-entry">
            <span className="gm-label">Entry</span>
            <strong className="gm-plan-price">{levels.entry || "—"}</strong>
          </div>
          <div data-testid="plan-level-stop">
            <span className="gm-label">Stop</span>
            <strong className="gm-plan-price tone-sell">{fmtPrice(levels.stop)}</strong>
          </div>
          <div data-testid="plan-level-tp1">
            <span className="gm-label">TP1</span>
            <strong className="gm-plan-price tone-buy">{fmtPrice(levels.tp1)}</strong>
          </div>
          <div data-testid="plan-level-tp2">
            <span className="gm-label">TP2</span>
            <strong className="gm-plan-price">
              {levels.tp2 != null ? fmtPrice(levels.tp2) : "Optional"}
            </strong>
          </div>
        </div>
      ) : (
        <p className="gm-meta" data-testid="plan-levels-hidden">
          No actionable entry, stop or targets while the plan is NO TRADE.
        </p>
      )}

      <div className="gm-primary-confirm" data-testid="primary-plan-confirmation">
        <p className="gm-label">5M confirmation required</p>
        <p className="gm-confirm-detail" data-testid="intraday-confirmation-summary">
          {confirmation}
        </p>
      </div>

      <div className="gm-primary-plan-facts">
        <div>
          <span className="gm-label">Stop / invalidation</span>
          <strong data-testid="primary-plan-invalidation">{invalidation || "—"}</strong>
        </div>
        <div>
          <span className="gm-label">Plan quality</span>
          <strong data-testid="primary-plan-quality">
            {qualityGrade ? `${qualityGrade}` : "—"}
            {planQuality?.reasons?.[0]
              ? ` — ${sanitizePlanText(planQuality.reasons[0])}`
              : ""}
          </strong>
        </div>
        {status && (
          <div>
            <span className="gm-label">Current status</span>
            <strong data-testid="primary-plan-status">{status}</strong>
          </div>
        )}
        {plan.whyNotReady && (
          <div className="gm-primary-fact-span">
            <span className="gm-label">Why waiting</span>
            <strong data-testid="primary-plan-why">{sanitizePlanText(plan.whyNotReady)}</strong>
          </div>
        )}
      </div>

      <div className="gm-primary-plan-footer">
        <ExplainThisPage />
        <Link className="gm-linkish gm-sr-only-focusable" to="/help">
          Help
        </Link>
      </div>
    </section>
  );
}
