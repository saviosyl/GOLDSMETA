import { GhStatusTone, formatEur, useGoldHunter } from "./GoldHunterShell";
import { formatResearchLocalTime, formatResearchUtcTime } from "../../lib/formatResearchLocalTime";
import { goldHunterDisplayWait } from "../../lib/goldHunterIdentity";
import { useAuth } from "../../lib/auth";
import { useState } from "react";

function money(n: number | null | undefined, currency: string | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const code = (currency ?? "EUR").toUpperCase();
  try {
    return new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2
    }).format(n);
  } catch {
    return `${code} ${n.toFixed(2)}`;
  }
}

/** Expected / informational waits — not structural arming faults. */
const PRE_ARM_INFORMATIONAL_BLOCKERS = new Set([
  "WAIT — AUTOTRADE OFF",
  "WAIT — NO SETUP SELECTED"
]);

/**
 * When armed, NO SETUP SELECTED is the normal idle wait for the next A/B/C
 * candidate — not a temporary fault. Real blockers are risk/feed/broker stops.
 */
const ARMED_NORMAL_SIGNAL_WAIT_BLOCKERS = new Set(["WAIT — NO SETUP SELECTED"]);

function stripWaitPrefix(blocker: string): string {
  return blocker.replace(/^WAIT —\s*/, "").trim();
}

/** Exported for unit tests — classify order-gate blockers for dashboard truthfulness. */
export function selectMeaningfulOrderBlockers(
  blockers: readonly string[],
  demoAutoTradeEnabled: boolean
): string[] {
  return blockers.filter((b) => {
    if (demoAutoTradeEnabled) {
      return !ARMED_NORMAL_SIGNAL_WAIT_BLOCKERS.has(b);
    }
    return !PRE_ARM_INFORMATIONAL_BLOCKERS.has(b);
  });
}

type DemoLifecycleDisplay = {
  state: string;
  hint: string;
};

/**
 * Truthful Gold Hunter Demo lifecycle for the dashboard.
 * "IN DEMO TRADE" only when a broker-confirmed open position supports it.
 */
