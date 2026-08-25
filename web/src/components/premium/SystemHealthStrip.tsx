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

const TRADING_KEYS = [
  "Market feed",
  "Strategy feed",
  "Broker",
  "Risk engine"
] as const;

export function SystemHealthStrip({ health, compact = true }: Props) {
  const items = [
    ["Market feed", health.marketFeed],
    ["Strategy feed", health.strategyFeed],
    ["Broker", health.broker],
    ["Risk engine", health.riskEngine],
    ["Notifications", health.notifications]
  ] as const;

  const tradingIssues = useMemo(
    () =>
      items.filter(
        ([label, row]) =>
          TRADING_KEYS.includes(label as (typeof TRADING_KEYS)[number]) && row.tone !== "green"
      ),
    [items]
  );
  const notificationsOptional =
    health.notifications.tone !== "green" &&
    /block|disabled|permission|denied|off/i.test(health.notifications.label);

  const tradingHealthy = tradingIssues.length === 0;
  const [open, setOpen] = useState(!tradingHealthy && !compact);

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
            {tradingHealthy
              ? "Trading systems healthy"
              : `${tradingIssues.length} trading item${
                  tradingIssues.length === 1 ? "" : "s"
                } need attention`}
          </strong>
          {notificationsOptional ? (
            <span className="gm-meta" data-testid="system-health-optional">
              Optional: Phone notifications disabled
            </span>
          ) : (
            <span className="gm-meta">{tradingHealthy ? "All trading systems healthy" : "View details"}</span>
          )}
        </button>
      </section>
    );
  }

  return (
    <section className="gm-prem-card gm-system-health" data-testid="system-health" aria-label="System health">
      <div className="gm-qual-dash__head">
        <div>
          <p className="gm-label">System health</p>
          <h2>{tradingHealthy ? "Trading systems healthy" : health.plainSummary}</h2>
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
              <strong>
                {label}
                {label === "Notifications" ? " (optional)" : ""}
              </strong>
              <span>{row.label}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
