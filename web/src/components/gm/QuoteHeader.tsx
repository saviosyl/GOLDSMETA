import { fmtPrice } from "../../lib/intradayFormat";
import { freshnessStatusLabel, type QuoteFreshness } from "../../lib/liveQuote";

type Props = {
  price: number | null;
  updatedLabel: string;
  sessionLabel?: string;
  fresh?: boolean;
  freshness?: QuoteFreshness;
  unavailable?: boolean;
  bid?: number | null;
  ask?: number | null;
  symbol?: string;
  className?: string;
  desktopOnly?: boolean;
};

function freshnessClass(freshness?: QuoteFreshness, fresh?: boolean): string {
  if (freshness === "LIVE" || (!freshness && fresh)) return "is-fresh";
  if (freshness === "DELAYED") return "is-delayed";
  if (freshness === "STALE" || freshness === "MARKET_CLOSED") return "is-stale";
  return "";
}

export function QuoteHeader({
  price,
  updatedLabel,
  sessionLabel,
  fresh = false,
  freshness,
  unavailable = false,
  bid,
  ask,
  symbol = "XAUUSD",
  className = "",
  desktopOnly = false
}: Props) {
  const status = freshness ? freshnessStatusLabel(freshness) : fresh ? "Live" : null;
  const priceLabel = unavailable
    ? "Price unavailable"
    : price != null
      ? fmtPrice(price)
      : "—";

  return (
    <div
      className={className}
      data-testid={desktopOnly ? "desktop-quote-header" : "mobile-quote-header"}
      aria-label={`${symbol} quote`}
    >
      <div>
        <span className="gm-quote-symbol">{symbol}</span>
        <strong className="gm-quote-price" data-testid="shell-live-price">
          {priceLabel}
        </strong>
        {bid != null && ask != null && !unavailable ? (
          <span className="gm-quote-ba" data-testid="shell-bid-ask">
            Bid {fmtPrice(bid)} · Ask {fmtPrice(ask)}
          </span>
        ) : null}
      </div>
      <div className="gm-quote-meta">
        {sessionLabel ? <span>{sessionLabel}</span> : null}
        {sessionLabel ? <span aria-hidden>·</span> : null}
        {status ? (
          <>
            <span data-testid="shell-quote-freshness">{status}</span>
            <span aria-hidden>·</span>
          </>
        ) : null}
        <span
          className={`gm-premium-fresh ${freshnessClass(freshness, fresh)}`.trim()}
          data-testid="shell-quote-updated"
        >
          <span
            className={`gm-fresh-dot ${freshnessClass(freshness, fresh)}`.trim()}
            aria-hidden
          />
          Updated {updatedLabel}
        </span>
      </div>
    </div>
  );
}
