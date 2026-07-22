import { Link } from "react-router-dom";
import type { SetupRecord } from "../../types/models";
import { formatLocalTimestamp } from "../../lib/timezone";
import { MetricCard, StatusBadge } from "../ui/primitives";

export type PrimarySignalCardProps = {
  decisionCode: string;
  sessionLabel: string;
  reason: string;
  scoreTotal?: number | null;
  localPrimary: string;
  localZone: string;
  utcSecondary: string;
  poc?: number | null;
  vah?: number | null;
  val?: number | null;
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

/** Strong Primary Signal card — semantic BUY/SELL/WAIT colours. */
export function PrimarySignalCard({
  decisionCode,
  sessionLabel,
  reason,
  scoreTotal,
  localPrimary,
  localZone,
  utcSecondary,
  poc,
  vah,
  val,
  setup,
  source = "live",
  technicalId,
  reasonCodes
}: PrimarySignalCardProps) {
  const tone = decisionTone(decisionCode);
  const hasPlan =
    setup &&
    (setup.levels?.entryPrice != null ||
      setup.levels?.stopLoss != null ||
      setup.levels?.tp1 != null);

  return (
    <section className="gm-section gm-primary-signal" data-testid="primary-signal-card">
      <div className="gm-section-head">
        <h2 className="gm-section-title">Primary signal</h2>
        <div className="gm-primary-badges">
          <StatusBadge tone="gold">XAUUSD</StatusBadge>
          <StatusBadge tone="neutral">{sessionLabel}</StatusBadge>
          {source !== "live" && (
            <StatusBadge tone="warning">{source === "offline" ? "Offline" : "Stale"}</StatusBadge>
          )}
          {setup && <StatusBadge tone="neutral">SHADOW</StatusBadge>}
        </div>
      </div>

      <div className={`gm-decision-hero tone-${tone}`} data-testid="primary-decision">
        <span className="gm-decision-label">{decisionLabel(decisionCode)}</span>
        {scoreTotal != null && (
          <span className="gm-decision-score">Setup quality {scoreTotal}/100</span>
        )}
      </div>

      <p className="gm-primary-reason">{reason}</p>
      <p className="gm-meta" data-testid="primary-local-time">
        {localPrimary} · Your time · {localZone}
        <span className="gm-time-utc"> · {utcSecondary}</span>
      </p>

      <div className="gm-metrics-grid gm-primary-levels">
        <MetricCard label="POC" value={poc ?? "—"} />
        <MetricCard label="VAH" value={vah ?? "—"} />
        <MetricCard label="VAL" value={val ?? "—"} />
        <MetricCard
          label="Lifecycle"
          value={setup ? String(setup.status).replace(/_/g, " ") : "No plan"}
        />
      </div>

      {hasPlan ? (
        <div className="gm-metrics-grid" style={{ marginTop: 12 }} data-testid="primary-plan-levels">
          <MetricCard label="Entry" value={setup?.levels?.entryPrice ?? "—"} />
          <MetricCard label="Stop" value={setup?.levels?.stopLoss ?? "—"} />
          <MetricCard label="TP1" value={setup?.levels?.tp1 ?? "—"} />
          <MetricCard label="TP2" value={setup?.levels?.tp2 ?? "—"} />
          <MetricCard label="TP3" value={setup?.levels?.tp3 ?? "—"} />
        </div>
      ) : (
        <div className="gm-empty" data-testid="no-shadow-plan" role="status">
          <strong>No validated shadow plan yet.</strong>
          <p className="gm-meta">V4 remains SHADOW only. GoldMeta does not place trades.</p>
        </div>
      )}

      <details className="gm-disclosure" data-testid="disclosure-panel">
        <summary>Technical details</summary>
        <div className="gm-disclosure-body">
          <p className="gm-meta">
            Decision ID: {technicalId ?? "—"}
            <br />
            Raw codes: {(reasonCodes ?? []).join(", ") || "none"}
          </p>
          {setup && (
            <p className="gm-meta">
              <Link to={`/setups/${setup.setupId}`}>Open setup detail</Link>
            </p>
          )}
        </div>
      </details>
    </section>
  );
}

export function formatSetupLocal(iso: string | null | undefined) {
  return formatLocalTimestamp(iso);
}
