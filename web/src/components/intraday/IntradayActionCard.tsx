import { useEffect, useId, useState } from "react";
import type { IntradayPlan } from "../../types/intradayPlan";
import { actionTone, fmtPrice, valueLocationLabel } from "../../lib/intradayFormat";
import { shortActionLabel } from "../../lib/cockpitHelpers";

function fmtDistanceAbs(points: number | null | undefined): string {
  if (points == null || !Number.isFinite(points)) return "—";
  if (points === 0) return "At price";
  return `${Math.abs(points).toFixed(1)} pts away`;
}

type Panel = "why" | "waiting" | "checklist" | null;

type Props = {
  plan: IntradayPlan;
};

export function IntradayActionCard({ plan }: Props) {
  const tone = actionTone(plan.action);
  const progress = plan.setupProgress;
  const [panel, setPanel] = useState<Panel>(null);
  const panelId = useId();
  const short = shortActionLabel(plan.action, plan.actionLabel);

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
      className={`gm-intra-action tone-${tone}`}
      data-testid="intraday-action-card"
      aria-label="Current trading action"
    >
      <div className="gm-action-top">
        <div>
          <p className="gm-label">What should I do now?</p>
          <h2 className="gm-intra-action-label" data-testid="intraday-action-label">
            <span data-testid="intraday-action-short">{short}</span>
            {plan.actionLabel !== short && (
              <span className="gm-action-sublabel">{plan.actionLabel}</span>
            )}
          </h2>
          <p className="gm-intra-action-sentence" data-testid="intraday-one-sentence">
            {plan.oneSentence}
          </p>
          {plan.valueLocation && (
            <p className="gm-meta" data-testid="intraday-value-location">
              {valueLocationLabel(plan.valueLocation)}
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
          <button
            type="button"
            className="gm-chip-btn"
            aria-expanded={panel === "checklist"}
            aria-controls={panelId}
            data-testid="action-checklist-btn"
            onClick={() => toggle("checklist")}
          >
            Show checklist
          </button>
        </div>
      </div>

      <div className="gm-intra-action-grid gm-action-keyfacts">
        <div>
          <span className="gm-label">Trigger</span>
          <strong data-testid="intraday-trigger">{plan.trigger ?? "—"}</strong>
          {plan.triggerPrice != null && (
            <span className="gm-meta">
              {fmtPrice(plan.triggerPrice)} · {fmtDistanceAbs(plan.distanceToTriggerPoints)}
            </span>
          )}
        </div>
        <div>
          <span className="gm-label">Confirmation</span>
          <strong data-testid="intraday-confirmation-summary">
            {plan.entryConfirmation[0] ?? "None listed"}
          </strong>
        </div>
        <div>
          <span className="gm-label">Nearest target</span>
          <strong data-testid="intraday-next-target">{plan.nextTarget ?? "—"}</strong>
        </div>
        <div>
          <span className="gm-label">Invalidation</span>
          <strong data-testid="intraday-invalidation">{plan.invalidation}</strong>
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

      <div className="gm-intra-progress" data-testid="intraday-setup-progress">
        <div className="gm-intra-progress-head">
          <span className="gm-label">Setup progress</span>
          <strong>
            {progress.complete} / {progress.total} conditions complete
          </strong>
        </div>
        <div
          className="gm-intra-progress-bar"
          role="progressbar"
          aria-valuenow={progress.complete}
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-label={progress.label}
        >
          <i style={{ width: `${(progress.complete / Math.max(progress.total, 1)) * 100}%` }} />
        </div>
      </div>

      {panel && (
        <div
          id={panelId}
          className="gm-action-drawer"
          role="region"
          aria-label={
            panel === "why"
              ? "Why this action"
              : panel === "waiting"
                ? "What you are waiting for"
                : "Setup checklist"
          }
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
          {panel === "checklist" && (
            <ul className="gm-intra-checklist" data-testid="intraday-entry-confirmation">
              {progress.items.map((item) => (
                <li key={item.id} data-complete={item.complete ? "1" : "0"}>
                  <span aria-hidden="true">{item.complete ? "✓" : "○"}</span>
                  <span>
                    <strong>{item.label}</strong>
                    <em className="gm-meta">{item.detail}</em>
                  </span>
                </li>
              ))}
            </ul>
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
          <strong>Why not ready:</strong> {plan.whyNotReady}
        </p>
      )}
    </section>
  );
}
