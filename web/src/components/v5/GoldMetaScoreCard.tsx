import type { FreshnessState } from "./VerifiedDataMeta";
import { VerifiedDataMeta } from "./VerifiedDataMeta";

export type ScoreComponent = {
  label: string;
  score: number;
  max: number;
  reason: string;
};

export type GoldMetaScoreCardProps = {
  total?: number | null;
  components?: ScoreComponent[];
  disclaimer?: string | null;
  dataTimestamp?: string | null;
  environment?: string | null;
  strategyVersion?: string | null;
  mode?: string | null;
  freshness?: FreshnessState | null;
  insufficientData?: boolean;
};

const DEFAULT_DISCLAIMER =
  "GoldMeta Score is a rules-based setup-quality measurement. It is not the probability of a profitable trade.";

/** Transparent GoldMeta Score — never win probability / expected profit. */
export function GoldMetaScoreCard({
  total,
  components = [],
  disclaimer,
  dataTimestamp,
  environment = "LIVE",
  strategyVersion,
  mode = "SHADOW",
  freshness = "SHADOW",
  insufficientData
}: GoldMetaScoreCardProps) {
  if (insufficientData || total == null) {
    return (
      <div className="v5-score-block" data-testid="goldmeta-score">
        <div className="price-row">
          <span>GoldMeta Score</span>
          <strong>—</strong>
        </div>
        <div className="banner stale" role="status">
          Insufficient verified data.
        </div>
        <p className="muted" data-testid="score-disclaimer">
          {disclaimer ?? DEFAULT_DISCLAIMER}
        </p>
      </div>
    );
  }

  const missing = components.filter((c) => /not fully verified|incomplete|unknown|partial/i.test(c.reason));

  return (
    <div className="v5-score-block" data-testid="goldmeta-score">
      <div className="price-row">
        <span>GoldMeta Score</span>
        <strong>
          {total} / 100
        </strong>
      </div>
      <VerifiedDataMeta
        dataTimestamp={dataTimestamp}
        environment={environment}
        strategyVersion={strategyVersion}
        mode={mode}
        freshness={freshness ?? "SHADOW"}
        sources={["V4 shadow analysis"]}
        missingWarning={
          missing.length
            ? `${missing.length} component(s) missing full verified data — partial credit only.`
            : null
        }
      />
      <p className="muted" data-testid="score-disclaimer">
        {disclaimer ?? DEFAULT_DISCLAIMER}
      </p>
      <ul className="list compact" data-testid="score-components">
        {components.map((c) => (
          <li key={c.label}>
            <strong>
              {c.label} {c.score}/{c.max}
            </strong>
            <div className="muted">{c.reason}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
