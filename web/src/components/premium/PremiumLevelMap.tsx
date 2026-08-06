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
    <section className="gm-level-map-v2" data-testid="premium-level-map" aria-label="Level map">
      <h3>Level Map</h3>
      <div className="gm-level-map-rail">
        {up.map((level) => (
          <div key={level.id} className="gm-map-row upside">
            <span className="gm-map-dot upside" aria-hidden />
            <div>
              <strong>{fmtPrice(level.price)}</strong>
              <span style={{ display: "block", fontSize: "0.75rem", opacity: 0.75 }}>
                {level.shortMeaning || level.kind.replace(/_/g, " ")} ·{" "}
                {strengthBadgeLabel(level.strength)}
              </span>
            </div>
          </div>
        ))}
        <div className="gm-map-current" data-testid="premium-map-current">
          <span>CURRENT PRICE</span>
          <strong>{livePrice != null ? fmtPrice(livePrice) : "—"}</strong>
        </div>
        {down.map((level) => (
          <div key={level.id} className="gm-map-row downside">
            <span className="gm-map-dot downside" aria-hidden />
            <div>
              <strong>{fmtPrice(level.price)}</strong>
              <span style={{ display: "block", fontSize: "0.75rem", opacity: 0.75 }}>
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
