import { Link } from "react-router-dom";
import type { IntradayPlan } from "../../types/intradayPlan";
import {
  formatXauPrice,
  isLegacyPlanData,
  isNoValidIntradayPlan,
  LEGACY_PLAN_BANNER,
  NO_VALID_PLAN_NEXT,
  NO_VALID_PLAN_SAFETY_REASON,
  sanitizePlanText,
  WAIT_NO_VALID_PLAN_LABEL
} from "../../lib/planTextFormat";
import { plainReason } from "../../lib/reasonCodePlain";
import {
  planStatusLabel,
  resolveDisplayAction,
  toneIcon
} from "../../lib/planDisplay";
import { resolveAuthoritativeConfirmation } from "../../lib/confirmationAuthority";
import { fmtPrice } from "../../lib/intradayFormat";
import { NextPlanUpdate } from "./NextPlanUpdate";

type Props = {
  plan: IntradayPlan;
  marketStructureMode?: string | null;
  planQuality?: { grade?: string | null; reasons?: string[] | null } | null;
  livePrice?: number | null;
};

function resolveLevels(plan: IntradayPlan) {
  const tp = plan.tradePlan;
  const zoneRaw = tp.entryZone != null ? String(tp.entryZone).trim() : "";
  const zoneAsNumber = zoneRaw ? Number(zoneRaw.replace(/,/g, "")) : NaN;
  const entry =
    zoneRaw && Number.isFinite(zoneAsNumber) && !/[–—-]/.test(zoneRaw)
      ? formatXauPrice(zoneAsNumber)
      : zoneRaw
        ? sanitizePlanText(zoneRaw)
        : plan.triggerPrice != null
          ? formatXauPrice(plan.triggerPrice)
          : sanitizePlanText(plan.trigger);
  const stop = tp.stopLoss ?? null;
  const tp1 = tp.tp1 ?? plan.nextTargetPrice ?? null;
  const tp2 = tp.tp2 ?? plan.afterThatTargetPrice ?? null;
  const rr = tp.riskReward ?? null;
  return { entry, stop, tp1, tp2, rr };
}

function primaryNoTradeReason(plan: IntradayPlan, marketStructureMode?: string | null): string {
  const mode = String(
    marketStructureMode ?? plan.freshness?.marketStructureMode ?? ""
  ).toUpperCase();
  if (mode === "MISMATCH") return "Price sources disagree";
  if (plan.geometryValid === false) return "Trade geometry is unsafe";
  const codes = plan.geometryReasonCodes ?? plan.planQuality?.reasons ?? [];
  const joined = codes.join(" ");
  if (/PRICE_ALREADY|AT_TARGET/i.test(joined)) return "Price is already too close to the target";
  if (/MISMATCH|CONFLICT|TIMEFRAME/i.test(joined)) return "Timeframes conflict";
  if (/STALE|AGE|FRESH/i.test(joined) || plan.freshness.dataQuality === "STALE") {
    return "Data is stale";
  }
  const msg = plainReason(plan.geometryMessage ?? codes[0] ?? plan.whyNotReady);
  if (/disagree|mismatch/i.test(msg)) return "Price sources disagree";
  if (/unsafe|geometry|validation|stop|risk/i.test(msg)) return "Trade geometry is unsafe";
  if (/target|tp1/i.test(msg)) return "Price is already too close to the target";
  if (/conflict|timeframe|align/i.test(msg)) return "Timeframes conflict";
  if (/stale/i.test(msg)) return "Data is stale";
  return msg || "Trade geometry is unsafe";
}

function validPlanHeadline(plan: IntradayPlan, shortLabel: string): string {
  const a = String(plan.action).toUpperCase();
  const label = shortLabel.toUpperCase();
  if (a === "NO_TRADE" || label === "NO TRADE") return "NO TRADE";
  if (a === "WAIT" || label === "WAIT") return "WAIT";
  if (label.includes("BUY NOW") || (a === "BUY_NOW" && label.includes("BUY"))) return "BUY NOW";
  if (label.includes("SELL NOW") || (a === "SELL_NOW" && label.includes("SELL"))) return "SELL NOW";
  if (a.includes("BUY") || label.includes("BUY")) {
    return /PULLBACK|RECLAIM/i.test(`${plan.actionLabel} ${plan.oneSentence}`)
      ? "BUY PULLBACK"
      : label.includes("BUY")
        ? label
        : "BUY PULLBACK";
  }
  if (a.includes("SELL") || label.includes("SELL")) {
    return /REJECT/i.test(`${plan.actionLabel} ${plan.oneSentence}`)
      ? "SELL REJECTION"
      : label.includes("SELL")
        ? label
        : "SELL REJECTION";
  }
  if (a === "PREPARE") return "WAIT";
  return shortLabel;
}

