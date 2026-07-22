import { useState } from "react";
import { Link } from "react-router-dom";
import type { OvernightReviewModel } from "../../lib/overnight";
import { formatLocalTimestamp } from "../../lib/timezone";

export function OvernightReviewCard({ review }: { review: OvernightReviewModel }) {
  const [open, setOpen] = useState(false);
  const relevant = review.candidatesCreated > 0 || Boolean(review.best);

  if (!relevant) {
    return null;
  }

  return (
    <section className="gm-section" data-testid="overnight-review">
      <div className="gm-section-head">
        <h2 className="gm-section-title">Overnight Review</h2>
        <span className="gm-badge research">SHADOW</span>
      </div>
      <button
        type="button"
        className="gm-overnight-summary"
        data-testid="overnight-summary"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <strong>
          {review.candidatesCreated} candidate{review.candidatesCreated === 1 ? "" : "s"} ·{" "}
          {review.validatedPlans} validated plan{review.validatedPlans === 1 ? "" : "s"} ·{" "}
          {Math.max(0, review.candidatesCreated - review.validatedPlans)} rejected
        </strong>
        <span className="gm-meta">{open ? "Hide details" : "Show details"}</span>
      </button>
      {open && (
        <div data-testid="overnight-expanded">
          <p className="gm-meta">{review.analysesHint}</p>
          {review.best && (
            <div className="gm-overnight-best" data-testid="overnight-best">
              <strong>Best-quality setup in window</strong>
              <p>
                {review.best.direction ?? "—"} · {review.best.resultLabel}
              </p>
              <p className="gm-meta">{formatLocalTimestamp(review.best.createdAt).primary}</p>
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
        </div>
      )}
    </section>
  );
}
