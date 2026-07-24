import type { FriendlyErrorDetail } from "../lib/errors";

/** Structured error banner: what happened, impact, next step + collapsed technical details. */
export function FriendlyErrorBanner({
  detail,
  onRetry,
  testId = "friendly-error"
}: {
  detail: FriendlyErrorDetail;
  onRetry?: () => void;
  testId?: string;
}) {
  return (
    <div className="banner error gm-friendly-error" role="alert" data-testid={testId}>
      <p className="gm-friendly-error-title">{detail.message}</p>
      <ul className="gm-friendly-error-list">
        <li>
          <strong>What happened:</strong> {detail.whatHappened}
        </li>
        <li>
          <strong>Impact:</strong> {detail.impact}
        </li>
        <li>
          <strong>What to do:</strong> {detail.nextStep}
        </li>
      </ul>
      {onRetry ? (
        <button type="button" className="gm-btn gm-btn-secondary" onClick={onRetry}>
          Retry
        </button>
      ) : null}
      {detail.technical ? (
        <details className="gm-disclosure" data-testid={`${testId}-technical`}>
          <summary>Technical details</summary>
          <div className="gm-disclosure-body">
            <p className="gm-meta" style={{ margin: 0, wordBreak: "break-word" }}>
              {detail.technical}
            </p>
          </div>
        </details>
      ) : null}
    </div>
  );
}
