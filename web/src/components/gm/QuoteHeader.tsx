import { fmtPrice } from "../../lib/intradayFormat";

type Props = {
  price: number | null;
  updatedLabel: string;
  sessionLabel?: string;
  fresh?: boolean;
  symbol?: string;
  className?: string;
  desktopOnly?: boolean;
};

export function QuoteHeader({
  price,
  updatedLabel,
  sessionLabel,
  fresh = false,
  symbol = "XAUUSD",
  className = "",
  desktopOnly = false
}: Props) {
  return (
    <div
      className={className}
      data-testid={desktopOnly ? "desktop-quote-header" : "mobile-quote-header"}
      aria-label={`${symbol} quote`}
    >
      <div>
        <span className="gm-quote-symbol">{symbol}</span>
        <strong className="gm-quote-price" data-testid="shell-live-price">
          {price != null ? fmtPrice(price) : "—"}
        </strong>
      </div>
      <div className="gm-quote-meta">
        {sessionLabel ? <span>{sessionLabel}</span> : null}
        {sessionLabel ? <span aria-hidden>·</span> : null}
        <span className={`gm-premium-fresh${fresh ? " is-fresh" : ""}`}>
          <span className={`gm-fresh-dot${fresh ? " is-fresh" : ""}`} aria-hidden />
          Updated {updatedLabel}
        </span>
      </div>
    </div>
  );
}
