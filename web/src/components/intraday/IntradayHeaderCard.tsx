import type { IntradayPlan } from "../../types/intradayPlan";
import { biasLabel, confidenceLabel, fmtPrice, marketTypeLabel } from "../../lib/intradayFormat";
import { StatusBadge } from "../ui/primitives";

type Props = {
  plan: IntradayPlan;
  livePrice: number | null;
  sessionLabel: string;
  freshness: string;
  source: "live" | "cached" | "offline";
};

export function IntradayHeaderCard({ plan, livePrice, sessionLabel, freshness, source }: Props) {
  const price = livePrice ?? plan.expectedRange.currentPrice;
  const conf = Math.round(plan.confidence <= 1 ? plan.confidence * 100 : plan.confidence);

  return (
    <section className="gm-intra-header" data-testid="intraday-header-card" aria-label="Market overview">
      <div className="gm-intra-header-top">
        <div>
          <span className="gm-label">XAUUSD</span>
          <strong className="gm-intra-price" data-testid="intraday-live-price">
            {fmtPrice(price)}
          </strong>
        </div>
        <div className="gm-intra-header-badges">
          <StatusBadge tone="gold">Analysis only</StatusBadge>
          <StatusBadge tone="neutral">Manual trading</StatusBadge>
          <span data-testid="intraday-autotrade-off">
            <StatusBadge tone="neutral">AutoTrade OFF</StatusBadge>
          </span>
          {source !== "live" && (
            <StatusBadge tone="warning">{source === "offline" ? "Offline" : "Cached"}</StatusBadge>
          )}
        </div>
      </div>
      <div className="gm-intra-header-meta" data-testid="intraday-header-meta">
        <span>
          <em>Session</em> {sessionLabel}
        </span>
        <span>
          <em>Bias</em> {biasLabel(plan.directionBias)}
        </span>
        <span>
          <em>Type</em> {marketTypeLabel(plan.marketType)}
        </span>
        <span>
          <em>Confidence</em> {conf}% · {confidenceLabel(conf)}
        </span>
        <span data-testid="intraday-freshness">
          <em>Data</em> {freshness}
        </span>
      </div>
    </section>
  );
}
