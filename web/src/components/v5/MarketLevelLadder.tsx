import { buildMarketLevelLadder, nearestLevels, type LadderInput } from "../../lib/marketLadder";
import { formatCompactLocalTime, loadTimezonePreference } from "../../lib/timezone";

export type MarketLevelLadderProps = {
  input: LadderInput;
  dataTimestamp?: string | null;
  className?: string;
};

/** Market Structure Map — verified levels; nearest resistance/support highlighted. */
export function MarketLevelLadder({ input, dataTimestamp, className = "" }: MarketLevelLadderProps) {
  const rows = buildMarketLevelLadder(input);
  const { resistance, support } = nearestLevels(rows);
  const compact = formatCompactLocalTime(dataTimestamp, loadTimezonePreference());

  if (rows.length === 0) {
    return (
      <div className={`gm-ladder ${className}`.trim()} data-testid="market-level-ladder">
        <p className="gm-meta" role="status">
          No verified market levels available yet.
        </p>
      </div>
    );
  }

  const maxAbs = Math.max(
    1,
    ...rows.filter((r) => r.kind !== "live").map((r) => Math.abs(r.distance ?? 0))
  );

  return (
    <div className={`gm-ladder ${className}`.trim()} data-testid="market-level-ladder">
      <div className="gm-ladder-nearest" data-testid="ladder-nearest">
        <span data-testid="nearest-resistance">
          Nearest Resistance{" "}
          <strong>{resistance ? resistance.price.toFixed(2) : "—"}</strong>
        </span>
        <span data-testid="nearest-live">
          Live Price{" "}
          <strong>
            {rows.find((r) => r.kind === "live")?.price.toFixed(2) ?? "—"}
          </strong>
        </span>
        <span data-testid="nearest-support">
          Nearest Support <strong>{support ? support.price.toFixed(2) : "—"}</strong>
        </span>
      </div>
      <p className="gm-meta">Updated {compact}</p>
      <ol className="gm-ladder-list" aria-label="Market structure levels">
        {rows.map((row) => {
          const isNearestRes = resistance?.id === row.id;
          const isNearestSup = support?.id === row.id;
          const distant =
            row.kind !== "live" &&
            !isNearestRes &&
            !isNearestSup &&
            row.distance != null &&
            Math.abs(row.distance) > maxAbs * 0.55;
          const strength =
            row.kind === "live" ? 100 : Math.round((Math.abs(row.distance ?? 0) / maxAbs) * 100);
          return (
            <li
              key={row.id}
              className={[
                "gm-ladder-row",
                `tone-${row.tone}`,
                row.kind === "live" ? "is-live" : "",
                isNearestRes ? "is-nearest-res" : "",
                isNearestSup ? "is-nearest-sup" : "",
                distant ? "is-distant" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              data-testid={row.kind === "live" ? "ladder-live-price" : `ladder-row-${row.id}`}
            >
              <div className="gm-ladder-price">
                <strong>{row.price.toFixed(2)}</strong>
                {row.distance != null && row.kind !== "live" && (
                  <span className="gm-meta">
                    {row.position === "above" ? "+" : ""}
                    {row.distance.toFixed(2)}
                  </span>
                )}
              </div>
              <div className="gm-ladder-bar-wrap" aria-hidden>
                <div className="gm-ladder-bar" style={{ width: `${Math.max(12, strength)}%` }} />
              </div>
              <div className="gm-ladder-labels">
                <span className="gm-ladder-class">
                  {row.kind === "live"
                    ? "Live Price"
                    : isNearestRes
                      ? `Nearest Resistance · ${row.classification}`
                      : isNearestSup
                        ? `Nearest Support · ${row.classification}`
                        : row.classification}
                </span>
                <span className="gm-meta">{row.context}</span>
                <span className="gm-badge neutral">
                  {row.verified ? "Verified" : "Unavailable"}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="gm-meta" style={{ marginTop: 10 }}>
        Levels shown are from verified stored market data only. Missing levels are omitted — never
        fabricated.
      </p>
    </div>
  );
}