export function classifyGoldHunterDemoLifecycle(args: {
  demoAutoTradeEnabled: boolean;
  openTrades: ReadonlyArray<{
    status?: string | null;
    brokerPositionId?: string | null;
  }>;
  brokerOpenPositionCount: number | null | undefined;
  firstRealGateBlocker: string | null;
  armingReady: boolean;
  armingBlockers: readonly string[];
  marketClosed: boolean;
  meaningfulGateBlockers: readonly string[];
}): DemoLifecycleDisplay {
  const {
    demoAutoTradeEnabled,
    openTrades,
    brokerOpenPositionCount,
    firstRealGateBlocker,
    armingReady,
    armingBlockers,
    marketClosed,
    meaningfulGateBlockers
  } = args;

  const brokerConfirmedOpen =
    brokerOpenPositionCount != null &&
    Number.isFinite(brokerOpenPositionCount) &&
    brokerOpenPositionCount > 0;

  const hasCloseRequested = openTrades.some((t) => t.status === "CLOSE_REQUESTED");
  const hasSettlementPending = openTrades.some(
    (t) => t.status === "CLOSE_ACCEPTED_PENDING_SETTLEMENT"
  );
  const hasEntryPendingUnmatched = openTrades.some(
    (t) =>
      t.status === "PENDING_RECONCILIATION" &&
      (t.brokerPositionId == null || String(t.brokerPositionId).trim() === "")
  );
  const hasMatchedGhOpen = openTrades.some(
    (t) =>
      (t.status === "FILLED" ||
        t.status === "PROTECTED" ||
        t.status === "OPEN") &&
      t.brokerPositionId != null &&
      String(t.brokerPositionId).trim() !== ""
  );
  const hasActiveManagedLocal = openTrades.some(
    (t) =>
      t.status === "FILLED" ||
      t.status === "PROTECTED" ||
      t.status === "ACCEPTED_PENDING_FILL" ||
      t.status === "SENT" ||
      t.status === "ORDER_CREATED" ||
      t.status === "OPEN"
  );
  const hasBrokerManagedLocal =
    hasActiveManagedLocal ||
    openTrades.some((t) => t.status === "PENDING_RECONCILIATION");

  if (hasCloseRequested) {
    return {
      state: "RECONCILING DEMO CLOSE",
      hint: brokerConfirmedOpen
        ? "Close requested. Broker still shows an open DEMO position — reconciling without opening another trade."
        : "Close requested. Broker no longer shows the position — settling the close from authoritative broker deals."
    };
  }

  if (hasSettlementPending) {
    return {
      state: "CLOSE SETTLEMENT PENDING",
      hint: "Broker exposure is closed. Waiting for the broker closing deal before recording P/L — not managing an active position."
    };
  }

  // Null/unproven entry pending must never become IN DEMO TRADE merely because
  // the account has some unrelated open position.
  if (hasEntryPendingUnmatched) {
    return {
      state: "RECONCILING DEMO ENTRY",
      hint: "Order transmission outcome is being verified with cTrader. No new order will be sent until broker state is confirmed."
    };
  }

  if (hasMatchedGhOpen && brokerConfirmedOpen) {
    return {
      state: "IN DEMO TRADE",
      hint: "Gold Hunter has an active cTrader DEMO position and is managing it."
    };
  }

  if (hasActiveManagedLocal && brokerConfirmedOpen) {
    return {
      state: "IN DEMO TRADE",
      hint: "Gold Hunter has an active cTrader DEMO position and is managing it."
    };
  }

  if (hasBrokerManagedLocal && !brokerConfirmedOpen) {
    return {
      state: "RECONCILIATION REQUIRED",
      hint: "Local Demo trade state does not match broker open positions. Gold Hunter is reconciling before claiming an active position."
    };
  }

  if (demoAutoTradeEnabled) {
    if (firstRealGateBlocker) {
      return {
        state: "ARMED — TEMPORARILY BLOCKED",
        hint: `No new order right now: ${firstRealGateBlocker}`
      };
    }
    return {
      state: "ARMED — WAITING FOR VALID SIGNAL",
      hint: "The execution engine is live in DEMO mode and is waiting for the next valid A/B/C Gold Hunter setup."
    };
  }

  if (!armingReady) {
    return {
      state: "NOT READY",
      hint:
        armingBlockers.length > 0
          ? `Cannot start yet: ${armingBlockers.join(", ")}`
          : "Cannot start yet."
    };
  }

  if (firstRealGateBlocker) {
    return {
      state: "READY TO ARM",
      hint: `Structurally ready to arm. Current trading status: BLOCKED — ${stripWaitPrefix(firstRealGateBlocker)}`
    };
  }

  if (marketClosed && meaningfulGateBlockers.length === 0) {
    return {
      state: "READY TO ARM — MARKET CLOSED",
      hint: "Structurally ready to arm when the market is open. Start Demo only when you intend cTrader DEMO orders."
    };
  }

  return {
    state: "READY TO ARM",
    hint: "Ready to arm. Start Demo to allow valid Gold Hunter setups to submit cTrader DEMO orders."
  };
}

