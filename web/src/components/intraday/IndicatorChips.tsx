import { useEffect, useId, useState } from "react";
import type { IntradayPlan } from "../../types/intradayPlan";
import type { Decision } from "../../types/models";
import { buildIndicatorChips, type IndicatorChip } from "../../lib/cockpitHelpers";

type Props = {
  plan: IntradayPlan;
  decision: Decision | null;
  poc: number | null;
  vah: number | null;
  val: number | null;
  atrLabel?: string | null;
  atrValue?: number | null;
  scoreComponents?: Array<{ label: string; score: number; max: number; reason: string }> | null;
};

export function IndicatorChips(props: Props) {
  const chips = buildIndicatorChips(props);
  const [open, setOpen] = useState<IndicatorChip | null>(null);
  const panelId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!chips.length) {
    return (
      <section className="gm-indicator-chips" data-testid="indicator-chips" aria-label="Indicators">
        <p className="gm-meta">No verified indicator values in this update.</p>
      </section>
    );
  }

  return (
    <section className="gm-indicator-chips" data-testid="indicator-chips" aria-label="Indicators">
      <div className="gm-section-head">
        <h2 className="gm-section-title">Indicators</h2>
        <span className="gm-meta">Tap for plain-language help</span>
      </div>
      <div className="gm-indicator-row">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className={`gm-indicator-chip state-${chip.state}`}
            title={chip.tooltip}
            aria-expanded={open?.id === chip.id}
            aria-controls={panelId}
            data-testid={`indicator-chip-${chip.id}`}
            onClick={() => setOpen(open?.id === chip.id ? null : chip)}
          >
            <span className="gm-label">{chip.label}</span>
            <strong>{chip.value}</strong>
            <em>{chip.tooltip}</em>
          </button>
        ))}
      </div>
      {open && (
        <div
          id={panelId}
          className="gm-action-drawer"
          role="dialog"
          aria-label={`${open.label} explanation`}
          data-testid="indicator-explain"
        >
          <strong>
            {open.label} {open.value}
          </strong>
          <p>{open.explanation}</p>
          <button
            type="button"
            className="gm-btn-outline gm-drawer-close"
            onClick={() => setOpen(null)}
          >
            Close
          </button>
        </div>
      )}
    </section>
  );
}
