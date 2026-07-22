import type { SetupRecord } from "../../types/models";
import { StatusBadge } from "../ui/primitives";
import { formatCompactLocalTime } from "../../lib/timezone";

export type PrimarySignalCardProps = {
  decisionCode: string;
  sessionLabel: string;
  reason: string;
  scoreTotal?: number | null;
  compactTime: string;
  timeZone: string;
  utcSecondary: string;
  livePrice?: number | null;
  setup?: SetupRecord | null;
  source?: "live" | "cached" | "offline";
  technicalId?: string | null;
  reasonCodes?: string[];
};

function decisionTone(code: string): "buy" | "sell" | "wait" | "blocked" {
  const d = code.toUpperCase();
  if (d === "BUY") return "buy";
  if (d === "SELL") return "sell";
  if (d.includes("BLOCK")) return "blocked";
  return "wait";
}

function decisionLabel(code: string): string {
  const d = code.toUpperCase();
  if (d === "BUY") return "BUY";
  if (d === "SELL") return "SELL";
  if (d === "WAIT") return "WAIT";
  return d;
}

function decisionIcon(tone: string): string {
  if (tone === "buy") return "▲";
  if (tone === "sell") return "▼";
  return "●";
}

/** Dominant Primary Signal — decision, price, score, session, reason. Plan lives separately. */
export function PrimarySignalCard({
  decisionCode,
  sessionLabel,
  reason,
  scoreTotal,
  compactTime,
  timeZone,
  utcSecondary,
  livePrice,
  setup,
  source = "live",
  technicalId,
  reasonCodes
}: PrimarySignalCardProps) {
  const tone = decisionTone(decisionCode);
  const planStatus = setup
    ? String(setup.status).replace(/_/g, " ")
    : "No validated shadow plan";

  return (
    <section
      className="gm-section gm-primary-signal gm-primary-signal--hero"
      data-testid="primary-signal-card"
      aria-live="polite"
    >
      <div className="gm-primary-top">
        <div className="gm-primary-badges">
          <StatusBadge tone="gold">XAUUSD</StatusBadge>
          {setup && <StatusBadge tone="research">SHADOW</StatusBadge>}
          {source !== "live" && (
            <StatusBadge tone="warning">{source === "offline" ? "Offline" : "Stale"}</StatusBadge>
          )}
        </div>
        <time
          className="gm-freshness"
          data-testid="primary-local-time"
          title={`${utcSecondary}`}
          dateTime={compactTime}
        >
          Updated {compactTime}
          <span className="gm-meta"> · {timeZone}</span>
        </time>
      </div>

      <div className={`gm-decision-hero tone-${tone}`} data-testid="primary-decision">
        <span className="gm-decision-icon" aria-hidden>
          {decisionIcon(tone)}
        </span>
        <span className="gm-decision-label">{decisionLabel(decisionCode)}</span>
      </div>

      <div className="gm-primary-inline" data-testid="primary-inline-metrics">
        <div>
          <span className="gm-label">Price</span>
          <strong data-testid="primary-live-price">
            {livePrice != null ? Number(livePrice).toFixed(2) : "—"}
          </strong>
        </div>
        <div>
          <span className="gm-label">Score</span>
          <strong>{scoreTotal != null ? `${scoreTotal}/100` : "—"}</strong>
        </div>
        <div>
          <span className="gm-label">Session</span>
          <strong>{sessionLabel}</strong>
        </div>
        <div>
          <span className="gm-label">Plan</span>
          <strong className="gm-plan-status-inline">{planStatus}</strong>
        </div>
      </div>

      <p className="gm-primary-reason">{reason}</p>

      <details className="gm-disclosure" data-testid="disclosure-panel">
        <summary>Technical details</summary>
        <div className="gm-disclosure-body">
          <p className="gm-meta">
            Decision ID: {technicalId ?? "—"}
            <br />
            Raw codes: {(reasonCodes ?? []).join(", ") || "none"}
            <br />
            UTC: {utcSecondary}
          </p>
        </div>
      </details>
    </section>
  );
}

export { formatCompactLocalTime };
