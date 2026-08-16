import { GhStatusTone, formatEur, useGoldHunter } from "./GoldHunterShell";
import { formatResearchLocalTime, formatResearchUtcTime } from "../../lib/formatResearchLocalTime";

export function GoldHunterMonitorPage() {
  const { status } = useGoldHunter();
  if (!status) return null;

  const open = status.openTrades[0] ?? null;
  const primaryWait = !status.config.demoAutoTradeEnabled
    ? "WAIT — AUTOTRADE OFF"
    : status.gates.blockers[0] ?? status.signal.note;

  return (
    <div data-testid="gh-monitor">
      <section className="gh-hero">
        <div className="gh-hero-top">
          <div>
            <div className="gh-hero-symbol">Live Monitor</div>
            <div className="gh-hero-meta">
              <GhStatusTone value={status.health.transport} />
              <GhStatusTone value={status.market.marketStatus} />
            </div>
          </div>
          <div className="gh-hero-price">
            {status.market.mid != null ? status.market.mid.toFixed(2) : "—"}
          </div>
        </div>
        <div className="gh-hero-meta">
          <span>
            Bid <strong>{status.market.bid?.toFixed(2) ?? "—"}</strong>
          </span>
          <span>
            Ask <strong>{status.market.ask?.toFixed(2) ?? "—"}</strong>
          </span>
          <span>
            Spread <strong>{status.market.spread?.toFixed(2) ?? "—"}</strong>
          </span>
          <span>
            Spot age{" "}
            <strong>
              {status.market.ageMs != null
                ? `${Math.round(status.market.ageMs / 1000)}s`
                : "—"}
            </strong>
          </span>
        </div>
      </section>

      <div className="gh-wait" data-testid="gh-monitor-wait">
        {primaryWait}
      </div>

      <section className="gh-card" style={{ marginBottom: 12 }}>
        <h3>Current signal</h3>
        {status.signal.present ? (
          <div>
            <span className="gh-badge">{status.signal.side}</span>{" "}
            <span className="gh-badge gh-badge--demo">SELECTED SIGNAL</span>
            <p className="hint" style={{ marginTop: 8 }}>
              Setup {status.signal.setup}
              {status.signal.quality != null
                ? ` · quality ${(status.signal.quality * 100).toFixed(0)}%`
                : ""}
            </p>
            {status.signal.signalId ? (
              <p className="hint" data-testid="gh-signal-id">
                Signal {status.signal.signalId}
                {status.signal.consumed ? " · consumed" : " · unconsumed"}
              </p>
            ) : null}
            <div className="gh-hero-meta" style={{ marginTop: 8 }}>
              <span>
                Depth <strong>{status.signal.depthValidity ?? status.health.depth}</strong>
              </span>
              <span>
                Spread <strong>{status.market.spread?.toFixed(2) ?? "—"}</strong>
              </span>
              <span>
                Age{" "}
                <strong>
                  {status.signal.ageMs != null
                    ? `${Math.round(status.signal.ageMs / 1000)}s`
                    : "—"}
                </strong>
              </span>
              <span>
                Gates{" "}
                <strong>{status.gates.ok ? "READY" : status.gates.blockers[0] ?? "WAIT"}</strong>
              </span>
            </div>
          </div>
        ) : (
          <div className="gh-empty" style={{ padding: 12 }}>
            <span className="gh-badge gh-badge--muted">
              {status.strategyPipeline?.selector === "CONNECTED"
                ? "WAITING"
                : "RESEARCH OBSERVATION"}
            </span>
            <p style={{ marginTop: 8 }}>{status.signal.note}</p>
          </div>
        )}
      </section>

      <section className="gh-card" style={{ marginBottom: 12 }}>
        <h3>Order gates</h3>
        <div className="gh-health">
          {(
            [
              ["Data", status.health.marketFeed === "LIVE" ? "READY" : "BLOCKED"],
              ["Depth", status.health.depth === "VALID" ? "READY" : status.health.depth],
              [
                "Spread",
                status.gates.blockers.includes("WAIT — SPREAD TOO WIDE") ? "BLOCKED" : "READY"
              ],
              ["Risk", status.health.risk === "NORMAL" ? "READY" : status.health.risk],
              [
                "Capital",
                status.gates.blockers.includes("WAIT — CAPITAL LIMIT") ? "BLOCKED" : "READY"
              ],
              [
                "Broker",
                status.broker.connected && status.broker.environment === "DEMO"
                  ? "READY"
                  : "BLOCKED"
              ]
            ] as const
          ).map(([label, value]) => (
            <div className="gh-health-item" key={label}>
              <span className="label">{label}</span>
              <span className="value">
                <GhStatusTone value={value} />
              </span>
            </div>
          ))}
        </div>
        {status.gates.blockers.length > 0 ? (
          <ul
            style={{ margin: "8px 0 0", paddingLeft: 16, fontSize: "0.75rem", color: "var(--gh-muted)" }}
            data-testid="gh-gate-list"
          >
            {status.gates.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : (
          <p className="hint">All gates clear — awaiting natural signal.</p>
        )}
      </section>

      <section className="gh-card" style={{ marginBottom: 12 }}>
        <h3>Live Demo position</h3>
        {open ? (
          <div className="gh-trade-card" data-testid="gh-open-position">
            <header>
              <div>
                <span className="gh-badge gh-badge--demo">DEMO POSITION</span>{" "}
                <span className="gh-badge">{open.side}</span>
              </div>
              <strong>{open.goldHunterTradeId}</strong>
            </header>
            <div className="gh-trade-grid">
              <div>
                <span>Entry</span>
                <strong>{open.entry?.toFixed(2) ?? "—"}</strong>
              </div>
              <div>
                <span>Protection</span>
                <strong>{open.stop?.toFixed(2) ?? "—"}</strong>
              </div>
              <div>
                <span>Strategy</span>
                <strong>GOLD_HUNTER</strong>
              </div>
              <div>
                <span>Account</span>
                <strong>DEMO</strong>
              </div>
              <div>
                <span>Broker position</span>
                <strong>{maskId(open.brokerPositionId)}</strong>
              </div>
              <div>
                <span>Filled</span>
                <strong title={formatResearchUtcTime(open.fillTs)}>
                  {formatResearchLocalTime(open.fillTs)}
                </strong>
              </div>
            </div>
          </div>
        ) : (
          <div className="gh-empty">No open Gold Hunter Demo position</div>
        )}
        {status.unmatchedDemoPositions.map((u) => (
          <div key={u.brokerPositionId} className="gh-trade-card">
            <span className="gh-badge gh-badge--warn">{u.label}</span>
            <p className="hint" style={{ marginTop: 8 }}>
              {u.note}
            </p>
          </div>
        ))}
      </section>

      <section className="gh-card">
        <h3>Order timeline</h3>
        {open ? (
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: "0.78rem" }}>
            {(
              [
                ["SIGNAL", open.signalTs],
                ["ORDER CREATED", open.orderTs],
                ["SENT TO CTRADER DEMO", open.orderTs],
                ["FILLED", open.fillTs],
                ["PROTECTED", open.status === "PROTECTED" || open.status === "FILLED" ? open.fillTs : null],
                ["CLOSED", open.closeTs]
              ] as const
            ).map(([label, ts]) => (
              <li key={label} style={{ marginBottom: 4 }}>
                <strong>{label}</strong>{" "}
                <span title={formatResearchUtcTime(ts)}>{formatResearchLocalTime(ts)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="gh-empty">No Demo order pipeline active</div>
        )}
        <p className="hint" style={{ marginTop: 8 }}>
          Running P/L shown only from broker-confirmed Demo fills — never fabricated.
          {open ? ` ${formatEur(open.netPnlEur)}` : ""}
        </p>
      </section>
    </div>
  );
}

function maskId(id: string | null): string {
  if (!id) return "—";
  if (id.length <= 4) return id;
  return `…${id.slice(-4)}`;
}