export function GoldHunterDashboardPage() {
  const { status, refresh } = useGoldHunter();
  const { api } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [demoActionBusy, setDemoActionBusy] = useState(false);
  const [demoActionMessage, setDemoActionMessage] = useState<string | null>(null);
  if (!status) return null;

  const mid = status.market.mid;
  const today = status.capital.todayPnlEur;
  const pf = status.performanceToday;
  const cur = status.broker.currency;
  const demoEnabled = status.config.demoAutoTradeEnabled;
  const armingBlockers = status.arming?.blockers ?? [];
  const meaningfulGateBlockers = selectMeaningfulOrderBlockers(
    status.gates.blockers,
    demoEnabled
  );
  const firstRealGateBlocker = meaningfulGateBlockers[0] ?? null;
  const marketClosed = status.market.marketStatus === "CLOSED";
  const lifecycle = classifyGoldHunterDemoLifecycle({
    demoAutoTradeEnabled: demoEnabled,
    openTrades: status.openTrades,
    brokerOpenPositionCount: status.broker.openPositionCount,
    firstRealGateBlocker,
    armingReady: status.arming?.ready === true,
    armingBlockers,
    marketClosed,
    meaningfulGateBlockers
  });
  const demoState = lifecycle.state;
  const demoHint = lifecycle.hint;
  async function onRefresh() {
    setRefreshing(true);
    try {
      if (typeof api.goldHunterRefreshAccount === "function") {
        await api.goldHunterRefreshAccount();
      }
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }

  async function startDemoAutoTrade() {
    setDemoActionMessage(null);
    setDemoActionBusy(true);
    try {
      await api.goldHunterUpdateConfig({
        demoAutoTradeEnabled: true,
        confirmDemoAutoTrade: true
      });
      await refresh();
      setDemoActionMessage(
        "Gold Hunter Demo is armed. Gold Hunter will place a cTrader DEMO order only when a valid setup passes every safety gate."
      );
    } catch (e) {
      setDemoActionMessage(
        e instanceof Error ? e.message : "Gold Hunter Demo could not be started."
      );
    } finally {
      setDemoActionBusy(false);
    }
  }

  async function stopDemoAutoTrade() {
    setDemoActionMessage(null);
    setDemoActionBusy(true);
    try {
      await api.goldHunterUpdateConfig({ demoAutoTradeEnabled: false });
      await refresh();
      setDemoActionMessage("Gold Hunter Demo is OFF. No new Gold Hunter broker entries will be submitted.");
    } catch (e) {
      setDemoActionMessage(
        e instanceof Error ? e.message : "Gold Hunter Demo could not be stopped."
      );
    } finally {
      setDemoActionBusy(false);
    }
  }

  return (
    <div data-testid="gh-dashboard">
      <section className="gh-hero" aria-label="Market hero">
        <div className="gh-hero-top">
          <div>
            <div className="gh-hero-symbol">XAUUSD</div>
            <div className="gh-hero-meta" style={{ marginTop: 4 }}>
              <span>
                Market <strong>{status.market.marketStatus}</strong>
              </span>
              <span>
                Feed <strong>{status.market.feedState}</strong>
              </span>
            </div>
          </div>
          <div className="gh-hero-price" data-testid="gh-mid">
            {mid != null ? mid.toFixed(2) : "—"}
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
          {status.market.updatedAt ? (
            <span title={formatResearchUtcTime(status.market.updatedAt)}>
              {formatResearchLocalTime(status.market.updatedAt)}
            </span>
          ) : null}
        </div>
      </section>

      <section className="gh-card" style={{ marginBottom: 12 }} data-testid="gh-demo-autotrade-card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            flexWrap: "wrap"
          }}
        >
          <div>
            <div className="gh-kpi-label">Gold Hunter Demo</div>
            <div className="gh-kpi-value" style={{ fontSize: "1.05rem", marginTop: 4 }} data-testid="gh-demo-autotrade-state">
              {demoState}
            </div>
            <p className="hint" style={{ marginTop: 6, maxWidth: 760 }} data-testid="gh-demo-autotrade-hint">
              {demoHint}
            </p>
          </div>
          <div className="gh-btn-row">
            {!demoEnabled ? (
              <button
                type="button"
                className="gh-btn gh-btn-gold"
                disabled={demoActionBusy}
                data-testid="gh-dashboard-start-demo-auto"
                onClick={() => {
                  if (
                    window.confirm(
                      "Start Gold Hunter Demo? This can place orders only on the connected cTrader DEMO account. Live trading remains disabled."
                    )
                  ) {
                    void startDemoAutoTrade();
                  }
                }}
              >
                {demoActionBusy ? "Starting…" : "Start Demo"}
              </button>
            ) : (
              <button
                type="button"
                className="gh-btn"
                disabled={demoActionBusy}
                data-testid="gh-dashboard-stop-demo-auto"
                onClick={() => void stopDemoAutoTrade()}
              >
                {demoActionBusy ? "Stopping…" : "Stop Demo"}
              </button>
            )}
            <span className="gh-badge gh-badge--muted">LIVE LOCKED</span>
          </div>
        </div>
        {demoActionMessage ? (
          <p className="hint" style={{ marginTop: 10 }} data-testid="gh-dashboard-demo-auto-message">
            {demoActionMessage}
          </p>
        ) : null}
      </section>

      {(firstRealGateBlocker ||
        status.signal.note ||
        !status.config.demoAutoTradeEnabled ||
        demoEnabled) && (
        <div className="gh-wait" data-testid="gh-primary-wait">
          {goldHunterDisplayWait(
            status.config.demoAutoTradeEnabled
              ? firstRealGateBlocker ??
                status.signal.note ??
                "WAIT — VALID SETUP REQUIRED"
              : !status.arming?.ready
                ? `WAIT — DEMO OFF${armingBlockers[0] ? ` · ${armingBlockers[0]}` : ""}`
                : firstRealGateBlocker
                  ? `READY TO ARM · CURRENTLY BLOCKED — ${stripWaitPrefix(firstRealGateBlocker)}`
                  : marketClosed
                    ? "READY TO ARM — MARKET CLOSED"
                    : "READY TO ARM — PRESS START DEMO"
          )}
        </div>
      )}

      <div className="gh-split" style={{ marginBottom: 12 }}>
        <section className="gh-card" data-testid="gh-ctrader-card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8
            }}
          >
            <h3 style={{ margin: 0 }}>cTrader Demo</h3>
            <button
              type="button"
              className="gh-btn"
              style={{ minHeight: 36, padding: "6px 10px", fontSize: "0.75rem" }}
              data-testid="gh-account-refresh"
              disabled={refreshing}
              onClick={() => void onRefresh()}
            >
              {refreshing ? "…" : "Refresh"}
            </button>
          </div>
          <div className="gh-trade-grid" style={{ marginTop: 10 }}>
            <div>
              <span>Balance</span>
              <strong data-testid="gh-demo-balance">{money(status.broker.balance, cur)}</strong>
            </div>
            <div>
              <span>Equity</span>
              <strong data-testid="gh-demo-equity">{money(status.broker.equity, cur)}</strong>
            </div>
            <div>
              <span>Used margin</span>
              <strong data-testid="gh-demo-margin-used">
                {money(status.broker.marginUsed, cur)}
              </strong>
            </div>
            <div>
              <span>Free margin</span>
              <strong data-testid="gh-demo-free-margin">
                {money(status.broker.freeMargin, cur)}
              </strong>
            </div>
          </div>
          <div className="gh-hero-meta" style={{ marginTop: 10 }}>
            <GhStatusTone value={status.broker.authState ?? "UNKNOWN"} />
            <span className="gh-badge gh-badge--demo">
              {status.broker.environment ?? "UNKNOWN"}
            </span>
            <span className="gh-kpi-label">
              {status.broker.accountMasked ?? "—"}
              {cur ? ` · ${cur}` : ""}
            </span>
          </div>
          {status.broker.lastSyncAt ? (
            <p className="hint" style={{ marginTop: 8 }} title={formatResearchUtcTime(status.broker.lastSyncAt)}>
              Last broker sync {formatResearchLocalTime(status.broker.lastSyncAt)}
              {status.broker.snapshotAgeMs != null
                ? ` · age ${Math.round(status.broker.snapshotAgeMs / 1000)}s`
                : ""}
            </p>
          ) : (
            <p className="hint" style={{ marginTop: 8 }}>
              {status.broker.connected ? "Account snapshot pending" : "Not connected"}
            </p>
          )}
        </section>

        <section className="gh-card" data-testid="gh-capital-card">
          <h3 style={{ margin: 0 }}>Gold Hunter</h3>
          <div className="gh-trade-grid" style={{ marginTop: 10 }}>
            <div>
              <span>Allocated</span>
              <strong data-testid="gh-allocation">
                €{status.capital.allocatedEur.toLocaleString()}
              </strong>
            </div>
            <div>
              <span>Committed</span>
              <strong data-testid="gh-committed">
                {status.capital.committedEur == null
                  ? "—"
                  : `€${status.capital.committedEur.toLocaleString()}`}
              </strong>
            </div>
            <div>
              <span>Available</span>
              <strong>
                {status.capital.availableEur == null
                  ? "—"
                  : `€${status.capital.availableEur.toLocaleString()}`}
              </strong>
            </div>
            <div>
              <span>Risk / trade</span>
              <strong>{formatEur(status.capital.riskBudgetEur).replace("+", "")}</strong>
            </div>
            <div>
              <span>Today GH Demo P/L</span>
              <strong
                className={today > 0 ? "pos" : today < 0 ? "neg" : undefined}
                data-testid="gh-today-pnl"
              >
                {formatEur(today)}
              </strong>
            </div>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            Risk uses Gold Hunter allocation — not full Demo balance.
            {status.capital.committedKnown === false
              ? " Committed capital unavailable — new entries fail closed."
              : ""}
          </p>
        </section>
      </div>

      <div className="gh-grid-2">
        <div className="gh-card">
          <div className="gh-kpi-label">Open Trades</div>
          <div className="gh-kpi-value" data-testid="gh-open-count">
            {status.openTrades.length}
          </div>
        </div>
        <div className="gh-card">
          <div className="gh-kpi-label">Win Rate</div>
          <div className="gh-kpi-value">
            {pf.winRate != null ? `${(pf.winRate * 100).toFixed(0)}%` : "—"}
          </div>
        </div>
      </div>

      <div className="gh-grid-3">
        <div className="gh-card">
          <div className="gh-kpi-label">Wins</div>
          <div className="gh-kpi-value">{pf.wins}</div>
        </div>
        <div className="gh-card">
          <div className="gh-kpi-label">Losses</div>
          <div className="gh-kpi-value">{pf.losses}</div>
        </div>
        <div className="gh-card">
          <div className="gh-kpi-label">Profit factor</div>
          <div className="gh-kpi-value">
            {pf.profitFactor != null ? pf.profitFactor.toFixed(2) : "—"}
          </div>
        </div>
      </div>

      <h3 className="gh-section-title">System Health</h3>
      <div className="gh-health" data-testid="gh-health">
        {(
          [
            ["MARKET FEED", status.health.marketFeed],
            ["TRANSPORT", status.health.transport],
            ["DEPTH", status.health.depth],
            ["STRATEGY", status.health.strategy],
            ["RISK", status.health.risk],
            ["DEMO", status.health.autoTrade]
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

      <details className="gh-diag">
        <summary>Admin diagnostics</summary>
        <pre data-testid="gh-diagnostics">
          {JSON.stringify(
            {
              executionMode: status.executionMode,
              liveExecutionEnabled: status.liveExecutionEnabled,
              runtimeSha: status.runtimeSha,
              broker: {
                provider: status.broker.provider,
                environment: status.broker.environment,
                authState: status.broker.authState,
                accountMasked: status.broker.accountMasked,
                currency: status.broker.currency,
                snapshotSource: status.broker.snapshotSource,
                snapshotAgeMs: status.broker.snapshotAgeMs,
                lastSyncAt: status.broker.lastSyncAt,
                validForRisk: status.broker.validForRisk
              },
              strategyPipeline: status.strategyPipeline,
              arming: status.arming,
              gates: status.gates,
              signal: status.signal,
              execution: status.execution,
              openTrades: status.openTrades.map((t) => ({
                goldHunterTradeId: t.goldHunterTradeId,
                setup: t.setup,
                side: t.side,
                status: t.status,
                netPnlEur: t.netPnlEur,
                entry: t.entry,
                stop: t.stop
              })),
              performanceToday: status.performanceToday,
              feedAgeMs: status.market.ageMs
            },
            null,
            2
          )}
        </pre>
      </details>
    </div>
  );
}
