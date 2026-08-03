import type { ExpectedRange } from "../../types/intradayPlan";
import { fmtPrice } from "../../lib/intradayFormat";

type Props = {
  range: ExpectedRange;
};

function pctAlong(value: number | null, low: number | null, high: number | null): number {
  if (value == null || low == null || high == null || high <= low) return 50;
  return Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100));
}

export function ExpectedRangeCard({ range }: Props) {
  const stretchLow = range.stretchLow ?? range.probableLow;
  const stretchHigh = range.stretchHigh ?? range.probableHigh;
  const markerPct = pctAlong(range.currentPrice, stretchLow, stretchHigh);
  const probLowPct = pctAlong(range.probableLow, stretchLow, stretchHigh);
  const probHighPct = pctAlong(range.probableHigh, stretchLow, stretchHigh);

  return (
    <section className="gm-intra-range" data-testid="expected-range-card" aria-label="Expected intraday range">
      <div className="gm-section-head">
        <h2 className="gm-section-title">Expected range (estimates)</h2>
        <span className="gm-meta">Confidence {range.confidence}%</span>
      </div>

      <div className="gm-intra-range-labels">
        <span>
          Probable low
          <strong data-testid="range-probable-low">{fmtPrice(range.probableLow)}</strong>
        </span>
        <span>
          Current
          <strong data-testid="range-current">{fmtPrice(range.currentPrice)}</strong>
        </span>
        <span>
          Probable high
          <strong data-testid="range-probable-high">{fmtPrice(range.probableHigh)}</strong>
        </span>
      </div>

      <div className="gm-intra-range-track" data-testid="range-track">
        <div
          className="gm-intra-range-probable"
          style={{ left: `${probLowPct}%`, width: `${Math.max(2, probHighPct - probLowPct)}%` }}
        />
        <div className="gm-intra-range-marker" style={{ left: `${markerPct}%` }} aria-hidden="true" />
      </div>

      <div className="gm-intra-range-stretch">
        <span>
          Stretch low <strong data-testid="range-stretch-low">{fmtPrice(range.stretchLow)}</strong>
        </span>
        <span>
          Stretch high <strong data-testid="range-stretch-high">{fmtPrice(range.stretchHigh)}</strong>
        </span>
      </div>

      <div className="gm-intra-range-remain" data-testid="range-remaining">
        <span>
          Remaining above:{" "}
          <strong>
            {range.remainingAbovePoints != null
              ? `${range.remainingAbovePoints.toFixed(1)} pts (${range.remainingAbovePercent ?? "—"}%)`
              : "—"}
          </strong>
        </span>
        <span>
          Remaining below:{" "}
          <strong>
            {range.remainingBelowPoints != null
              ? `${range.remainingBelowPoints.toFixed(1)} pts (${range.remainingBelowPercent ?? "—"}%)`
              : "—"}
          </strong>
        </span>
      </div>

      {range.reasons.length > 0 && (
        <ul className="gm-intra-range-reasons" data-testid="range-reasons">
          {range.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <p className="gm-meta" data-testid="range-invalidation">
        Recalculate when: {range.invalidation}
      </p>
      <p className="gm-meta" data-testid="range-disclaimer">
        {range.estimateDisclaimer}
      </p>
    </section>
  );
}
