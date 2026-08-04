import type { IntradayPlan } from "../../types/intradayPlan";
import { checklistMark, checklistMarkGlyph } from "../../lib/planDisplay";

type Props = {
  plan: IntradayPlan;
};

export function SetupChecklist({ plan }: Props) {
  const progress = plan.setupProgress;
  const items = progress.items.slice(0, 6);

  return (
    <section
      className="gm-setup-checklist"
      data-testid="setup-checklist"
      aria-label="Six-condition checklist"
    >
      <div className="gm-section-head">
        <h2 className="gm-section-title">Six-condition checklist</h2>
        <strong className="gm-checklist-count" data-testid="checklist-progress">
          {progress.complete}/{progress.total}
        </strong>
      </div>
      <ul className="gm-intra-checklist gm-checklist-visible">
        {items.map((item) => {
          const mark = checklistMark(item);
          return (
            <li
              key={item.id}
              data-mark={mark}
              data-complete={mark === "pass" ? "1" : "0"}
              data-testid={`checklist-item-${item.id}`}
            >
              <span className={`gm-check-mark tone-${mark}`} aria-hidden="true">
                {checklistMarkGlyph(mark)}
              </span>
              <span>
                <strong>{item.label}</strong>
                <em className="gm-meta">{item.detail}</em>
                <span className="gm-sr-only">
                  {mark === "pass" ? "Pass" : mark === "fail" ? "Fail" : "Pending"}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
