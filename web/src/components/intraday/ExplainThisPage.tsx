import { useEffect, useId, useState } from "react";
import { PAGE_EXPLAINERS } from "../../lib/cockpitHelpers";

const PLAN_EXPLAINERS: Array<{ title: string; body: string }> = [
  {
    title: "Today's Intraday Plan",
    body: "The primary plan for this session — direction, trigger, invalidation and first target. It is analysis only; AutoTrade stays OFF."
  },
  {
    title: "Colour meanings",
    body: "Green = buy bias. Amber = wait. Red = sell bias. Dark red = no trade. Grey = unavailable. Navy = info / range context. Every state also shows an icon and text."
  },
  {
    title: "BUY NOW / SELL NOW",
    body: "These labels appear only when all six checklist conditions pass. Otherwise GoldMeta shows WAIT so you do not chase an incomplete setup."
  },
  {
    title: "5M Confirmation",
    body: "A meaningful 5-minute state change after the 15-minute plan. Quiet or unchanged bars stay hidden so the card does not spam noise."
  },
  {
    title: "Alternative Scenario",
    body: "The opposite research path, kept collapsed so it never competes with the primary plan. It is never an order ticket."
  },
  ...PAGE_EXPLAINERS
];

export function ExplainThisPage() {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="gm-explain-page" data-testid="explain-this-page">
      <button
        type="button"
        className="gm-chip-btn"
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="explain-page-btn"
        onClick={() => setOpen((v) => !v)}
      >
        Explain this plan
      </button>
      {open && (
        <div
          id={panelId}
          className="gm-action-drawer"
          role="dialog"
          aria-label="Plan explanation for beginners"
          data-testid="explain-page-panel"
        >
          <ul className="gm-explain-list">
            {PLAN_EXPLAINERS.map((item) => (
              <li key={item.title}>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="gm-btn-outline gm-drawer-close"
            onClick={() => setOpen(false)}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
