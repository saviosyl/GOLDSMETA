import type { IntradayPlan } from "../../types/intradayPlan";
import { toneIcon } from "../../lib/planDisplay";
import {
  resolveAuthoritativeConfirmation,
  toConfirmation5m
} from "../../lib/confirmationAuthority";

type Props = {
  plan: IntradayPlan;
  decisionConfirmation?: string | null;
};

/**
 * 5M Entry Confirmation — authoritative state shared with the timeframe panel.
 */
export function Confirmation5MCard({ plan, decisionConfirmation }: Props) {
  const auth = resolveAuthoritativeConfirmation({
    confirmationState: plan.confirmation5m?.state ?? decisionConfirmation,
    candleClassification: decisionConfirmation,
    direction: plan.tradePlan.direction || plan.action
  });
  const conf = toConfirmation5m(auth);
  const tone = auth.tone;

  if (!conf.meaningful) {
    return (
      <section
        className="gm-confirm-5m tone-unavailable"
        data-testid="confirmation-5m-card"
        data-meaningful="0"
        aria-label="5 minute entry confirmation"
      >
        <div className="gm-section-head">
          <h2 className="gm-section-title">5M Confirmation</h2>
          <span className="gm-tone-pill tone-unavailable">
            <span aria-hidden="true">{toneIcon("unavailable")}</span> Unavailable
          </span>
        </div>
        <p className="gm-meta" data-testid="confirm-5m-detail">
          {conf.detail ?? "No meaningful 5-minute confirmation state yet."}
        </p>
      </section>
    );
  }

  return (
    <section
      className={`gm-confirm-5m tone-${tone}`}
      data-testid="confirmation-5m-card"
      data-meaningful="1"
      data-state={conf.state ?? "NONE"}
      aria-label="5 minute entry confirmation"
    >
      <div className="gm-section-head">
        <h2 className="gm-section-title">5M Confirmation</h2>
        <span className={`gm-tone-pill tone-${tone}`} data-testid="confirm-5m-state">
          <span aria-hidden="true">{toneIcon(tone)}</span> {conf.label}
        </span>
      </div>
      {conf.detail && (
        <p className="gm-confirm-detail" data-testid="confirm-5m-detail">
          {conf.detail}
        </p>
      )}
    </section>
  );
}
