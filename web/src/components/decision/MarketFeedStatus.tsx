import type { MarketFeedHealth } from "../../types/models";

type Props = {
  health?: MarketFeedHealth | null;
  loading?: boolean;
  error?: string | null;
  /** Compact one-line mobile presentation. */
  compact?: boolean;
};

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "not verified yet";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "not verified yet";
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function shortStatus(health: MarketFeedHealth | null | undefined, error?: string | null): string {
  if (error) return "Unavailable";
  if (!health) return "Unknown";
  if (health.status === "green") return "Operational";
  if (health.status === "amber") return "Limited";
  return "Unavailable";
}

function quoteShort(health: MarketFeedHealth | null | undefined): string {
  if (health?.quoteStatus === "live") return "Live quotes";
  if (health?.quoteStatus === "limited") return "Quotes limited";
  return "Quote unknown";
}

function titleFor(health: MarketFeedHealth | null | undefined): string {
  if (!health) return "GoldMeta Market Feed";
  if (health.status === "green") return "GoldMeta Market Feed";
  if (health.status === "amber") return "Market feed partially available";
  return "Market feed unavailable";
}

function subtitleFor(health: MarketFeedHealth | null | undefined): string {
  if (!health) return "Feed status unknown";
  if (health.status === "green") return "All systems operational";
  if (health.status === "amber") {
    return health.subtitle || "15-minute plan is live; 5-minute confirmation is missing or stale.";
  }
  return health.subtitle || "Required 15-minute plan feed is missing, stale, or unsafe.";
}

export function MarketFeedStatus({
  health,
  loading = false,
  error = null,
  compact = true
}: Props) {
  const status = health?.status ?? (error ? "red" : "amber");
  const label = status === "green" ? "GREEN" : status === "amber" ? "AMBER" : "RED";

  if (loading && !health) {
    return (
      <section
        className="gm-market-feed-status gm-feed-skeleton gm-feed-compact"
        data-testid="market-feed-status"
        aria-busy="true"
        aria-label="GoldMeta Market Feed loading"
      >
        <div className="gm-skel-block gm-skel-line" />
      </section>
    );
  }

  if (compact) {
    return (
      <section
        className={`gm-market-feed-status gm-feed-compact tone-${status}`}
        data-testid="market-feed-status"
        data-status={status}
        aria-label={`GoldMeta Market Feed status ${label}: ${shortStatus(health, error)}`}
      >
        <span className="gm-feed-status-pill" aria-hidden="true">
          {label}
        </span>
        <div className="gm-feed-compact-copy">
          <strong>Market feed: {error ? "Unavailable" : shortStatus(health, error)}</strong>
          <span className="gm-meta">
            {quoteShort(health)} · {relativeTime(health?.lastVerifiedAt)}
          </span>
        </div>
        <details className="gm-feed-more">
          <summary aria-label="Market feed details">Details</summary>
          <p>{error ?? subtitleFor(health)}</p>
          <p data-testid="market-feed-last-verified">
            Last verified: {relativeTime(health?.lastVerifiedAt)}
            {health?.lastVerifiedLabel ? ` · ${health.lastVerifiedLabel}` : ""}
          </p>
        </details>
      </section>
    );
  }

  return (
    <section
      className={`gm-market-feed-status tone-${status}`}
      data-testid="market-feed-status"
      data-status={status}
      aria-label={`GoldMeta Market Feed status ${label}: ${titleFor(health)}`}
    >
      <div className="gm-feed-status-main">
        <span className="gm-feed-status-pill" aria-hidden="true">
          {label}
        </span>
        <div>
          <h2>{titleFor(health)}</h2>
          <p>{error ?? subtitleFor(health)}</p>
        </div>
      </div>
      <p className="gm-feed-quote-line">{quoteShort(health)}</p>
      <p className="gm-meta" data-testid="market-feed-last-verified">
        Last verified: {relativeTime(health?.lastVerifiedAt)}
        {health?.lastVerifiedLabel ? ` · ${health.lastVerifiedLabel}` : ""}
      </p>
    </section>
  );
}
