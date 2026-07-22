import { Link } from "react-router-dom";
import type { OvernightReviewModel } from "../../lib/overnight";
import { formatLocalTimestamp } from "../../lib/timezone";

export function OvernightReviewCard({ review }: { review: OvernightReviewModel }) {
  if (review.candidatesCreated === 0 && !review.best) {
    return (
      <section className="gm-section" data-testid="overnight-review">
        <div className="gm-section-head">
          <h2 className="gm-section-title">Overnight Review</h2>
        </div>
        <p className="gm-meta" role="status">
          No overnight shadow setups in the recent window.
        </p>
        <p className="gm-meta">{review.disclaimer}</p>
      </section>
    );
  }

  return (
    <section className="gm-section" data-testid="overnight-review">
      <div className="gm-section-head">
        <h2 className="gm-section-title">Overnight Review</h2>
        <span className="gm-badge gold">SHADOW</span>
      </div>
      <p className="gm-meta">{review.analysesHint}</p>
      <div className="gm-metrics-grid gm-overnight-metrics">
        <div className="gm-metric">
          <span className="gm-label">Candidates</span>
          <span className="gm-metric-value">{review.candidatesCreated}</span>
        </div>
        <div className="gm-metric">
          <span className="gm-label">Validated plans</span>
          <span className="gm-metric-value">{review.validatedPlans}</span>
        </div>
      </div>
      {review.best && (
        <div className="gm-overnight-best" data-testid="overnight-best">
          <strong>Best-quality setup in window</strong>
          <p>
            {review.best.direction ?? "—"} · {review.best.resultLabel}
          </p>
          <p className="gm-meta">
            {formatLocalTimestamp(review.best.createdAt).label}
          </p>
          <Link className="gm-linkish" to={`/setups/${review.best.setupId}`}>
            Review the evidence
          </Link>
        </div>
      )}
      {review.items.length > 1 && (
        <ul className="list compact" data-testid="overnight-list">
          {review.items.slice(1).map((item) => (
            <li key={item.setupId}>
              <Link to={`/setups/${item.setupId}`}>
                {item.direction ?? "—"} · {item.resultLabel}
              </Link>
              <div className="gm-meta">{formatLocalTimestamp(item.createdAt).primary}</div>
            </li>
          ))}
        </ul>
      )}
      <p className="gm-meta gm-overnight-disclaimer" data-testid="overnight-disclaimer">
        {review.disclaimer}
      </p>
    </section>
  );
}
