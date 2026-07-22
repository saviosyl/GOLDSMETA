import { useMemo, useState } from "react";
import {
  classifyOverallScore,
  classifyScoreComponent,
  sortScoreComponents
} from "../../lib/scoreStatus";

export type ScoreComponent = {
  label: string;
  score: number;
  max: number;
  reason: string;
};

const DEFAULT_DISCLAIMER =
  "GoldMeta Score is a rules-based quality score, not the probability of profit.";

const MOBILE_PREVIEW = 5;

export function ScoreBreakdown({
  total,
  components = [],
  disclaimer,
  compact = true
}: {
  total?: number | null;
  components?: ScoreComponent[];
  disclaimer?: string | null;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const ordered = useMemo(() => sortScoreComponents(components), [components]);
  const overall = classifyOverallScore(total);

  if (total == null) {
    return (
      <div className="gm-score-breakdown" data-testid="goldmeta-score">
        <div className="banner stale" role="status">
          Insufficient verified data.
        </div>
        <p className="gm-meta" data-testid="score-disclaimer">
          {disclaimer ?? DEFAULT_DISCLAIMER}
        </p>
      </div>
    );
  }

  const visible = compact && !expanded ? ordered.slice(0, MOBILE_PREVIEW) : ordered;
  const canToggle = compact && ordered.length > MOBILE_PREVIEW;

  return (
    <div className="gm-score-breakdown" data-testid="goldmeta-score">
      <div className="gm-score-summary" data-testid="score-summary">
        <div>
          <span className="gm-label">GoldMeta Score</span>
          <strong className="gm-score-total">
            {total} / 100
          </strong>
        </div>
        <span className={`gm-score-band band-${overall.band}`} data-testid="score-band">
          {overall.label}
        </span>
      </div>
      <div
        className={`gm-score-progress band-${overall.band}`}
        role="progressbar"
        aria-valuenow={total}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`GoldMeta Score ${total} of 100`}
      >
        <div style={{ width: `${Math.min(100, Math.max(0, total))}%` }} />
      </div>
      <p className="gm-meta" data-testid="score-disclaimer">
        {disclaimer ?? DEFAULT_DISCLAIMER}
      </p>
      <ul className="gm-score-rows" data-testid="score-components">
        {visible.map((c) => {
          const status = classifyScoreComponent(c.score, c.max, c.reason);
          return (
            <li
              key={c.label}
              className={`gm-score-row status-${status.status}`}
              data-testid={`score-row-${c.label.replace(/\s+/g, "-").toLowerCase()}`}
            >
              <div className="gm-score-row-top">
                <span className={`gm-score-dot status-${status.status}`} aria-hidden />
                <span className="gm-score-name">{c.label}</span>
                <span className="gm-score-value">
                  {c.score} / {c.max}
                </span>
              </div>
              <div className="gm-score-row-meta">
                <span className={`gm-score-status status-${status.status}`}>{status.label}</span>
                <span className="gm-meta">{c.reason}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {canToggle && (
        <button
          type="button"
          className="gm-linkish"
          data-testid="score-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : "Show all components"}
        </button>
      )}
    </div>
  );
}
