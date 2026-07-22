/** Compact Share Market Snapshot trigger button. */
export function PromoSnapshotButton({
  onClick,
  disabled
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="gm-snapshot-trigger"
      data-testid="share-market-snapshot"
      aria-label="Share Market Snapshot"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="gm-snapshot-trigger-icon" aria-hidden>
        ↗
      </span>
      Share Market Snapshot
    </button>
  );
}
