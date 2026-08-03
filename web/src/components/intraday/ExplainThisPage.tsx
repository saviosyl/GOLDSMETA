import { useEffect, useId, useState } from "react";
import { PAGE_EXPLAINERS } from "../../lib/cockpitHelpers";

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
        Explain this page
      </button>
      {open && (
        <div
          id={panelId}
          className="gm-action-drawer"
          role="dialog"
          aria-label="Page explanation"
          data-testid="explain-page-panel"
        >
          <ul className="gm-explain-list">
            {PAGE_EXPLAINERS.map((item) => (
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
