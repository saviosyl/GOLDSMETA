import { useEffect, useState } from "react";

type Props = {
  onUpdate: () => void;
  onDismiss: () => void;
};

/**
 * Friendly PWA update prompt. Does not force-reload while the user may be
 * editing journal text (checks active element / form focus).
 */
export function UpdateBanner({ onUpdate, onDismiss }: Props) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setVisible(false);
        onDismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  if (!visible) return null;

  const safeUpdate = () => {
    const el = document.activeElement;
    const inJournal =
      el instanceof HTMLElement &&
      (el.closest('[data-testid="journal-page"]') != null ||
        el.tagName === "TEXTAREA" ||
        (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "button"));
    if (inJournal) {
      // Defer — do not interrupt journal entry.
      return;
    }
    onUpdate();
  };

  return (
    <div className="update-banner" role="status" aria-live="polite" data-testid="update-banner">
      <p>A new version of GoldMeta is available — Update now</p>
      <div className="btn-row">
        <button type="button" className="btn primary" onClick={safeUpdate}>
          Update now
        </button>
        <button type="button" className="btn" onClick={() => { setVisible(false); onDismiss(); }}>
          Later
        </button>
      </div>
    </div>
  );
}
