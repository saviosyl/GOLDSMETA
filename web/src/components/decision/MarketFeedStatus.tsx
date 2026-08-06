import type { MarketFeedHealth } from "../../types/models";

type Props = {
  health?: MarketFeedHealth | null;
  loading?: boolean;
  error?: string | null;
};

function relativeLabel(iso: string | null | undefined, fallback: string | null | undefined): string {
  if (fallback) return fallback;
  if (!iso) return "not verified yet";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "not verified yet";
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hours ago`;
}

function titleFor(health: MarketFeedHealth | null | undefined): string {
  if (!health) return "GoldMeta Market Feed";
  if (health.status === "green") return health.title || "GoldMeta Market Feed";
  if (health.status === "amber") return "Market feed partially available";
  return "Market feed unavailable";
}

function subtitleFor(health: MarketFeedHealth | null | undefined): string {
  if (!health) return "Feed status unknown";
  if (health.status === "green") return health.subtitle || "All systems operational";
  if (health.status === "amber") return health.subtitle || "Live quote updates may be limited";
  return health.subtitle || "Decision updates may be delayed";
}

function quoteLine(health: MarketFeedHealth | null | undefined): string {
  if (health?.quoteStatus === "live") return "Live price updates active";
  if (health?.quoteStatus === "limited") return "Live quote updates limited";
  return "Quote status unknown";
}

export function MarketFeedStatus({ health, loading = false, error = null }: Props) {
  const status = health?.status ?? (error ? "red" : "amber");
  const label = status === "green" ? "GREEN" : status === "amber" ? "AMBER" : "RED";

  if (loading && !health) {
    return (
      <section
        className="gm-market-feed-status gm-feed-skeleton"
        data-testid="market-feed-status"
        aria-busy="true"
        aria-label="GoldMeta Market Feed loading"
      >
        <div className="gm-skel-block gm-skel-bar" />
        <div className="gm-skel-block gm-skel-line" />
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
      <p className="gm-feed-quote-line">{quoteLine(health)}</p>
      <p className="gm-meta">Last verified: {relativeLabel(health?.lastVerifiedAt, health?.lastVerifiedLabel)}</p>
    </section>
  );
}
