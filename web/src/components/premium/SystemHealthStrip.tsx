import type { SystemHealthView } from "../../lib/broker/ctraderTypes";

type Props = {
  health: SystemHealthView;
};

function Dot({ tone }: { tone: string }) {
  const cls =
    tone === "green" ? "is-ok" : tone === "red" ? "is-warn" : "is-amber";
  return <span className={`gm-health-dot ${cls}`} aria-hidden />;
}

export function SystemHealthStrip({ health }: Props) {
  const items = [
    ["Market feed", health.marketFeed],
    ["Strategy feed", health.strategyFeed],
    ["Broker", health.broker],
    ["AutoTrade engine", health.autoTradeEngine],
    ["Risk engine", health.riskEngine],
    ["Notifications", health.notifications],
    ["Qualification", health.qualificationWorker]
  ] as const;

  return (
    <section className="gm-prem-card gm-system-health" data-testid="system-health" aria-label="System health">
      <div className="gm-qual-dash__head">
        <div>
          <p className="gm-label">System health</p>
          <h2>{health.plainSummary}</h2>
        </div>
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
