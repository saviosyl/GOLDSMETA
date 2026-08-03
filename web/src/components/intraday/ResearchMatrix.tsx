import { useEffect, useId, useState } from "react";
import type { IntradayPlan } from "../../types/intradayPlan";
import type { Decision } from "../../types/models";
import { buildResearchRows, type ResearchCell } from "../../lib/cockpitHelpers";

type Props = {
  plan: IntradayPlan;
  decision: Decision | null;
  scoreComponents?: Array<{ label: string; score: number; max: number; reason: string }> | null;
};

const COLUMNS = [
  "Trend",
  "Structure",
  "Momentum",
  "Volume",
  "Confirmation",
  "Position vs value"
] as const;

export function ResearchMatrix({ plan, decision, scoreComponents }: Props) {
  const rows = buildResearchRows({ plan, decision, scoreComponents });
  const [open, setOpen] = useState<{ tf: string; col: string; cell: ResearchCell } | null>(null);
  const panelId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <section
      className="gm-research-matrix"
      data-testid="research-matrix"
      aria-label="Market research matrix"
    >
      <div className="gm-section-head">
        <h2 className="gm-section-title">Market Research</h2>
        <span className="gm-meta">Verified fields only</span>
      </div>

      <div className="gm-research-scroll">
        <table className="gm-research-table">
          <thead>
            <tr>
              <th scope="col">TF</th>
              {COLUMNS.map((col) => (
                <th key={col} scope="col">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.tf} data-testid={`research-row-${row.tf}`}>
                <th scope="row">{row.tf}</th>
                {COLUMNS.map((col) => {
                  const cell = row.cells[col];
                  return (
                    <td key={col}>
                      <button
                        type="button"
                        className={`gm-research-cell state-${cell.state}`}
                        data-testid={`research-cell-${row.tf}-${col.replace(/\s+/g, "-").toLowerCase()}`}
                        aria-expanded={open?.tf === row.tf && open.col === col}
                        aria-controls={panelId}
                        onClick={() =>
                          setOpen(
                            open?.tf === row.tf && open.col === col
                              ? null
                              : { tf: row.tf, col, cell }
                          )
                        }
                      >
                        {cell.value}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div
          id={panelId}
          className="gm-action-drawer"
          role="dialog"
          aria-label={`${open.tf} ${open.col} explanation`}
          data-testid="research-cell-explain"
        >
          <strong>
            {open.tf} · {open.col}: {open.cell.value}
          </strong>
          <p>
            <span className="gm-label">What it means</span>
            {open.cell.meaning}
          </p>
          <p>
            <span className="gm-label">Why it matters</span>
            {open.cell.why}
          </p>
          <p>
            <span className="gm-label">Supports</span>
            {open.cell.supports}
          </p>
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
