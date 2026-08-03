import type { ZoneGuide } from "../../types/intradayPlan";
import { fmtPrice } from "../../lib/intradayFormat";

type Props = {
  zones: ZoneGuide;
  livePrice: number | null;
};

function distLabel(level: number | null, live: number | null): string {
  if (level == null || live == null) return "";
  const d = level - live;
  const abs = Math.abs(d).toFixed(1);
  if (d === 0) return " · at price";
  return ` · ${abs} pts ${d > 0 ? "above" : "below"}`;
}

export function ZoneGuideCard({ zones, livePrice }: Props) {
  return (
    <section className="gm-intra-zones" data-testid="zone-guide-card" aria-label="Best buy and sell zones">
      <h2 className="gm-section-title">Best areas</h2>
      <div className="gm-intra-zones-grid">
        <div>
          <span className="gm-label">Best buy zone</span>
          <strong data-testid="zone-buy">{zones.bestBuyZone ?? "—"}</strong>
        </div>
        <div>
          <span className="gm-label">Best sell zone</span>
          <strong data-testid="zone-sell">{zones.bestSellZone ?? "—"}</strong>
        </div>
        <div className="gm-intra-zones-span">
          <span className="gm-label">No-trade / middle</span>
          <strong data-testid="zone-no-trade">{zones.noTradeZone ?? "—"}</strong>
        </div>
        <div>
          <span className="gm-label">Nearest floor (support)</span>
          <strong data-testid="zone-support">
            {fmtPrice(zones.nearestSupport)}
            <em className="gm-meta">{distLabel(zones.nearestSupport, livePrice)}</em>
          </strong>
        </div>
        <div>
          <span className="gm-label">Nearest ceiling (resistance)</span>
          <strong data-testid="zone-resistance">
            {fmtPrice(zones.nearestResistance)}
            <em className="gm-meta">{distLabel(zones.nearestResistance, livePrice)}</em>
          </strong>
        </div>
      </div>
      <p className="gm-meta" style={{ marginBottom: 0 }}>
        Never enter directly into nearby support or resistance without the confirmation listed above.
      </p>
    </section>
  );
}
