type Props = {
  marketStructureMode: "COMPLETE" | "LIVE_RANGE_ONLY" | "MISMATCH" | "UNAVAILABLE" | null;
  loading: boolean;
  signedOut?: boolean;
  apiError?: boolean;
};

/** Single-instance cockpit alerts — do not repeat across cards. */
export function CockpitAlerts({
  marketStructureMode,
  loading,
  signedOut,
  apiError
}: Props) {
  if (loading) {
    return (
      <div className="gm-cockpit-alert tone-neutral" data-testid="cockpit-loading" role="status">
        Loading market state…
      </div>
    );
  }
  if (signedOut) {
    return (
      <div className="gm-cockpit-alert tone-neutral" data-testid="cockpit-signed-out" role="status">
        Sign in to load authenticated market research.
      </div>
    );
  }
  if (apiError) {
    return (
      <div className="gm-cockpit-alert tone-stale" data-testid="cockpit-api-error" role="alert">
        Authenticated market data is temporarily unavailable. Use Refresh to retry.
      </div>
    );
  }
  if (marketStructureMode === "MISMATCH") {
    return (
      <div className="gm-cockpit-alert tone-mismatch" data-testid="cockpit-mismatch" role="alert">
        <strong>NO TRADE — price and structure sources disagree.</strong>
        <span>
          Live quote and strategy structure are not aligned. Wait for the next verified complete
          signal.
        </span>
      </div>
    );
  }
  if (marketStructureMode === "LIVE_RANGE_ONLY") {
    return (
      <div className="gm-cockpit-alert tone-ageing" data-testid="cockpit-live-range-only" role="status">
        <strong>Live price available.</strong>
        <span>
          Complete TradingView structure is missing. Planning is limited until the next verified
          strategy signal.
        </span>
      </div>
    );
  }
  return null;
}
