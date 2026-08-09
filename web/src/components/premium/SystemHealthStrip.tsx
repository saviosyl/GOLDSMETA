import { useMemo, useState } from "react";
import type { SystemHealthView } from "../../lib/broker/ctraderTypes";

type Props = {
  health: SystemHealthView;
  /** Compact strip by default; expands when attention needed or user opens details. */
  compact?: boolean;
};

function Dot({ tone }: { tone: string }) {
  const cls =
    tone === "green" ? "is-ok" : tone === "red" ? "is-warn" : "is-amber";
  return <span className={`gm-health-dot ${cls}`} aria-hidden />;
}

export function SystemHealthStrip({ health, compact = true }: Props) {
  const items = [
    ["Market feed", health.marketFeed],
    ["Strategy feed", health.strategyFeed],
    ["Broker", health.broker],
    ["AutoTrade engine", health.autoTradeEngine],
    ["Risk engine", health.riskEngine],
    ["Notifications", health.notifications],
    ["Qualification", health.qualificationWorker]
  ] as const;

  const attentionCount = useMemo(
    () => items.filter(([, row]) => row.tone !== "green").length,
    [items]
  );
  const healthyCount = items.length - attentionCount;
  const needsAttention = attentionCount > 0;
  const [open, setOpen] = useState(needsAttention && !compact);

  if (compact && !open) {
    return (
      <section
        className="gm-prem-card gm-system-health gm-system-health--compact"
        data-testid="system-health"
        aria-label="System health"
      >
        <button
          type="button"
          className="gm-system-health__summary"
          data-testid="system-health-summary"
          onClick={() => setOpen(true)}
          aria-expanded={false}
        >
          <span className="gm-label">Systems</span>
          <strong>
            {needsAttention
              ? `${attentionCount} item${attentionCount === 1 ? "" : "s"} need attention`
              : `${healthyCount}/${items.length} healthy`}
          </strong>
          <span className="gm-meta">{needsAttention ? "View details" : "All systems healthy"}</span>
        </button>
      </section>
    );
  }

  return (
    <section className="gm-prem-card gm-system-health" data-testid="system-health" aria-label="System health">
      <div className="gm-qual-dash__head">
        <div>
          <p className="gm-label">System health</p>
          <h2>{health.plainSummary}</h2>
        </div>
        {compact ? (
          <button
            type="button"
            className="gm-linkish"
            onClick={() => setOpen(false)}
            data-testid="system-health-collapse"
          >
            Collapse
          </button>
        ) : null}
      </div>
      <ul className="gm-health-list">
        {items.map(([label, row]) => (
          <li key={label}>
            <Dot tone={row.tone} />
            <div>
              <strong>{label}</strong>
              <span>{row.label}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
