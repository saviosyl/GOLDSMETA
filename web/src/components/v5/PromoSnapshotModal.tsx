import { useEffect, useId, useRef } from "react";
import {
  SNAPSHOT_FORMATS,
  type SnapshotFormatId,
  type SnapshotOptions,
  type SnapshotTheme
} from "../../lib/promoSnapshot";
import type { SnapshotStatus } from "../../hooks/usePromoSnapshot";

export type PromoSnapshotModalProps = {
  open: boolean;
  onClose: () => void;
  options: SnapshotOptions;
  onOptionsChange: (patch: Partial<SnapshotOptions>) => void;
  status: SnapshotStatus;
  statusMessage: string;
  previewUrl: string | null;
  generating: boolean;
  onShare: () => void;
  onDownload: () => void;
};

/** Accessible modal for Market Snapshot preview, share, and download. */
export function PromoSnapshotModal({
  open,
  onClose,
  options,
  onOptionsChange,
  status,
  statusMessage,
  previewUrl,
  generating,
  onShare,
  onDownload
}: PromoSnapshotModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], select, input, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable.length) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="gm-snapshot-overlay" role="presentation" data-testid="promo-snapshot-overlay">
      <div
        className="gm-snapshot-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        data-testid="promo-snapshot-modal"
      >
        <div className="gm-snapshot-modal-head">
          <h2 id={titleId} className="gm-section-title">
            Share Market Report
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="gm-linkish"
            aria-label="Close report preview"
            data-testid="promo-snapshot-close"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <p className="gm-visually-hidden" role="status" aria-live="polite">
          {statusMessage}
        </p>
        <p className="gm-meta" data-testid="promo-snapshot-status">
          {statusMessage || (status === "idle" ? "" : status)}
        </p>

        <div className="gm-snapshot-controls">
          <label className="gm-snapshot-field">
            <span className="gm-label">Format</span>
            <select
              data-testid="promo-snapshot-format"
              value={options.formatId}
              disabled={generating}
              onChange={(e) =>
                onOptionsChange({ formatId: e.target.value as SnapshotFormatId })
              }
            >
              {SNAPSHOT_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label} ({f.width}×{f.height})
                </option>
              ))}
            </select>
          </label>
          <label className="gm-snapshot-field">
            <span className="gm-label">Style</span>
            <select
              data-testid="promo-snapshot-theme"
              value={options.theme}
              disabled={generating}
              onChange={(e) => onOptionsChange({ theme: e.target.value as SnapshotTheme })}
            >
              <option value="light">Light branded</option>
              <option value="dark">Dark branded</option>
            </select>
          </label>
        </div>

        <div className="gm-snapshot-toggles" role="group" aria-label="Snapshot sections">
          <label>
            <input
              type="checkbox"
              checked={options.showStory}
              disabled={generating}
              onChange={(e) => onOptionsChange({ showStory: e.target.checked })}
            />
            Market Story
          </label>
          <label>
            <input
              type="checkbox"
              checked={options.showPlan}
              disabled={generating}
              onChange={(e) => onOptionsChange({ showPlan: e.target.checked })}
            />
            Trade Plan
          </label>
          <label>
            <input
              type="checkbox"
              checked={options.showScoreBreakdown}
              disabled={generating}
              onChange={(e) => onOptionsChange({ showScoreBreakdown: e.target.checked })}
            />
            Score breakdown
          </label>
        </div>

        <div className="gm-snapshot-preview-wrap" data-testid="promo-snapshot-preview-wrap">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="GoldMeta Market Snapshot preview"
              className="gm-snapshot-preview"
              data-testid="promo-snapshot-preview"
            />
          ) : (
            <div className="gm-snapshot-preview-empty" aria-busy={generating}>
              {generating ? "Preparing snapshot…" : "No preview yet"}
            </div>
          )}
          <p className="gm-meta gm-snapshot-hold-hint">
            Press and hold the image to save it if Share is unavailable.
          </p>
        </div>

        <div className="gm-snapshot-actions">
          <button
            type="button"
            className="gm-btn-primary"
            data-testid="promo-snapshot-share"
            disabled={!previewUrl || generating}
            onClick={() => onShare()}
          >
            Share / Save
          </button>
          <button
            type="button"
            className="gm-btn-outline"
            data-testid="promo-snapshot-download"
            disabled={!previewUrl || generating}
            onClick={() => onDownload()}
          >
            Download PNG
          </button>
        </div>
      </div>
    </div>
  );
}
