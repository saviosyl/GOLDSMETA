import { useMemo, useState } from "react";
import type { ManualRiskSettings, SetupRecord } from "../types/models";
import { estimateManualRisk } from "../lib/manualRisk";

interface Props {
  risk: ManualRiskSettings;
  setup?: SetupRecord | null;
  suppressed?: boolean;
}

export function ManualRiskPlanner({ risk, setup = null, suppressed = false }: Props) {
  const [currency, setCurrency] = useState(risk.currency);
  const [maxCashRisk, setMaxCashRisk] = useState(risk.maxCashRiskPerTrade);
  const [entryPrice, setEntryPrice] = useState<string>(
    setup?.levels.entryPrice != null ? String(setup.levels.entryPrice) : ""
  );
  const [stopLoss, setStopLoss] = useState<string>(
    setup?.levels.stopLoss != null ? String(setup.levels.stopLoss) : ""
  );
  const [spread, setSpread] = useState<string>(
    risk.estimatedSpreadPoints != null ? String(risk.estimatedSpreadPoints) : ""
  );
  const [valuePerPoint, setValuePerPoint] = useState<string>(
    risk.valuePerPoint != null ? String(risk.valuePerPoint) : ""
  );
  const [manualSize, setManualSize] = useState("");
  const [fillPrice, setFillPrice] = useState("");

  const estimate = useMemo(
    () =>
      estimateManualRisk({
        currency,
        maxCashRisk,
        entryPrice: entryPrice ? Number(entryPrice) : null,
        stopLossPrice: stopLoss ? Number(stopLoss) : null,
        instrument: "XAUUSD",
        estimatedSpreadPoints: spread ? Number(spread) : null,
        valuePerPoint: valuePerPoint ? Number(valuePerPoint) : null,
        manualPositionSize: manualSize ? Number(manualSize) : null,
        actualFillPrice: fillPrice ? Number(fillPrice) : null
      }),
    [currency, maxCashRisk, entryPrice, stopLoss, spread, valuePerPoint, manualSize, fillPrice]
  );

  const num = (v: number | null, suffix = ""): string =>
    v == null || Number.isNaN(v) ? "—" : `${v}${suffix}`;

  return (
    <section
      className={`card manual-risk-planner gm-risk-planner-layout ${suppressed ? "suppressed" : ""}`}
      aria-label="Manual risk planner"
      data-testid="manual-risk-planner"
    >
      <h2 className="section-title">Manual € risk planner</h2>
      <p className="muted">
        Calculator and journal aid only. Estimates until you confirm value-per-point and size in your
        broker. GoldMeta never places orders.
      </p>

      <div className="confirm-banner" role="note" data-testid="broker-confirm-banner">
        GoldMeta does not place this trade. Confirm position size, spread and maximum loss in your
        broker before submitting. AutoTrade OFF.
      </div>

      <div className="gm-risk-planner-grid">
        <div className="gm-risk-inputs gm-card-v2">
          <h3 className="gm-section-title">Inputs</h3>
          <div className="form-grid">
            <label className="field">
              <span>Currency</span>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as ManualRiskSettings["currency"])}
                aria-label="Account currency"
              >
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="GBP">GBP</option>
              </select>
            </label>
            <label className="field">
              <span>Max cash risk</span>
              <input
                type="number"
                inputMode="decimal"
                min={1}
                step="0.01"
                value={maxCashRisk}
                onChange={(e) => setMaxCashRisk(Number(e.target.value) || 0)}
                aria-label="Maximum cash risk per trade"
              />
            </label>
            <label className="field">
              <span>Instrument</span>
              <input type="text" value="XAUUSD" readOnly aria-label="Instrument" />
            </label>
            <label className="field">
              <span>Entry price</span>
              <input
                type="number"
                inputMode="decimal"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                aria-label="Entry price"
              />
            </label>
            <label className="field">
              <span>Stop-loss price</span>
              <input
                type="number"
                inputMode="decimal"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                aria-label="Stop-loss price"
              />
            </label>
            <label className="field">
              <span>Est. spread (points)</span>
              <input
                type="number"
                inputMode="decimal"
                value={spread}
                onChange={(e) => setSpread(e.target.value)}
                aria-label="Estimated spread points"
                placeholder="optional"
              />
            </label>
            <label className="field">
              <span>Value per point</span>
              <input
                type="number"
                inputMode="decimal"
                value={valuePerPoint}
                onChange={(e) => setValuePerPoint(e.target.value)}
                aria-label="Broker value per point"
                placeholder="enter from broker"
              />
            </label>
            <label className="field">
              <span>Manual position size</span>
              <input
                type="number"
                inputMode="decimal"
                value={manualSize}
                onChange={(e) => setManualSize(e.target.value)}
                aria-label="Optional manual position size"
                placeholder="optional"
              />
            </label>
            <label className="field">
              <span>Actual fill price</span>
              <input
                type="number"
                inputMode="decimal"
                value={fillPrice}
                onChange={(e) => setFillPrice(e.target.value)}
                aria-label="Optional actual fill price"
                placeholder="optional"
              />
            </label>
          </div>
        </div>

        <div className="gm-risk-results-navy" data-testid="risk-estimates">
          <h3 className="gm-section-title">Result</h3>
          <div className="grid-2 compact-metrics">
            <div className="metric">
              <span className="label">Stop distance</span>
              <span className="value">{num(estimate.stopDistance)}</span>
            </div>
            <div className="metric">
              <span className="label">Intended max loss</span>
              <span className="value">
                {currency} {estimate.intendedMaxLoss}
              </span>
            </div>
            <div className="metric">
              <span className="label">Est. position size</span>
              <span className="value">{num(estimate.estimatedPositionSize)} *</span>
            </div>
            <div className="metric">
              <span className="label">Est. spread cost</span>
              <span className="value">{num(estimate.estimatedSpreadCost, ` ${currency}`)}</span>
            </div>
            <div className="metric">
              <span className="label">Est. total risk</span>
              <span className={`value ${estimate.exceedsMaxRisk ? "danger-text" : ""}`}>
                {num(estimate.estimatedTotalRisk, ` ${currency}`)} *
              </span>
            </div>
          </div>
          <p className="estimate-note">* Estimate only — confirm in your broker ticket.</p>
        </div>
      </div>

      {estimate.warnings.map((w) => (
        <div key={w} className="banner stale" role="status">
          {w}
        </div>
      ))}
    </section>
  );
}
