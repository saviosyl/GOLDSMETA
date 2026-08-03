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
  mode?: "COMPLETE" | "LIVE_RANGE_ONLY" | "MISMATCH" | "UNAVAILABLE" | null;
  diagnostics?: Record<string, unknown> | null;
};

/** Market Structure Map — verified levels only; highest price at top. */
export function MarketLevelLadder({
  input,
  dataTimestamp,
  className = "",
  mode = null,
  diagnostics = null
}: MarketLevelLadderProps) {
  const { rows, mismatch, liveLabel } = buildMarketLevelLadderDetailed({
    ...input,
    liveRangeOnly: mode === "LIVE_RANGE_ONLY" || input.liveRangeOnly
  });
  const { resistance, support } = nearestLevels(rows);
  const ts = formatLocalTimestamp(dataTimestamp);

  if (mismatch || mode === "MISMATCH") {
    const alertPrice = mismatch?.alertClose;
    const brokerPrice = mismatch?.comparisonPrice;
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
          TradingView alert price:{" "}
          {alertPrice != null ? alertPrice.toFixed(2) : "unavailable"}
        </p>
        <p data-testid="market-data-mismatch-broker">
          Broker/live price: {brokerPrice != null ? brokerPrice.toFixed(2) : "unavailable"}
        </p>
        <p className="gm-meta" data-testid="market-data-mismatch-detail">
          Signal blocked until the price sources match. GoldMeta will not combine incompatible
          price regimes (for example a ~2400 test fixture with a ~4050 live alert).
        </p>
        <MarketStructureDiagnostics diagnostics={diagnostics} />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={`gm-ladder ${className}`.trim()} data-testid="market-level-ladder">
        <p className="gm-meta" role="status">
          No verified market levels available yet.
        </p>
        <MarketStructureDiagnostics diagnostics={diagnostics} />
      </div>
    );
  }

  const maxAbs = Math.max(
    1,
    ...rows.filter((r) => r.kind !== "live").map((r) => Math.abs(r.distance ?? 0))
  );
  const liveRangeOnly = mode === "LIVE_RANGE_ONLY" || Boolean(input.liveRangeOnly);

  return (
    <div className={`gm-ladder ${className}`.trim()} data-testid="market-level-ladder">
      {liveRangeOnly && (
        <div className="gm-ladder-range-only" data-testid="live-market-range-only" role="status">
          <h3 className="gm-subsection-title">Live market range only</h3>
          <p className="gm-meta">
            Live price is available, but the latest complete TradingView strategy signal has not been
            received or is no longer valid. Showing current/last price and bar high/low only — missing
            levels are never fabricated.
          </p>
        </div>
      )}
      <div className="gm-ladder-meta">
        <span className="gm-meta">
          Updated {ts.primary}
          {ts.timeZone !== "UTC" ? ` · ${ts.timeZone}` : ""} · {ts.secondaryUtc}
          {liveLabel !== "LIVE PRICE" ? ` · ${liveLabel}` : ""}
        </span>
        {!liveRangeOnly && (resistance || support) && (
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
      <MarketStructureDiagnostics diagnostics={diagnostics} />
    </div>
  );
}

function MarketStructureDiagnostics({
  diagnostics
}: {
  diagnostics?: Record<string, unknown> | null;
}) {
  if (!diagnostics) return null;
  const fieldsReceived = Array.isArray(diagnostics.fieldsReceived)
    ? diagnostics.fieldsReceived.join(", ")
    : "—";
  const fieldsMissing = Array.isArray(diagnostics.fieldsMissing)
    ? diagnostics.fieldsMissing.join(", ")
    : "—";
  const fieldsRejected = Array.isArray(diagnostics.fieldsRejected)
    ? diagnostics.fieldsRejected.join(", ")
    : "—";
  const rejectionReasons = Array.isArray(diagnostics.rejectionReasons)
    ? diagnostics.rejectionReasons.join(" · ")
    : "—";
  return (
    <details className="gm-disclosure" data-testid="market-structure-diagnostics" style={{ marginTop: 12 }}>
      <summary>Market Structure diagnostics</summary>
      <div className="gm-disclosure-body gm-meta">
        <p>Last decision/webhook: {String(diagnostics.lastWebhookOrDecisionAt ?? "—")}</p>
        <p>Last complete signal: {String(diagnostics.lastCompleteSignalAt ?? "—")}</p>
        <p>
          Schema {String(diagnostics.schemaVersion ?? "—")} · Symbol{" "}
          {String(diagnostics.canonicalSymbol ?? "—")} · Exchange/broker{" "}
          {String(diagnostics.exchangeOrBroker ?? "—")} · Timeframe{" "}
          {String(diagnostics.timeframe ?? "—")}
        </p>
        <p>
          Quote source: {String(diagnostics.quoteSource ?? "—")} · Signal source:{" "}
          {String(diagnostics.signalSource ?? "—")}
        </p>
        <p>Fields received: {fieldsReceived || "—"}</p>
        <p>Fields missing: {fieldsMissing || "—"}</p>
        <p>Fields rejected: {fieldsRejected || "—"}</p>
        <p>Rejection reasons: {rejectionReasons || "—"}</p>
        <p>
          Price consistency:{" "}
          {diagnostics.priceConsistencyOk == null
            ? "—"
            : diagnostics.priceConsistencyOk
              ? "OK"
              : "FAILED"}{" "}
          · Validity: {String(diagnostics.validityStatus ?? "—")} · Mode:{" "}
          {String(diagnostics.marketStructureMode ?? "—")}
        </p>
        <p>
          Quote age (s): {String(diagnostics.quoteAgeSeconds ?? "—")} · Signal age (s):{" "}
          {String(diagnostics.signalAgeSeconds ?? "—")}
        </p>
      </div>
    </details>
  );
}
