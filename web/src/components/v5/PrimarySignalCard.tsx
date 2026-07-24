import { Link } from "react-router-dom";
import type { SetupRecord } from "../../types/models";
import { formatLocalTimestamp } from "../../lib/timezone";
import { structureLevelLabel } from "../../lib/plainLanguage";
import { glossaryById } from "../../lib/glossary";
import { MetricCard, StatusBadge } from "../ui/primitives";

export type PrimarySignalCardProps = {
  decisionCode: string;
  sessionLabel: string;
  reason: string;
  scoreTotal?: number | null;
  /** 0–100 confidence when available from decision. */
  confidence?: number | null;
  marketTrend?: string | null;
  localPrimary: string;
  localZone: string;
  utcSecondary: string;
  poc?: number | null;
  vah?: number | null;
  val?: number | null;
  setup?: SetupRecord | null;
  entry?: number | null;
  stopLoss?: number | null;
  tp1?: number | null;
  tp2?: number | null;
  tp3?: number | null;
  estimatedRisk?: string | null;
  source?: "live" | "cached" | "offline";
  technicalId?: string | null;
  reasonCodes?: string[];
  brokerConnected?: boolean;
  autoTradeOff?: boolean;
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

function decisionHint(code: string): string {
  const g = glossaryById(code.toLowerCase());
  return g?.short ?? "GoldMeta decision for gold (XAUUSD).";
}

function fmt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return String(n);
}

/** Strong Primary Signal card — semantic BUY/SELL/WAIT colours. */
export function PrimarySignalCard({
  decisionCode,
  sessionLabel,
  reason,
  scoreTotal,
  confidence,
  marketTrend,
  localPrimary,
  localZone,
  utcSecondary,
  poc,
  vah,
  val,
  setup,
  entry,
  stopLoss,
  tp1,
  tp2,
  tp3,
  estimatedRisk,
  source = "live",
  technicalId,
  reasonCodes,
  brokerConnected = false,
  autoTradeOff = true
}: PrimarySignalCardProps) {
  const tone = decisionTone(decisionCode);
  const planEntry = entry ?? setup?.levels?.entryPrice ?? null;
  const planStop = stopLoss ?? setup?.levels?.stopLoss ?? null;
  const planTp1 = tp1 ?? setup?.levels?.tp1 ?? null;
  const planTp2 = tp2 ?? setup?.levels?.tp2 ?? null;
  const planTp3 = tp3 ?? setup?.levels?.tp3 ?? null;
  const hasPlan =
    planEntry != null || planStop != null || planTp1 != null || planTp2 != null || planTp3 != null;
  const confidencePct =
    confidence != null
      ? Math.round(confidence <= 1 ? confidence * 100 : confidence)
      : scoreTotal != null
        ? Math.round(scoreTotal)
        : null;

  return (
    <section className="gm-section gm-primary-signal" data-testid="primary-signal-card">
      <div className="gm-section-head">
        <h2 className="gm-section-title">What should I do?</h2>
        <div className="gm-primary-badges">
          <StatusBadge tone="gold">XAUUSD</StatusBadge>
          <StatusBadge tone="neutral">{sessionLabel}</StatusBadge>
          {source !== "live" && (
            <StatusBadge tone="warning">{source === "offline" ? "Offline" : "Stale"}</StatusBadge>
          )}
          {hasPlan ? (
            <StatusBadge tone="positive">Plan ready</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">No trade plan yet</StatusBadge>
          )}
        </div>
      </div>

      <div className={`gm-decision-hero tone-${tone}`} data-testid="primary-decision">
        <span className="gm-decision-label" aria-label={`Decision ${decisionLabel(decisionCode)}`}>
          {decisionLabel(decisionCode)}
        </span>
        {confidencePct != null && (
          <span className="gm-decision-score" data-testid="primary-confidence">
            Confidence {confidencePct}%
          </span>
        )}
      </div>
      <p className="gm-meta" data-testid="decision-hint">
        {decisionHint(decisionCode)}
      </p>

      <p className="gm-primary-reason" data-testid="primary-reason">
        {reason}
      </p>

      <div className="gm-metrics-grid gm-primary-plan" data-testid="primary-plan-levels">
        <MetricCard label="Market trend" value={marketTrend?.replace(/_/g, " ") ?? "—"} />
        <MetricCard label="Entry" value={fmt(planEntry)} />
        <MetricCard label="Stop loss" value={fmt(planStop)} />
        <MetricCard label="TP1" value={fmt(planTp1)} />
        <MetricCard label="TP2" value={fmt(planTp2)} />
        <MetricCard label="TP3" value={fmt(planTp3)} />
        <MetricCard label="Estimated risk" value={estimatedRisk ?? "—"} />
      </div>

      {!hasPlan ? (
        <div className="gm-empty" data-testid="no-shadow-plan" role="status">
          <strong>No validated plan yet.</strong>
          <p className="gm-meta">GoldMeta is watching. It does not place trades while you WAIT.</p>
        </div>
      ) : null}

      <div className="gm-trading-status-row" data-testid="trading-status-strip" aria-label="Trading status">
        <StatusBadge tone={brokerConnected ? "positive" : "warning"}>
          {brokerConnected ? "Broker connected" : "Broker not connected"}
        </StatusBadge>
        <StatusBadge tone={autoTradeOff ? "neutral" : "negative"}>
          {autoTradeOff ? "AutoTrade OFF" : "AutoTrade ON"}
        </StatusBadge>
        <StatusBadge tone="warning">Trading locked</StatusBadge>
      </div>

      <p className="gm-meta" data-testid="primary-local-time">
        {localPrimary} · Your time · {localZone}
        <span className="gm-time-utc"> · {utcSecondary}</span>
      </p>

      <details className="gm-disclosure" data-testid="advanced-levels">
        <summary>Advanced market levels</summary>
        <div className="gm-disclosure-body">
          <div className="gm-metrics-grid gm-primary-levels">
            <MetricCard label={structureLevelLabel("poc")} value={poc ?? "—"} hint="POC" />
            <MetricCard label={structureLevelLabel("vah")} value={vah ?? "—"} hint="VAH" />
            <MetricCard label={structureLevelLabel("val")} value={val ?? "—"} hint="VAL" />
            <MetricCard
              label="Plan status"
              value={setup ? String(setup.status).replace(/_/g, " ") : "No plan"}
            />
          </div>
        </div>
      </details>

      <details className="gm-disclosure" data-testid="disclosure-panel">
        <summary>Technical details</summary>
        <div className="gm-disclosure-body">
          <p className="gm-meta">
            Decision ID: {technicalId ?? "—"}
            <br />
            Raw codes: {(reasonCodes ?? []).join(", ") || "none"}
            {scoreTotal != null ? (
              <>
                <br />
                Setup quality score: {scoreTotal}/100
              </>
            ) : null}
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
