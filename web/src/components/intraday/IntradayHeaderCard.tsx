import type { IntradayPlan } from "../../types/intradayPlan";
import { biasLabel, fmtPrice } from "../../lib/intradayFormat";
import {
  freshnessChipLabel,
  freshnessTone
} from "../../lib/cockpitHelpers";

type Props = {
  plan: IntradayPlan;
  livePrice: number | null;
  previousPrice?: number | null;
  sessionLabel: string;
  freshness: string;
  source: "live" | "cached" | "offline";
  marketStructureMode?: string | null;
  compactTime?: string;
};

/** Sticky compact market bar — phone above-the-fold #1. */
export function IntradayHeaderCard({
  plan,
  livePrice,
  previousPrice,
  sessionLabel,
  freshness,
  source,
  marketStructureMode,
  compactTime
}: Props) {
  const price = livePrice ?? plan.expectedRange.currentPrice;
  const tone = freshnessTone({
    quoteAgeSeconds: plan.freshness.quoteAgeSeconds,
    source,
    marketStructureMode: marketStructureMode ?? plan.freshness.marketStructureMode,
    dataQuality: plan.freshness.dataQuality
  });
  const freshLabel = freshnessChipLabel({
    tone,
    quoteAgeSeconds: plan.freshness.quoteAgeSeconds,
    source,
    compactTime
  });
  const move =
    price != null && previousPrice != null && Number.isFinite(previousPrice)
      ? price - previousPrice
      : null;
  const bias = biasLabel(plan.directionBias);
  const biasTone =
    plan.directionBias.includes("BULL")
      ? "bullish"
      : plan.directionBias.includes("BEAR")
        ? "bearish"
        : "neutral";

  return (
    <section
      className="gm-intra-header gm-cockpit-strip gm-market-strip gm-market-bar-sticky"
      data-testid="intraday-header-card"
      aria-label="Market status strip"
    >
      <div className="gm-market-bar-primary">
        <div className="gm-market-bar-price-row" data-testid="cockpit-status-strip">
          <strong data-testid="market-strip-symbol">XAUUSD</strong>{" "}
          <span className="gm-intra-price" data-testid="intraday-live-price">
            {fmtPrice(price)}
          </span>
          {move != null && (
            <span
              className={`gm-price-move ${move >= 0 ? "up" : "down"}`}
              data-testid="cockpit-price-move"
            >
              {move >= 0 ? "▲" : "▼"} {Math.abs(move).toFixed(2)}
            </span>
          )}
        </div>
        <p className="gm-market-bar-meta" data-testid="market-strip-session">
          <span>{sessionLabel}</span>
          <span aria-hidden="true"> · </span>
          <span data-testid="intraday-freshness" data-tone={tone}>
            {freshLabel}
          </span>
          {source !== "live" && (
            <>
              <span aria-hidden="true"> · </span>
              <span data-testid="market-source-chip">
                {source === "offline" ? "Offline" : "Cached"}
              </span>
            </>
          )}
        </p>
        <p className="gm-market-bar-bias" data-testid="cockpit-bias" data-tone={biasTone}>
          <span>
            Market bias: <strong>{bias}</strong>
          </span>
          <span
            className="gm-bias-hint"
            title="Bias is market context, not an entry signal."
            data-testid="bias-context-hint"
          >
            Bias is market context, not an entry signal.
          </span>
        </p>
        <p className="gm-market-bar-autotrade" data-testid="intraday-autotrade-off">
          AutoTrade OFF
        </p>
      </div>
      <p className="gm-sr-only" data-testid="intraday-header-meta">
        {freshness}
      </p>
    </section>
  );
}
