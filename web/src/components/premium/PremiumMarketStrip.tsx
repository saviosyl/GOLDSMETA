import { fmtPrice } from "../../lib/intradayFormat";
import type { QuoteFreshness } from "../../lib/liveQuote";

type Props = {
  symbol?: string;
  livePrice: number | null;
  updatedLabel: string;
  sessionLabel?: string;
  fresh?: boolean;
  /** Absolute session/day change when known from real OHLCV or quote history. */
  priceChange?: number | null;
  priceChangePct?: number | null;
  bid?: number | null;
  ask?: number | null;
  /**
   * Broker schedule: true = open, false = closed, null/undefined = unknown.
   * Never show a green LIVE pill when the market is closed.
   */
  marketOpen?: boolean | null;
  freshness?: QuoteFreshness;
  /** Quotes connected while market itself may be closed. */
  quotesConnected?: boolean;
};

export function PremiumMarketStrip({
  symbol = "XAUUSD",
  livePrice,
  updatedLabel,
  sessionLabel,
  fresh = true,
  priceChange = null,
  priceChangePct = null,
  bid = null,
  ask = null,
  marketOpen = null,
  freshness,
  quotesConnected = false
}: Props) {
  const changeTone =
    priceChange == null
      ? ""
      : priceChange > 0
        ? " is-up"
        : priceChange < 0
          ? " is-down"
          : "";

  const pill =
    freshness === "MARKET_CLOSED" || marketOpen === false
      ? ({ cls: "is-closed", label: "MARKET CLOSED" } as const)
      : marketOpen === true && (freshness === "LIVE" || freshness == null || fresh)
        ? ({ cls: "", label: "LIVE" } as const)
        : ({ cls: "is-off", label: "DELAYED" } as const);

  return (
    <div className="gm-premium-market-strip" data-testid="premium-market-strip">
      <div className="gm-premium-market-row">
        <div className="gm-premium-market-price">
          <div className="gm-premium-symbol-row">
            <span className="gm-label">{symbol}</span>
            <span
              className={`gm-premium-live-pill ${pill.cls}`.trim()}
              data-testid="plan-live-pill"
            >
              {pill.label}
            </span>
          </div>
          <strong data-testid="premium-live-price">
            {livePrice != null ? fmtPrice(livePrice) : "—"}
          </strong>
          {bid != null && ask != null ? (
            <span className="gm-premium-bid-ask" data-testid="plan-bid-ask">
              Bid {fmtPrice(bid)} · Ask {fmtPrice(ask)}
            </span>
          ) : null}
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
          {pill.label === "MARKET CLOSED" && quotesConnected ? (
            <span className="gm-premium-quote-note" data-testid="plan-quotes-connected">
              Quotes connected
            </span>
          ) : null}
          <span
            className={`gm-premium-fresh${pill.label === "LIVE" ? " is-fresh" : ""}`}
            data-testid="premium-updated"
          >
            <span className="gm-premium-dot" aria-hidden />
            Updated {updatedLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
