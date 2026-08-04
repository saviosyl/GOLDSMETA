import { Link } from "react-router-dom";
import type { IntradayPlan } from "../../types/intradayPlan";
import {
  formatXauPrice,
  invalidationFromStop,
  isLegacyPlanData,
  isNoValidIntradayPlan,
  LEGACY_PLAN_BANNER,
  NO_VALID_PLAN_NEXT,
  NO_VALID_PLAN_SAFETY_REASON,
  NO_VALID_PLAN_TITLE,
  sanitizePlanText,
  WAIT_NO_VALID_PLAN_LABEL
} from "../../lib/planTextFormat";
import {
  planStatusLabel,
  resolveDisplayAction,
  toneIcon
} from "../../lib/planDisplay";
import { resolveAuthoritativeConfirmation } from "../../lib/confirmationAuthority";
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
  const entryNum =
    typeof tp.entryZone === "string" && Number.isFinite(Number(tp.entryZone.replace(/,/g, "")))
      ? Number(tp.entryZone.replace(/,/g, ""))
      : plan.triggerPrice;
  const entry = entryNum != null ? formatXauPrice(entryNum) : sanitizePlanText(plan.trigger);
  const stop = tp.stopLoss ?? null;
  const tp1 = tp.tp1 ?? plan.nextTargetPrice ?? null;
  const tp2 = tp.tp2 ?? plan.afterThatTargetPrice ?? null;
  return { entry, stop, tp1, tp2 };
}

/**
 * Single primary card: Today's Intraday Plan.
 * Never shows actionable BUY/SELL levels when geometry or quality fails.
 */
export function PrimaryPlanCard({ plan, marketStructureMode, planQuality }: Props) {
  const quality = planQuality ?? plan.planQuality ?? null;
  const display = resolveDisplayAction(plan);
  const noValid = isNoValidIntradayPlan(
    { ...plan, planQuality: quality },
    marketStructureMode
  );
  const legacy = !noValid && isLegacyPlanData(plan);
  const levels = resolveLevels(plan);
  const showLevels = !noValid && plan.action !== "NO_TRADE" && plan.tradePlan.actionable;
  const auth = resolveAuthoritativeConfirmation({
    confirmationState: plan.confirmation5m?.state,
    direction: plan.tradePlan.direction || plan.action
  });
  const confirmation = auth.detail;
  const whatToDo = sanitizePlanText(plan.oneSentence) || sanitizePlanText(plan.whyNotReady);
  const invalidation = levels.stop != null
    ? invalidationFromStop(plan.tradePlan.direction || plan.action, levels.stop)
    : sanitizePlanText(plan.invalidation);
  const qualityGrade = quality?.grade ?? null;
  const status = plan.planStatus ? planStatusLabel(plan.planStatus) : null;
  const reasonCodes = plan.geometryReasonCodes?.length
    ? plan.geometryReasonCodes
    : quality?.reasons?.filter((r) =>
        /ENTRY_EQUALS_STOP|STOP_WRONG_SIDE|TP1_|ZERO_RISK|INVALID_TARGET|MISSING_REQUIRED|PRICE_ALREADY|TRADE_LEVELS_FAILED|STRUCTURE_ONLY|WAIT_NO_VALID/i.test(
          r
        )
      ) ?? [];

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
            <span aria-hidden="true">{toneIcon("unavailable")}</span> {WAIT_NO_VALID_PLAN_LABEL}
          </span>
        </div>
        <h3 className="gm-no-plan-title" data-testid="intraday-action-label">
          <span data-testid="intraday-action-short">{WAIT_NO_VALID_PLAN_LABEL}</span>
        </h3>
        <h3 className="gm-no-plan-title" data-testid="no-valid-plan-title">
          {NO_VALID_PLAN_TITLE}
        </h3>
        <p className="gm-primary-plan-sentence" data-testid="no-valid-plan-reason">
          <strong>Reason:</strong> {plan.geometryMessage ?? NO_VALID_PLAN_SAFETY_REASON}
        </p>
        <p className="gm-primary-plan-sentence" data-testid="no-valid-plan-next">
          {NO_VALID_PLAN_NEXT}
        </p>
        {reasonCodes.length > 0 && (
          <ul className="gm-geometry-reasons" data-testid="geometry-reason-codes">
            {reasonCodes.map((code) => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ul>
        )}
        <p className="gm-meta" data-testid="no-valid-plan-note">
          No BUY ON PULLBACK, SELL ON REJECTION, entry, stop, TP1, TP2 or actionable confirmation
          while safety validation fails. Observation only.
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
        </h3>
        {display.demotedFromNow ? (
          <p className="gm-meta" data-testid="action-now-gated" role="status">
            BUY NOW / SELL NOW stays gated until every mandatory checklist condition passes.
          </p>
        ) : null}
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
      </div>

      {showLevels ? (
        <div className="gm-plan-levels-grid gm-plan-levels-2x2" data-testid="plan-levels-strip">
          <div data-testid="plan-level-entry">
            <span className="gm-label">Entry</span>
            <strong className="gm-plan-price">{levels.entry || "—"}</strong>
          </div>
          <div data-testid="plan-level-stop">
            <span className="gm-label">Stop</span>
            <strong className="gm-plan-price tone-sell">{formatXauPrice(levels.stop)}</strong>
          </div>
          <div data-testid="plan-level-tp1">
            <span className="gm-label">TP1</span>
            <strong className="gm-plan-price tone-buy">{formatXauPrice(levels.tp1)}</strong>
          </div>
          <div data-testid="plan-level-tp2">
            <span className="gm-label">TP2</span>
            <strong className="gm-plan-price">
              {levels.tp2 != null ? formatXauPrice(levels.tp2) : "Optional"}
            </strong>
          </div>
        </div>
      ) : (
        <p className="gm-meta" data-testid="plan-levels-hidden">
          No actionable entry, stop or targets while the plan is not tradeable.
        </p>
      )}

      <div className="gm-primary-confirm" data-testid="primary-plan-confirmation">
        <p className="gm-label">5M confirmation required</p>
        <p className="gm-confirm-detail" data-testid="intraday-confirmation-summary">
          {confirmation}
        </p>
        <p className="gm-meta" data-testid="confirm-5m-state">
          {auth.label}
        </p>
      </div>

      <div className="gm-primary-plan-facts">
        <div>
          <span className="gm-label">Stop / invalidation</span>
          <strong data-testid="primary-plan-invalidation">{invalidation || "—"}</strong>
        </div>
        <div>
          <span className="gm-label">Plan quality</span>
          <strong data-testid="primary-plan-quality">{qualityGrade ?? "—"}</strong>
        </div>
        {status && (
          <div>
            <span className="gm-label">Current status</span>
            <strong data-testid="primary-plan-status">{status}</strong>
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
