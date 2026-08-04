import type { ReactNode } from "react";
import type { IntradayPlan } from "../../types/intradayPlan";
import { biasLabel, fmtPrice } from "../../lib/intradayFormat";
import {
  freshnessChipLabel,
  freshnessTone,
  type FreshnessTone
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

function Chip({
  children,
  tone,
  testId
}: {
  children: ReactNode;
  tone?: FreshnessTone | "bullish" | "bearish" | "neutral" | "prepare" | "safe";
  testId?: string;
}) {
  return (
    <span className={`gm-status-chip tone-${tone ?? "neutral"}`} data-testid={testId}>
      {children}
    </span>
  );
}

/** Compact market strip — phone above-the-fold #1. */
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
      className="gm-intra-header gm-cockpit-strip gm-market-strip"
      data-testid="intraday-header-card"
      aria-label="Market status strip"
    >
      <div className="gm-status-strip" data-testid="cockpit-status-strip">
        <Chip tone="neutral" testId="market-strip-symbol">
          <strong>XAUUSD</strong>{" "}
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
        </Chip>
        <Chip tone="neutral" testId="market-strip-session">
          {sessionLabel}
        </Chip>
        <Chip tone={tone} testId="intraday-freshness">
          {freshLabel}
        </Chip>
        <span data-testid="intraday-autotrade-off">
          <Chip tone="prepare">AutoTrade OFF</Chip>
        </span>
        <Chip tone={biasTone} testId="cockpit-bias">
          {bias}
        </Chip>
        {source !== "live" && (
          <Chip tone="stale">{source === "offline" ? "Offline" : "Cached"}</Chip>
        )}
      </div>
      <div className="gm-intra-header-meta gm-sr-meta" data-testid="intraday-header-meta">
        <span className="gm-meta" data-testid="data-freshness-legacy">
          {freshness}
        </span>
      </div>
    </section>
  );
}
