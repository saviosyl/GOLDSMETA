import { fmtPrice } from "../../lib/intradayFormat";
import type { MarketFeedHealth } from "../../types/models";

type Props = {
  symbol?: string;
  livePrice: number | null;
  updatedLabel: string;
  sessionLabel?: string;
  feedHealth?: MarketFeedHealth | null;
  fresh?: boolean;
  /** Absolute session/day change when known from real OHLCV or quote history. */
  priceChange?: number | null;
  priceChangePct?: number | null;
  live?: boolean;
};

export function PremiumMarketStrip({
  symbol = "XAUUSD",
  livePrice,
  updatedLabel,
  sessionLabel,
  feedHealth,
  fresh = true,
  priceChange = null,
  priceChangePct = null,
  live = true
}: Props) {
  const feedLine =
    feedHealth?.status === "green"
      ? "Market feed connected"
      : feedHealth?.status === "amber"
        ? "Market feed partially available"
        : feedHealth?.status === "red"
          ? "Market feed unavailable"
          : "Market feed status loading";

  const changeTone =
    priceChange == null
      ? ""
      : priceChange > 0
        ? " is-up"
        : priceChange < 0
          ? " is-down"
          : "";

  return (
    <div className="gm-premium-market-strip" data-testid="premium-market-strip">
      <div className="gm-premium-market-row">
        <div className="gm-premium-market-price">
          <div className="gm-premium-symbol-row">
            <span className="gm-label">{symbol}</span>
            {live ? (
              <span className="gm-premium-live-pill" data-testid="plan-live-pill">
                LIVE
              </span>
            ) : (
              <span className="gm-premium-live-pill is-off" data-testid="plan-live-pill">
                DELAYED
              </span>
            )}
          </div>
          <strong data-testid="premium-live-price">
            {livePrice != null ? fmtPrice(livePrice) : "—"}
          </strong>
          {priceChange != null ? (
            <span
              className={`gm-premium-price-change${changeTone}`}
              data-testid="plan-price-change"
            >
              {priceChange > 0 ? "+" : ""}
              {fmtPrice(priceChange)}
              {priceChangePct != null
                ? ` (${priceChangePct > 0 ? "+" : ""}${priceChangePct.toFixed(2)}%)`
                : ""}
            </span>
          ) : null}
        </div>
        <div className="gm-premium-market-meta">
          {sessionLabel ? <span className="gm-premium-session">{sessionLabel}</span> : null}
          <span
            className={`gm-premium-fresh${fresh ? " is-fresh" : ""}`}
            data-testid="premium-updated"
          >
            <span className="gm-premium-dot" aria-hidden />
            Updated {updatedLabel}
          </span>
        </div>
      </div>
      {/* Feed health remains on DecisionDashboard FeedStatusStrip to avoid duplicate bars. */}
      {feedHealth ? (
        <p className="gm-sr-only" data-testid="premium-market-feed-status">
          {feedLine}
          {feedHealth.subtitle ? ` · ${feedHealth.subtitle}` : ""}
        </p>
      ) : null}
    </div>
  );
}
