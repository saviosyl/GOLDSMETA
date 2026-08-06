import { fmtPrice } from "../../lib/intradayFormat";
import { strengthBadgeLabel } from "../../lib/premiumDecisionCopy";
import type { ImportantLevel } from "../../types/intradayPlan";

type Props = {
  livePrice: number | null;
  upside: ImportantLevel[];
  downside: ImportantLevel[];
};

export function PremiumLevelMap({ livePrice, upside, downside }: Props) {
  const up = upside.slice(0, 3);
  const down = downside.slice(0, 3);

  return (
    <section className="gm-premium-level-map" data-testid="premium-level-map" aria-label="Level map">
      <h3>Level Map</h3>
      <div className="gm-premium-level-map-rail">
        {up.map((level) => (
          <div key={level.id} className="gm-premium-map-row upside">
            <span className="gm-premium-map-dot upside" aria-hidden />
            <div>
              <strong>{fmtPrice(level.price)}</strong>
              <span>
                {level.shortMeaning || level.kind.replace(/_/g, " ")} ·{" "}
                {strengthBadgeLabel(level.strength)}
              </span>
            </div>
          </div>
        ))}
        <div className="gm-premium-map-current" data-testid="premium-map-current">
          <span className="gm-label">Current price</span>
          <strong>{livePrice != null ? fmtPrice(livePrice) : "—"}</strong>
        </div>
        {down.map((level) => (
          <div key={level.id} className="gm-premium-map-row downside">
            <span className="gm-premium-map-dot downside" aria-hidden />
            <div>
              <strong>{fmtPrice(level.price)}</strong>
              <span>
                {level.shortMeaning || level.kind.replace(/_/g, " ")} ·{" "}
                {strengthBadgeLabel(level.strength)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
