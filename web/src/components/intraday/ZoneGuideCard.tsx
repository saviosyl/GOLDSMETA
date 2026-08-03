import type { ZoneGuide } from "../../types/intradayPlan";
import { fmtPrice, valueLocationLabel } from "../../lib/intradayFormat";

type Props = {
  zones: ZoneGuide;
  livePrice: number | null;
};

function distLabel(level: number | null, live: number | null): string {
  if (level == null || live == null) return "";
  const d = level - live;
  const abs = Math.abs(d).toFixed(1);
  if (Math.abs(d) < 0.005) return " · at price";
  return ` · ${abs} pts ${d > 0 ? "above" : "below"}`;
}

export function ZoneGuideCard({ zones, livePrice }: Props) {
  return (
    <section className="gm-intra-zones" data-testid="zone-guide-card" aria-label="Best buy and sell zones">
      <div className="gm-section-head">
        <h2 className="gm-section-title">Best areas</h2>
        <span className="gm-meta">{valueLocationLabel(zones.valueLocation)}</span>
      </div>
      <div className="gm-intra-zones-grid">
        <div>
          <span className="gm-label">
            Best buy zone {zones.bestBuyImmediate ? "(immediate)" : "(conditional)"}
          </span>
          <strong data-testid="zone-buy">{zones.bestBuyZone ?? "—"}</strong>
          {zones.bestBuyConfirmation && (
            <em className="gm-meta">Confirm: {zones.bestBuyConfirmation}</em>
          )}
          {zones.bestBuyInvalidation && (
            <em className="gm-meta">Invalidation: {zones.bestBuyInvalidation}</em>
          )}
        </div>
        <div>
          <span className="gm-label">
            Best sell zone {zones.bestSellImmediate ? "(immediate)" : "(conditional)"}
          </span>
          <strong data-testid="zone-sell">{zones.bestSellZone ?? "—"}</strong>
          {zones.bestSellConfirmation && (
            <em className="gm-meta">Confirm: {zones.bestSellConfirmation}</em>
          )}
          {zones.bestSellInvalidation && (
            <em className="gm-meta">Invalidation: {zones.bestSellInvalidation}</em>
          )}
        </div>
        <div className="gm-intra-zones-span">
          <span className="gm-label">No-trade / middle</span>
          <strong data-testid="zone-no-trade">{zones.noTradeZone ?? "—"}</strong>
        </div>
        <div>
          <span className="gm-label">Nearest support (at/below price)</span>
          <strong data-testid="zone-support">
            {fmtPrice(zones.nearestSupport)}
            <em className="gm-meta">{distLabel(zones.nearestSupport, livePrice)}</em>
          </strong>
        </div>
        <div>
          <span className="gm-label">Nearest resistance / reclaim (at/above price)</span>
          <strong data-testid="zone-resistance">
            {fmtPrice(zones.nearestResistance)}
            <em className="gm-meta">{distLabel(zones.nearestResistance, livePrice)}</em>
          </strong>
        </div>
      </div>
    </section>
  );
}
