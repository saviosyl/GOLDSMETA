export type FreshnessState =
  | "VERIFIED"
  | "STALE"
  | "PARTIAL"
  | "UNAVAILABLE"
  | "SHADOW"
  | "TEST"
  | "LIVE"
  | "OFFLINE";

export type VerifiedDataMetaProps = {
  symbol?: string | null;
  timeframe?: string | null;
  dataTimestamp?: string | null;
  environment?: string | null;
  strategyVersion?: string | null;
  mode?: string | null;
  freshness?: FreshnessState | null;
  sources?: string[];
  missingWarning?: string | null;
};

/** Shared verified-data chrome for intelligence / briefing / score cards. */
export function VerifiedDataMeta({
  symbol = "XAUUSD",
  timeframe,
  dataTimestamp,
  environment = "LIVE",
  strategyVersion,
  mode = "SHADOW",
  freshness = "VERIFIED",
  sources = [],
  missingWarning
}: VerifiedDataMetaProps) {
  return (
    <div className="v5-verified-meta" data-testid="verified-data-meta" aria-label="Verified data context">
      <div className="chip-row compact">
        <span className="chip static">{symbol ?? "XAUUSD"}</span>
        {timeframe && <span className="chip static">TF {timeframe}</span>}
        {environment && <span className="chip static">{environment}</span>}
        {mode && <span className="chip static">{mode}</span>}
        {freshness && (
          <span className={`chip static freshness-${String(freshness).toLowerCase()}`} data-testid="freshness-state">
            {freshness}
          </span>
        )}
        {strategyVersion && <span className="chip static">v{strategyVersion}</span>}
      </div>
      {dataTimestamp && (
        <p className="muted small" data-testid="data-timestamp">
          Data timestamp: {dataTimestamp}
        </p>
      )}
      {sources.length > 0 && (
        <p className="muted small">Sources: {sources.join(" · ")}</p>
      )}
      {missingWarning && (
        <div className="banner stale" role="status">
          {missingWarning}
        </div>
      )}
    </div>
  );
}

export function freshnessFromOffline(online: boolean, cachedAt?: string | null): FreshnessState {
  if (!online) return "OFFLINE";
  if (!cachedAt) return "UNAVAILABLE";
  const ageMs = Date.now() - new Date(cachedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return "STALE";
  if (ageMs > 15 * 60 * 1000) return "STALE";
  return "VERIFIED";
}
