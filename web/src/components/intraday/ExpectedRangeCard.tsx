import { useEffect, useId, useState } from "react";
import type { ExpectedRange } from "../../types/intradayPlan";
import { fmtPrice, valueLocationLabel } from "../../lib/intradayFormat";

type Props = {
  range: ExpectedRange;
};

type LadderPoint = {
  id: string;
  label: string;
  price: number;
  kind: "stretch-low" | "probable-low" | "current" | "probable-high" | "stretch-high";
  why: string;
  testId: string;
};

function pctAlong(value: number | null, low: number | null, high: number | null): number {
  if (value == null || low == null || high == null || high <= low) return 50;
  return Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100));
}

function distLabel(from: number | null, to: number | null): string {
  if (from == null || to == null) return "—";
  const pts = to - from;
  const pct = from !== 0 ? (Math.abs(pts) / from) * 100 : 0;
  const arrow = pts > 0 ? "↑" : pts < 0 ? "↓" : "·";
  return `${arrow} ${Math.abs(pts).toFixed(1)} pts · ${pct.toFixed(2)}%`;
}

export function ExpectedRangeCard({ range }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const panelId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!range.rangeAvailable) {
    return (
      <section
        className="gm-intra-range"
        data-testid="expected-range-card"
        aria-label="Expected intraday range"
      >
        <div className="gm-section-head">
          <h2 className="gm-section-title">Expected range</h2>
          <span className="gm-meta">{valueLocationLabel(range.valueLocation)}</span>
        </div>
        <p className="gm-intra-why-not" data-testid="range-unavailable" role="status">
          {range.unavailableReason ?? "Probable range unavailable."}
        </p>
        <p className="gm-meta">{range.estimateDisclaimer}</p>
      </section>
    );
  }

  const stretchLow = range.stretchLow!;
  const stretchHigh = range.stretchHigh!;
  const points: LadderPoint[] = [
    {
      id: "stretch-low",
      label: "Stretch Low",
      price: stretchLow,
      kind: "stretch-low",
      why: "Outer downside estimate. Markets can still move beyond stretch levels.",
      testId: "range-stretch-low"
    },
    {
      id: "probable-low",
      label: "Probable Low",
      price: range.probableLow!,
      kind: "probable-low",
      why: "Nearest verified support / downside bound for the current research window.",
      testId: "range-probable-low"
    },
    {
      id: "current",
      label: "Current Price",
      price: range.currentPrice!,
      kind: "current",
      why: "Live / last verified price marker for the ladder.",
      testId: "range-current"
    },
    {
      id: "probable-high",
      label: "Probable High",
      price: range.probableHigh!,
      kind: "probable-high",
      why: "Nearest verified resistance / upside bound for the current research window.",
      testId: "range-probable-high"
    },
    {
      id: "stretch-high",
      label: "Stretch High",
      price: stretchHigh,
      kind: "stretch-high",
      why: "Outer upside estimate. Stretch is not a guaranteed target.",
      testId: "range-stretch-high"
    }
  ];

  const markerPct = pctAlong(range.currentPrice, stretchLow, stretchHigh);
  const probLowPct = pctAlong(range.probableLow, stretchLow, stretchHigh);
  const probHighPct = pctAlong(range.probableHigh, stretchLow, stretchHigh);
  const open = points.find((p) => p.id === openId) ?? null;
  const directionUp =
    (range.remainingAbovePoints ?? 0) >= (range.remainingBelowPoints ?? 0);

  return (
    <section
      className="gm-intra-range"
      data-testid="expected-range-card"
      aria-label="Expected intraday range ladder"
    >
      <div className="gm-section-head">
        <h2 className="gm-section-title">Expected range</h2>
        <span className="gm-meta">
          {valueLocationLabel(range.valueLocation)} · {range.confidence}%
        </span>
      </div>

      <div className="gm-range-ladder" data-testid="range-ladder">
        <div className="gm-range-ladder-track" data-testid="range-track">
          <div
            className="gm-intra-range-probable"
            style={{ left: `${probLowPct}%`, width: `${Math.max(2, probHighPct - probLowPct)}%` }}
          />
          <div
            className="gm-intra-range-marker"
            style={{ left: `${markerPct}%` }}
            aria-hidden="true"
          />
          <span
            className={`gm-range-direction ${directionUp ? "up" : "down"}`}
            aria-hidden="true"
            data-testid="range-direction"
          >
            {directionUp ? "→" : "←"}
          </span>
          {points.map((p) => {
            const left = pctAlong(p.price, stretchLow, stretchHigh);
            return (
              <button
                key={p.id}
                type="button"
                className={`gm-range-node kind-${p.kind}${openId === p.id ? " is-open" : ""}`}
                style={{ left: `${left}%` }}
                title={`${p.label} ${fmtPrice(p.price)} — ${p.why}`}
                aria-expanded={openId === p.id}
                aria-controls={panelId}
                data-testid={`range-node-${p.id}`}
                onClick={() => setOpenId(openId === p.id ? null : p.id)}
              >
                <span className="gm-range-node-label">{p.label}</span>
                <strong data-testid={p.testId}>{fmtPrice(p.price)}</strong>
                {p.kind !== "current" && (
                  <em className="gm-meta">{distLabel(range.currentPrice, p.price)}</em>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="gm-intra-range-remain" data-testid="range-remaining">
        <span>
          Remaining above:{" "}
          <strong>
            {range.remainingAbovePoints != null
              ? `${range.remainingAbovePoints.toFixed(1)} pts (${range.remainingAbovePercent ?? "—"}%)`
              : "—"}
          </strong>
        </span>
        <span>
          Remaining below:{" "}
          <strong>
            {range.remainingBelowPoints != null
              ? `${range.remainingBelowPoints.toFixed(1)} pts (${range.remainingBelowPercent ?? "—"}%)`
              : "—"}
          </strong>
        </span>
      </div>

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
          </strong>
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
