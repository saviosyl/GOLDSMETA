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

/** Compact readiness chips for the five priority factors. */
function readinessItems(components: ScoreComponent[]) {
  const wanted = ["Structure", "Confirmation", "Risk", "Trend", "Profile"];
  const sorted = sortScoreComponents(components);
  const picked: Array<{ label: string; status: string }> = [];
  for (const want of wanted) {
    const match = sorted.find(
      (c) =>
        c.label.toLowerCase().includes(want.toLowerCase()) ||
        (want === "Structure" && /market structure/i.test(c.label)) ||
        (want === "Profile" && /volume profile/i.test(c.label)) ||
        (want === "Risk" && /risk/i.test(c.label))
    );
    if (match) {
      const s = classifyScoreComponent(match.score, match.max, match.reason);
      picked.push({ label: want, status: s.status });
    }
  }
  return picked;
}

export function ScoreBreakdown({
  total,
  components = [],
  disclaimer,
  defaultExpanded = false
}: {
  total?: number | null;
  components?: ScoreComponent[];
  disclaimer?: string | null;
  /** When false (default), only readiness row shows until expanded. */
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showAll, setShowAll] = useState(false);
  const ordered = useMemo(() => sortScoreComponents(components), [components]);
  const overall = classifyOverallScore(total);
  const readiness = useMemo(() => readinessItems(components), [components]);

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

  const visible = !showAll ? ordered.slice(0, 5) : ordered;

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
          {overall.label === "SETUP INCOMPLETE"
            ? "Setup incomplete"
            : overall.label.charAt(0) + overall.label.slice(1).toLowerCase()}
        </span>
      </div>
      <div
        className={`gm-score-progress band-${overall.band} gm-anim-progress`}
        role="progressbar"
        aria-valuenow={total}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`GoldMeta Score ${total} of 100`}
      >
        <div style={{ width: `${Math.min(100, Math.max(0, total))}%` }} />
      </div>

      {readiness.length > 0 && (
        <div className="gm-readiness-row" data-testid="score-readiness">
          {readiness.map((r) => (
            <span key={r.label} className={`gm-readiness-chip status-${r.status}`}>
              <span className={`gm-score-dot status-${r.status}`} aria-hidden />
              {r.label}
              <span className="gm-visually-hidden">{r.status}</span>
            </span>
          ))}
        </div>
      )}

      <p className="gm-meta" data-testid="score-disclaimer">
        {disclaimer ?? DEFAULT_DISCLAIMER}
      </p>

      {!expanded ? (
        <button
          type="button"
          className="gm-linkish"
          data-testid="score-expand"
          onClick={() => setExpanded(true)}
        >
          View full score breakdown
        </button>
      ) : (
        <>
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
          {ordered.length > 5 && (
            <button
              type="button"
              className="gm-linkish"
              data-testid="score-toggle"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "Show less" : "Show all components"}
            </button>
          )}
          <button
            type="button"
            className="gm-linkish"
            style={{ marginLeft: 12 }}
            data-testid="score-collapse"
            onClick={() => {
              setExpanded(false);
              setShowAll(false);
            }}
          >
            Hide breakdown
          </button>
        </>
      )}
    </div>
  );
}
