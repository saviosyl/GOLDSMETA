import type { IntradayPlan } from "../../types/intradayPlan";
import {
  deriveTimeframeAlignment,
  toneIcon,
  type PlanColourTone
} from "../../lib/planDisplay";

type Props = {
  plan: IntradayPlan;
};

function cellTone(raw: string | null | undefined): PlanColourTone {
  const t = (raw || "info").toLowerCase();
  if (t === "buy" || t === "sell" || t === "wait" || t === "info" || t === "unavailable") {
    return t;
  }
  if (t === "none") return "unavailable";
  return "info";
}

export function TimeframeAlignmentPanel({ plan }: Props) {
  const alignment = deriveTimeframeAlignment(plan);

  return (
    <section
      className="gm-tf-alignment"
      data-testid="timeframe-alignment"
      aria-label="Timeframe alignment"
    >
      <div className="gm-section-head">
        <h2 className="gm-section-title">Timeframe alignment</h2>
        <span className="gm-meta">4H · 1H · 15M · 5M</span>
      </div>
      <div className="gm-tf-grid" role="list">
        {alignment.cells.map((cell) => {
          const tone = cellTone(cell.tone);
          return (
            <article
              key={cell.timeframe}
              className={`gm-tf-cell tone-${tone}`}
              data-testid={`tf-cell-${cell.timeframe}`}
              role="listitem"
            >
              <span className="gm-tf-name">
                <span aria-hidden="true">{toneIcon(tone)}</span> {cell.timeframe}
              </span>
              <strong>{cell.direction ?? "—"}</strong>
              {cell.label && <em className="gm-meta">{cell.label}</em>}
            </article>
          );
        })}
      </div>
      <p className="gm-tf-conclusion" data-testid="tf-alignment-conclusion">
        <strong>Conclusion:</strong> {alignment.conclusion}
      </p>
    </section>
  );
}
