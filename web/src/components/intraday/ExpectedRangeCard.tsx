import { useEffect, useId, useMemo, useState } from "react";
import type { ExpectedRange, ZoneGuide } from "../../types/intradayPlan";
import { fmtPrice } from "../../lib/intradayFormat";
import {
  buildRangeLevels,
  classifyRangeLocation,
  dayTradeGuidance,
  distLabel,
  nearestDecisionLevels,
  pctAlong,
  pointsAndPercent,
  rangeConfidenceBand,
  rangeDataModeLabel,
  rangeLocationLabel,
  rangeStatusBadge,
  type RangeLevelPoint
} from "../../lib/rangeMapHelpers";

type Props = {
  range: ExpectedRange;
  zones?: ZoneGuide | null;
  marketStructureMode?: string | null;
};

export function ExpectedRangeCard({
  range,
  zones = null,
  marketStructureMode = null
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const panelId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const location = useMemo(() => classifyRangeLocation(range), [range]);
  const confidenceBand = rangeConfidenceBand(range.confidence);
  const dataMode = rangeDataModeLabel(
    marketStructureMode ?? (!range.rangeAvailable ? "UNAVAILABLE" : null)
  );
  const badge = rangeStatusBadge({
    location,
    mode: marketStructureMode,
    rangeAvailable: range.rangeAvailable,
    remainingAbovePoints: range.remainingAbovePoints,
    remainingBelowPoints: range.remainingBelowPoints
  });
  const guidance = dayTradeGuidance({
    location,
    mode: marketStructureMode,
    rangeAvailable: range.rangeAvailable
  });
  const levels = useMemo(() => buildRangeLevels(range), [range]);
  const open = levels.find((p) => p.id === openId) ?? null;
  const nearest = nearestDecisionLevels(range, zones);

  if (!range.rangeAvailable || levels.length === 0) {
    return (
      <section
        className="gm-intra-range gm-range-map"
        data-testid="expected-range-card"
        aria-label="Day trade range map"
      >
        <div className="gm-section-head">
          <h2 className="gm-section-title">Day Trade Range Map</h2>
          <span className="gm-range-badge tone-incomplete" data-testid="range-status-badge">
            Range incomplete
          </span>
        </div>
        <div className="gm-range-summary" data-testid="range-summary">
          <span>
            <em>Current location</em> <strong data-testid="range-location">Unknown</strong>
          </span>
          <span>
            <em>Range confidence</em>{" "}
            <strong data-testid="range-confidence-band">{confidenceBand}</strong>
          </span>
          <span>
            <em>Data mode</em> <strong data-testid="range-data-mode">{dataMode}</strong>
          </span>
        </div>
        <p className="gm-intra-why-not" data-testid="range-unavailable" role="status">
          {range.unavailableReason ?? "Probable range unavailable."}
        </p>
        <p className="gm-range-guidance" data-testid="range-guidance">
          {guidance}
        </p>
        <p className="gm-meta" data-testid="range-disclaimer">
          {range.estimateDisclaimer}
        </p>
      </section>
    );
  }

  const stretchLow = range.stretchLow!;
  const stretchHigh = range.stretchHigh!;
  const markerPct = pctAlong(range.currentPrice, stretchLow, stretchHigh);
  const probLowPct = pctAlong(range.probableLow, stretchLow, stretchHigh);
  const probHighPct = pctAlong(range.probableHigh, stretchLow, stretchHigh);

  return (
    <section
      className="gm-intra-range gm-range-map"
      data-testid="expected-range-card"
      aria-label="Day trade range map"
    >
      <div className="gm-section-head">
        <div>
          <h2 className="gm-section-title">Day Trade Range Map</h2>
          <p className="gm-meta gm-range-estimate-note">Estimated levels — not guaranteed targets</p>
        </div>
        <span
          className={`gm-range-badge tone-${badgeTone(badge)}`}
          data-testid="range-status-badge"
        >
          {badge}
        </span>
      </div>

      <div className="gm-range-summary" data-testid="range-summary">
        <span>
          <em>Current location</em>{" "}
          <strong data-testid="range-location">{rangeLocationLabel(location)}</strong>
        </span>
        <span>
          <em>Range confidence</em>{" "}
          <strong data-testid="range-confidence-band">{confidenceBand}</strong>
        </span>
        <span>
          <em>Data mode</em> <strong data-testid="range-data-mode">{dataMode}</strong>
        </span>
      </div>

      <div className="gm-range-map-body" data-testid="range-ladder">
        <div className="gm-range-scale" data-testid="range-track">
          <div className="gm-range-scale-stretch" aria-hidden="true" />
          <div
            className="gm-range-scale-probable"
            style={{
              left: `${probLowPct}%`,
              width: `${Math.max(2, probHighPct - probLowPct)}%`
            }}
            aria-hidden="true"
          />
          <div
            className="gm-range-scale-bear"
            style={{ width: `${markerPct}%` }}
            aria-hidden="true"
          />
          <div
            className="gm-range-scale-bull"
            style={{ left: `${markerPct}%`, width: `${100 - markerPct}%` }}
            aria-hidden="true"
          />
          <div
            className="gm-range-pin"
            style={{ left: `${markerPct}%` }}
            data-testid="range-current-pin"
            aria-hidden="true"
          >
            <i />
          </div>
          {levels.map((p) => {
            if (p.id === "current") return null;
            const left = pctAlong(p.price, stretchLow, stretchHigh);
            return (
              <span
                key={`tick-${p.id}`}
                className={`gm-range-scale-tick kind-${p.id}`}
                style={{ left: `${left}%` }}
                aria-hidden="true"
              />
            );
          })}
        </div>

        <div
          className="gm-range-scale-labels"
          role="group"
          aria-label="Range levels"
          data-testid="range-mobile-ladder"
        >
          {levels.map((p) => (
            <LevelButton
              key={p.id}
              point={p}
              current={range.currentPrice}
              open={openId === p.id}
              panelId={panelId}
              onToggle={() => setOpenId(openId === p.id ? null : p.id)}
            />
          ))}
        </div>
      </div>

      <div className="gm-range-metrics" data-testid="range-metrics">
        <div>
          <span className="gm-label">Room up</span>
          <strong data-testid="range-room-up">
            {range.remainingAbovePoints != null
              ? `${range.remainingAbovePoints.toFixed(1)} pts`
              : "—"}
          </strong>
        </div>
        <div>
          <span className="gm-label">Room down</span>
          <strong data-testid="range-room-down">
            {range.remainingBelowPoints != null
              ? `${range.remainingBelowPoints.toFixed(1)} pts`
              : "—"}
          </strong>
        </div>
        <div>
          <span className="gm-label">Nearest upside level</span>
          <strong data-testid="range-nearest-upside">{fmtPrice(nearest.upside)}</strong>
        </div>
        <div>
          <span className="gm-label">Nearest downside level</span>
          <strong data-testid="range-nearest-downside">{fmtPrice(nearest.downside)}</strong>
        </div>
      </div>

      <p className="gm-range-guidance" data-testid="range-guidance" role="status">
        {guidance}
      </p>

      {open && (
        <div
          id={panelId}
          className="gm-range-explain"
          role="dialog"
          aria-label={`${open.label} explanation`}
          data-testid="range-level-explain"
        >
          <strong>
            {fmtPrice(open.price)} — {open.label}
            {open.estimated ? " (estimate)" : ""}
          </strong>
          <p className="gm-meta" data-testid="range-level-stats">
            {open.id === "current"
              ? "Current verified price"
              : distLabel(range.currentPrice, open.price)}
          </p>
          <p>
            <span className="gm-label">Why it matters</span>
            {open.why}
          </p>
          {range.reasons[0] && <p className="gm-meta">{range.reasons[0]}</p>}
          <button
            type="button"
            className="gm-btn-outline gm-drawer-close"
            onClick={() => setOpenId(null)}
          >
            Close
          </button>
        </div>
      )}

      <details className="gm-intra-details gm-mobile-collapse">
        <summary>Why this range</summary>
        <ul className="gm-intra-range-reasons" data-testid="range-reasons">
          {range.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="gm-meta" data-testid="range-invalidation">
          Recalculate when: {range.invalidation}
        </p>
      </details>
      <p className="gm-meta" data-testid="range-disclaimer">
        {range.estimateDisclaimer}
      </p>
    </section>
  );
}

function LevelButton({
  point,
  current,
  open,
  panelId,
  onToggle
}: {
  point: RangeLevelPoint;
  current: number | null;
  open: boolean;
  panelId: string;
  onToggle: () => void;
}) {
  const { points, percent } = pointsAndPercent(current, point.price);
  const tip =
    point.id === "current"
      ? `${point.label}: ${fmtPrice(point.price)}`
      : `${point.label}: ${fmtPrice(point.price)} · ${distLabel(current, point.price)}${
          point.estimated ? " · estimate" : ""
        }`;

  return (
    <button
      type="button"
      className={`gm-range-level kind-${point.id}${open ? " is-open" : ""}${
        point.estimated ? " is-estimate" : ""
      }`}
      title={tip}
      aria-expanded={open}
      aria-controls={panelId}
      data-testid={`range-node-${point.id}`}
      onClick={onToggle}
    >
      <span className="gm-range-level-label">
        <span className="gm-range-label-full">{point.label}</span>
        <span className="gm-range-label-short">{point.shortLabel}</span>
        {point.estimated && <span className="gm-range-est">est.</span>}
      </span>
      <strong data-testid={point.testId}>{fmtPrice(point.price)}</strong>
      {point.id !== "current" && (
        <em className="gm-range-dist" data-testid={`range-dist-${point.id}`}>
          {points != null
            ? `${Math.abs(points).toFixed(1)} pts${percent != null ? ` · ${percent.toFixed(2)}%` : ""}`
            : "—"}
        </em>
      )}
    </button>
  );
}

function badgeTone(badge: string): string {
  if (badge === "No trade") return "notrade";
  if (badge === "Range incomplete") return "incomplete";
  if (badge === "Near resistance" || badge === "Room to fall") return "bear";
  if (badge === "Near support" || badge === "Room to rise") return "bull";
  return "mid";
}