function directInstruction(plan: IntradayPlan, authLabel: string): string {
  const sentence = sanitizePlanText(plan.oneSentence) || sanitizePlanText(plan.whyNotReady);
  if (sentence) return sentence;
  const dir = String(plan.tradePlan.direction || plan.action).toUpperCase();
  if (dir.includes("BUY")) {
    return authLabel.toLowerCase().includes("confirm")
      ? "Wait for a bullish 5M close inside the entry zone."
      : "Manual long plan ready. Review risk before entering.";
  }
  if (dir.includes("SELL")) {
    return "Wait for a bearish 5M close inside the entry zone.";
  }
  return "Wait for the next verified plan update.";
}

/**
 * Single primary card for Today's Plan.
 * Never shows actionable BUY/SELL levels when geometry or quality fails.
 */
export function PrimaryPlanCard({
  plan,
  marketStructureMode,
  planQuality,
  livePrice
}: Props) {
  const quality = planQuality ?? plan.planQuality ?? null;
  const display = resolveDisplayAction(plan);
  const noValid = isNoValidIntradayPlan(
    { ...plan, planQuality: quality },
    marketStructureMode
  );
  const isNoTrade =
    !noValid &&
    (String(plan.action).toUpperCase() === "NO_TRADE" ||
      String(plan.planStatus ?? "").toUpperCase() === "NO_TRADE");
  const legacy = !noValid && !isNoTrade && isLegacyPlanData(plan);
  const levels = resolveLevels(plan);
  const showLevels =
    !noValid && !isNoTrade && plan.action !== "NO_TRADE" && plan.tradePlan.actionable;
  const auth = resolveAuthoritativeConfirmation({
    confirmationState: plan.confirmation5m?.state,
    direction: plan.tradePlan.direction || plan.action
  });
  const qualityGrade = quality?.grade ?? null;
  const status = plan.planStatus ? planStatusLabel(plan.planStatus) : null;
  const reasonCodes = plan.geometryReasonCodes?.length
    ? plan.geometryReasonCodes
    : quality?.reasons?.filter((r) =>
        /ENTRY_EQUALS_STOP|STOP_WRONG_SIDE|TP1_|ZERO_RISK|INVALID_TARGET|MISSING_REQUIRED|PRICE_ALREADY|TRADE_LEVELS_FAILED|STRUCTURE_ONLY|WAIT_NO_VALID/i.test(
          r
        )
      ) ?? [];
  const nearestSupport = plan.zones?.nearestSupport ?? null;
  const nearestResistance = plan.zones?.nearestResistance ?? null;
  const price = livePrice ?? plan.expectedRange.currentPrice;

  if (noValid) {
    const reason = plainReason(
      plan.geometryMessage ?? reasonCodes[0] ?? NO_VALID_PLAN_SAFETY_REASON
    );
    return (
      <section
        className="gm-primary-plan tone-unavailable gm-primary-plan-unified gm-plan-v2"
        data-testid="todays-intraday-plan"
        data-state="NO_VALID_PLAN"
        aria-label="Today's intraday plan"
      >
        <h2 className="gm-no-plan-title" data-testid="no-valid-plan-title">
          <span data-testid="intraday-action-short">{WAIT_NO_VALID_PLAN_LABEL}</span>
        </h2>
        <p className="gm-primary-plan-sentence" data-testid="no-valid-plan-next">
          {NO_VALID_PLAN_NEXT}
        </p>
        <details className="gm-wait-reason" data-testid="why-waiting">
          <summary>Why am I waiting?</summary>
          <p className="gm-primary-plan-sentence" data-testid="no-valid-plan-reason">
            {reason}
          </p>
        </details>
        <NextPlanUpdate plan={plan} />
        <div className="gm-nearest-sr" data-testid="no-valid-nearest-sr">
          <div>
            <span className="gm-label">Nearest support</span>
            <strong data-testid="nearest-support">{fmtPrice(nearestSupport)}</strong>
          </div>
          <div>
            <span className="gm-label">Nearest resistance</span>
            <strong data-testid="nearest-resistance">{fmtPrice(nearestResistance)}</strong>
          </div>
        </div>
        <p className="gm-meta" data-testid="no-valid-bias-note">
          Market bias is context only — not an entry signal.
        </p>
      </section>
    );
  }

  if (isNoTrade) {
    return (
      <section
        className="gm-primary-plan tone-notrade gm-primary-plan-unified gm-plan-v2 gm-no-trade-card"
        data-testid="todays-intraday-plan"
        data-state="NO_TRADE"
        data-tone="notrade"
        aria-label="Today's intraday plan"
      >
        <div className="gm-primary-action-row" data-testid="intraday-action-card" data-tone="notrade">
          <h2 className="gm-intra-action-label" data-testid="intraday-action-label">
            <span className="gm-action-icon" aria-hidden="true">
              {toneIcon("notrade")}
            </span>{" "}
            <span data-testid="intraday-action-short">NO TRADE</span>
          </h2>
        </div>
        <p className="gm-primary-plan-sentence" data-testid="no-trade-reason">
          <strong>Reason:</strong> {primaryNoTradeReason(plan, marketStructureMode)}
        </p>
        <NextPlanUpdate plan={plan} />
        <p className="gm-meta" data-testid="plan-levels-hidden">
          Entry, stop and targets are hidden while NO TRADE is active.
        </p>
      </section>
    );
  }

  const headline = validPlanHeadline(plan, display.shortLabel);
  const instruction = directInstruction(plan, auth.label);

  return (
    <section
      className={`gm-primary-plan gm-primary-plan-unified gm-plan-v2 tone-${display.tone}`}
      data-testid="todays-intraday-plan"
      data-tone={display.tone}
      data-demoted={display.demotedFromNow ? "1" : "0"}
      aria-label="Today's intraday plan"
    >
      <div className="gm-primary-action-row" data-testid="intraday-action-card" data-tone={display.tone}>
        <h2 className="gm-intra-action-label" data-testid="intraday-action-label">
          <span className="gm-action-icon" aria-hidden="true">
            {display.icon}
          </span>{" "}
          <span data-testid="intraday-action-short">{headline}</span>
        </h2>
        {plan.planUnchanged ? (
          <span className="gm-badge neutral" data-testid="plan-unchanged">
            Plan unchanged
          </span>
        ) : null}
      </div>

      {display.demotedFromNow ? (
        <p className="gm-meta" data-testid="action-now-gated" role="status">
          BUY NOW / SELL NOW stays gated until every mandatory checklist condition passes.
        </p>
      ) : null}

      {legacy && (
        <p className="gm-legacy-banner" data-testid="legacy-plan-banner" role="status">
          {LEGACY_PLAN_BANNER}
        </p>
      )}

      <div className="gm-what-now" data-testid="primary-what-to-do">
        <p className="gm-label">Current instruction</p>
        <p className="gm-primary-plan-sentence" data-testid="intraday-one-sentence">
          {instruction}
        </p>
      </div>

      {showLevels ? (
        <div className="gm-plan-levels-grid gm-plan-levels-2x2" data-testid="plan-levels-strip">
          <div data-testid="plan-level-entry">
            <span className="gm-label">Entry zone</span>
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
          <div className="gm-plan-rr" data-testid="plan-level-rr">
            <span className="gm-label">Risk : Reward</span>
            <strong className="gm-plan-price">{levels.rr ? sanitizePlanText(levels.rr) : "—"}</strong>
          </div>
        </div>
      ) : (
        <div className="gm-nearest-sr" data-testid="wait-nearest-sr">
          <div>
            <span className="gm-label">Nearest support</span>
            <strong data-testid="nearest-support">{fmtPrice(nearestSupport)}</strong>
          </div>
          <div>
            <span className="gm-label">Nearest resistance</span>
            <strong data-testid="nearest-resistance">{fmtPrice(nearestResistance)}</strong>
          </div>
          {price != null && (
            <div>
              <span className="gm-label">Live price</span>
              <strong>{fmtPrice(price)}</strong>
            </div>
          )}
          <p className="gm-meta" data-testid="plan-levels-hidden">
            No actionable entry, stop or targets while the plan is not tradeable.
          </p>
        </div>
      )}

      <NextPlanUpdate plan={plan} />

      {(qualityGrade || status) && (
        <div className="gm-primary-plan-facts gm-primary-plan-facts-compact">
          {qualityGrade && (
            <div>
              <span className="gm-label">Plan quality</span>
              <strong data-testid="primary-plan-quality">{qualityGrade}</strong>
            </div>
          )}
          {status && (
            <div>
              <span className="gm-label">Status</span>
              <strong data-testid="primary-plan-status">{status}</strong>
            </div>
          )}
        </div>
      )}

      <div className="gm-primary-plan-footer gm-desktop-only-links">
        <Link className="gm-linkish gm-sr-only-focusable" to="/help">
          Help
        </Link>
      </div>
    </section>
  );
}
