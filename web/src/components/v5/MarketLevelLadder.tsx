import {
  buildMarketLevelLadderDetailed,
  nearestLevels,
  type LadderInput
} from "../../lib/marketLadder";
import { formatLocalTimestamp } from "../../lib/timezone";

export type MarketLevelLadderProps = {
  input: LadderInput;
  dataTimestamp?: string | null;
  className?: string;
};

/** Market Structure Map — verified levels only; highest price at top. */
export function MarketLevelLadder({ input, dataTimestamp, className = "" }: MarketLevelLadderProps) {
  const { rows, mismatch, liveLabel } = buildMarketLevelLadderDetailed(input);
  const { resistance, support } = nearestLevels(rows);
  const ts = formatLocalTimestamp(dataTimestamp);

  if (mismatch) {
    return (
      <div
        className={`gm-ladder gm-ladder-mismatch ${className}`.trim()}
        data-testid="market-level-ladder"
        role="alert"
      >
        <h3 className="gm-subsection-title" data-testid="market-data-mismatch-title">
          Market data mismatch
        </h3>
        <p data-testid="market-data-mismatch-alert">
          TradingView alert price: {mismatch.alertClose.toFixed(2)}
        </p>
        <p data-testid="market-data-mismatch-broker">
          Broker/live price: {mismatch.comparisonPrice.toFixed(2)}
        </p>
        <p className="gm-meta" data-testid="market-data-mismatch-detail">
          Signal blocked until the price sources match. GoldMeta will not combine incompatible
          price regimes (for example a ~2400 test fixture with a ~4050 live alert).
        </p>
      </div>
    );
  }

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
      <div className="gm-ladder-meta">
        <span className="gm-meta">
          Updated {ts.primary}
          {ts.timeZone !== "UTC" ? ` · ${ts.timeZone}` : ""} · {ts.secondaryUtc}
          {liveLabel !== "LIVE PRICE" ? ` · ${liveLabel}` : ""}
        </span>
        {(resistance || support) && (
          <span className="gm-meta">
            {resistance ? `Nearest resistance ${resistance.price}` : ""}
            {resistance && support ? " · " : ""}
            {support ? `Nearest support ${support.price}` : ""}
          </span>
        )}
      </div>
      <ol className="gm-ladder-list" aria-label="Market structure levels">
        {rows.map((row) => {
          const strength =
            row.kind === "live" ? 100 : Math.round((Math.abs(row.distance ?? 0) / maxAbs) * 100);
          return (
            <li
              key={row.id}
              className={`gm-ladder-row tone-${row.tone}${row.kind === "live" ? " is-live" : ""}`}
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
                <span className="gm-ladder-class">{row.classification}</span>
                <span className="gm-meta">{row.context}</span>
                {!row.verified && <span className="gm-badge neutral">Unavailable</span>}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="gm-meta" style={{ marginTop: 10 }}>
        Levels shown are from verified stored market data only. Missing levels are omitted — never
        fabricated. “LIVE PRICE” is shown only for a verified fresh non-test source.
      </p>
    </div>
  );
}
