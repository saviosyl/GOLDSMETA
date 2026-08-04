import { useEffect, useId, useState } from "react";
import type { IntradayPlan } from "../../types/intradayPlan";
import { valueLocationLabel } from "../../lib/intradayFormat";
import { formatLevelWithOptionalPrice, sanitizePlanText } from "../../lib/planTextFormat";
import { resolveDisplayAction } from "../../lib/planDisplay";

function fmtDistanceAbs(points: number | null | undefined): string {
  if (points == null || !Number.isFinite(points)) return "—";
  if (points === 0) return "At price";
  return `${Math.abs(points).toFixed(1)} pts away`;
}

type Panel = "why" | "waiting" | null;

type Props = {
  plan: IntradayPlan;
};

export function IntradayActionCard({ plan }: Props) {
  const display = resolveDisplayAction(plan);
  const [panel, setPanel] = useState<Panel>(null);
  const panelId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = (next: Panel) => setPanel((cur) => (cur === next ? null : next));

  return (
    <section
      className={`gm-intra-action tone-${display.tone}`}
      data-testid="intraday-action-card"
      data-tone={display.tone}
      data-demoted={display.demotedFromNow ? "1" : "0"}
      aria-label="Current trading action"
    >
      <div className="gm-action-top">
        <div>
          <p className="gm-label">What should I do now?</p>
          <h2 className="gm-intra-action-label" data-testid="intraday-action-label">
            <span className="gm-action-icon" aria-hidden="true">
              {display.icon}
            </span>{" "}
            <span data-testid="intraday-action-short">{display.shortLabel}</span>
            {display.fullLabel !== display.shortLabel && (
              <span className="gm-action-sublabel">{display.fullLabel}</span>
            )}
          </h2>
          <p className="gm-intra-action-sentence" data-testid="intraday-one-sentence">
            {sanitizePlanText(plan.oneSentence)}
          </p>
          {plan.valueLocation && (
            <p className="gm-meta" data-testid="intraday-value-location">
              {valueLocationLabel(plan.valueLocation)}
            </p>
          )}
          {display.demotedFromNow && (
            <p className="gm-meta" data-testid="action-now-gated" role="status">
              BUY NOW / SELL NOW only when all six conditions pass.
            </p>
          )}
        </div>
        <div className="gm-action-controls" role="toolbar" aria-label="Action explainers">
          <button
            type="button"
            className="gm-chip-btn"
            aria-expanded={panel === "why"}
            aria-controls={panelId}
            data-testid="action-why-btn"
            onClick={() => toggle("why")}
          >
            Why?
          </button>
          <button
            type="button"
            className="gm-chip-btn"
            aria-expanded={panel === "waiting"}
            aria-controls={panelId}
            data-testid="action-waiting-btn"
            onClick={() => toggle("waiting")}
          >
            What am I waiting for?
          </button>
        </div>
      </div>

      <div className="gm-intra-action-grid gm-action-keyfacts">
        <div>
          <span className="gm-label">Trigger</span>
          <strong data-testid="intraday-trigger">
            {formatLevelWithOptionalPrice(plan.trigger, plan.triggerPrice)}
          </strong>
          {plan.triggerPrice != null && (
            <span className="gm-meta">{fmtDistanceAbs(plan.distanceToTriggerPoints)}</span>
          )}
        </div>
        <div>
          <span className="gm-label">Confirmation</span>
          <strong data-testid="intraday-confirmation-summary">
            {sanitizePlanText(plan.entryConfirmation[0]) || "None listed"}
          </strong>
        </div>
        <div>
          <span className="gm-label">Nearest target</span>
          <strong data-testid="intraday-next-target">
            {formatLevelWithOptionalPrice(plan.nextTarget, plan.nextTargetPrice)}
          </strong>
        </div>
        <div>
          <span className="gm-label">Invalidation</span>
          <strong data-testid="intraday-invalidation">{sanitizePlanText(plan.invalidation)}</strong>
        </div>
      </div>
      {(plan.afterThatTarget || plan.majorTarget) && (
        <div className="gm-action-secondary-targets gm-desktop-only">
          {plan.afterThatTarget && (
            <span>
              After that: <strong data-testid="intraday-after-that">{plan.afterThatTarget}</strong>
            </span>
          )}
          {plan.majorTarget && (
            <span>
              Major: <strong data-testid="intraday-major-target">{plan.majorTarget}</strong>
            </span>
          )}
        </div>
      )}

      {panel && (
        <div
          id={panelId}
          className="gm-action-drawer"
          role="region"
          aria-label={panel === "why" ? "Why this action" : "What you are waiting for"}
          data-testid={`action-panel-${panel}`}
        >
          {panel === "why" && (
            <>
              <p>{plan.whyNotReady ?? plan.oneSentence}</p>
              {plan.entryConfirmation.length > 0 && (
                <ul>
                  {plan.entryConfirmation.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </>
          )}
          {panel === "waiting" && (
            <>
              <p>
                <strong>Trigger:</strong> {plan.trigger ?? "No trigger yet"}
              </p>
              <p>
                <strong>Then confirm:</strong>{" "}
                {plan.entryConfirmation.join("; ") || "No confirmation steps listed"}
              </p>
              <p className="gm-meta">
                Conditional scenarios are research only — never an active order ticket.
              </p>
            </>
          )}
          <button
            type="button"
            className="gm-btn-outline gm-drawer-close"
            onClick={() => setPanel(null)}
          >
            Close
          </button>
        </div>
      )}

      {plan.whyNotReady && (
        <p className="gm-meta gm-why-compact" data-testid="intraday-why-not-ready" role="status">
          <strong>Why not ready:</strong> {sanitizePlanText(plan.whyNotReady)}
        </p>
      )}
    </section>
  );
}
