import type { IntradayPlan } from "../../types/intradayPlan";
import { actionTone, fmtDistance, fmtPrice } from "../../lib/intradayFormat";

type Props = {
  plan: IntradayPlan;
};

export function IntradayActionCard({ plan }: Props) {
  const tone = actionTone(plan.action);
  const progress = plan.setupProgress;

  return (
    <section
      className={`gm-intra-action tone-${tone}`}
      data-testid="intraday-action-card"
      aria-label="Current trading action"
    >
      <p className="gm-label">What should I do now?</p>
      <h2 className="gm-intra-action-label" data-testid="intraday-action-label">
        {plan.actionLabel}
      </h2>
      <p className="gm-intra-action-sentence" data-testid="intraday-one-sentence">
        {plan.oneSentence}
      </p>

      <div className="gm-intra-action-grid">
        <div>
          <span className="gm-label">Trigger</span>
          <strong data-testid="intraday-trigger">{plan.trigger ?? "—"}</strong>
          {plan.triggerPrice != null && (
            <span className="gm-meta">
              {fmtPrice(plan.triggerPrice)} · {fmtDistance(plan.distanceToTriggerPoints)}
            </span>
          )}
        </div>
        <div>
          <span className="gm-label">Next target</span>
          <strong data-testid="intraday-next-target">{plan.nextTarget ?? "—"}</strong>
        </div>
        <div className="gm-intra-action-span">
          <span className="gm-label">Invalidation</span>
          <strong data-testid="intraday-invalidation">{plan.invalidation}</strong>
        </div>
      </div>

      {plan.entryConfirmation.length > 0 && (
        <div className="gm-intra-confirm" data-testid="intraday-entry-confirmation">
          <span className="gm-label">Confirmation still required</span>
          <ul>
            {plan.entryConfirmation.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="gm-intra-progress" data-testid="intraday-setup-progress">
        <div className="gm-intra-progress-head">
          <span className="gm-label">Setup progress</span>
          <strong>{progress.label}</strong>
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
        <ul className="gm-intra-checklist">
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
      </div>

      {plan.whyNotReady && (
        <p className="gm-intra-why-not" data-testid="intraday-why-not-ready" role="status">
          <strong>Why not ready:</strong> {plan.whyNotReady}
        </p>
      )}
    </section>
  );
}
