import { fmtPrice } from "../../lib/intradayFormat";
import type { MarketFeedHealth } from "../../types/models";

type Props = {
  symbol?: string;
  livePrice: number | null;
  updatedLabel: string;
  sessionLabel?: string;
  feedHealth?: MarketFeedHealth | null;
  fresh?: boolean;
};

export function PremiumMarketStrip({
  symbol = "XAUUSD",
  livePrice,
  updatedLabel,
  sessionLabel,
  feedHealth,
  fresh = true
}: Props) {
  const feedLine =
    feedHealth?.status === "green"
      ? "Market feed operational"
      : feedHealth?.status === "amber"
        ? "Market feed partially available"
        : feedHealth?.status === "red"
          ? "Market feed unavailable"
          : "Market feed status loading";

  return (
    <div className="gm-premium-market-strip" data-testid="premium-market-strip">
      <div className="gm-premium-market-row">
        <div className="gm-premium-market-price">
          <span className="gm-label">{symbol}</span>
          <strong data-testid="premium-live-price">
            {livePrice != null ? fmtPrice(livePrice) : "—"}
          </strong>
        </div>
        <div className="gm-premium-market-meta">
          {sessionLabel ? <span className="gm-premium-session">{sessionLabel}</span> : null}
          <span className={`gm-premium-fresh${fresh ? " is-fresh" : ""}`} data-testid="premium-updated">
            <span className="gm-premium-dot" aria-hidden />
            Updated {updatedLabel}
          </span>
        </div>
      </div>
      <div className="gm-premium-feed-bar" data-testid="premium-feed-bar" data-status={feedHealth?.status ?? "unknown"}>
        <p>{feedLine}</p>
        {feedHealth?.subtitle ? <span>{feedHealth.subtitle}</span> : null}
        <a className="gm-linkish" href="#premium-setup-health" data-testid="premium-feed-details">
          View details
        </a>
      </div>
    </div>
  );
}
