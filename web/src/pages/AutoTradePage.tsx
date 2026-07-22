import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import type { AutoTradeMode, AutoTradeStatus } from "../lib/autoTradeTypes";
import { FIRST_PILOT_LIMITS_CLIENT } from "../lib/autoTradeTypes";

function money(n: number | null | undefined, currency = "EUR"): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(n);
}

function statusTone(status: string): string {
  switch (status) {
    case "OFF":
      return "gm-at-pill--off";
    case "SHADOW":
      return "gm-at-pill--shadow";
    case "DEMO":
      return "gm-at-pill--demo";
    case "LIVE":
      return "gm-at-pill--live";
    case "LOCKED":
      return "gm-at-pill--locked";
    default:
      return "gm-at-pill--off";
  }
}

export function AutoTradePage() {
  const { api } = useAuth();
  const [status, setStatus] = useState<AutoTradeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [livePhrase, setLivePhrase] = useState("");
  const [liveAck, setLiveAck] = useState(false);
  const [liveAccountAck, setLiveAccountAck] = useState(false);
  const [liveSecondConfirm, setLiveSecondConfirm] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await api.autoTradeStatus();
      setStatus(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load AutoTrade status");
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (fn: () => Promise<AutoTradeStatus>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const limits = status?.limits ?? FIRST_PILOT_LIMITS_CLIENT;
  const budget = status?.budget;
  const connection = status?.connection;
  const display = status?.displayStatus ?? "OFF";

  return (
    <div className="gm-autotrade" data-testid="autotrade-page">
      <header className="gm-autotrade-hero">
        <div className="gm-autotrade-hero-copy">
          <p className="gm-autotrade-kicker">GoldMeta · Control Centre</p>
          <h1 className="gm-page-title gm-autotrade-title">AutoTrade</h1>
          <p className="gm-meta gm-autotrade-lead">
            Server-side IG automation with hard risk budgets. Default mode is OFF. LIVE
            execution stays feature-flagged until Savio enables it.
          </p>
        </div>
        <div className="gm-autotrade-status-block" data-testid="autotrade-status">
          <span className="gm-label">AUTOTRADE</span>
          <span className={`gm-at-pill ${statusTone(display)}`} data-testid="autotrade-mode-pill">
            {display}
          </span>
          {status?.locked && status.lockReason ? (
            <p className="gm-autotrade-lock-reason" data-testid="autotrade-lock-reason">
              Locked: {status.lockReason}
            </p>
          ) : null}
        </div>
      </header>

      <div className="gm-autotrade-stop-bar" data-testid="autotrade-emergency-stop-bar">
        <div>
          <strong>Emergency STOP</strong>
          <p className="gm-meta">Immediately sets mode OFF and locks AutoTrade.</p>
        </div>
        <button
          type="button"
          className="gm-btn gm-at-stop"
          data-testid="autotrade-emergency-stop"
          disabled={busy}
          onClick={() => void run(() => api.autoTradeEmergencyStop())}
        >
          STOP
        </button>
      </div>

      {error ? (
        <div className="banner error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="gm-section gm-autotrade-panel" data-testid="autotrade-connection">
        <div className="gm-section-head">
          <h2 className="gm-section-title">Broker connection</h2>
          <p className="gm-meta">Credentials stay on Firebase server secrets only.</p>
        </div>
        <div className="gm-autotrade-metrics">
          <div>
            <span className="gm-label">Connection</span>
            <strong>{connection?.connected ? "Connected" : "Disconnected"}</strong>
          </div>
          <div>
            <span className="gm-label">Account</span>
            <strong>{connection?.accountIdMasked ?? "—"}</strong>
          </div>
          <div>
            <span className="gm-label">Balance</span>
            <strong>{money(connection?.balance, connection?.currency ?? "EUR")}</strong>
          </div>
          <div>
            <span className="gm-label">Available</span>
            <strong>{money(connection?.available, connection?.currency ?? "EUR")}</strong>
          </div>
          <div>
            <span className="gm-label">Margin used</span>
            <strong>{money(connection?.marginUsed, connection?.currency ?? "EUR")}</strong>
          </div>
          <div>
            <span className="gm-label">Heartbeat</span>
            <strong>
              {connection?.lastHeartbeatAt
                ? new Date(connection.lastHeartbeatAt).toLocaleString()
                : "—"}
            </strong>
          </div>
        </div>
        <div className="gm-autotrade-actions">
          <button
            type="button"
            className="gm-btn gm-btn-primary"
            disabled={busy}
            onClick={() => void run(() => api.autoTradeConnect("DEMO"))}
          >
            Connect IG Demo
          </button>
          <button
            type="button"
            className="gm-btn"
            disabled={busy}
            onClick={() => void run(() => api.autoTradeDemoDiagnostics())}
          >
            Refresh Demo diagnostics
          </button>
          <button
            type="button"
            className="gm-btn"
            disabled
            title="LIVE connection blocked until Savio enables it"
          >
            Verify IG Live (blocked)
          </button>
        </div>
      </section>

      <section className="gm-section gm-autotrade-panel" data-testid="autotrade-mode">
        <div className="gm-section-head">
          <h2 className="gm-section-title">Operating mode</h2>
          <p className="gm-meta">OFF · SHADOW · IG DEMO AUTO · IG LIVE AUTO</p>
        </div>
        <div className="gm-autotrade-mode-grid">
          {(
            [
              ["OFF", "OFF"],
              ["SHADOW", "SHADOW"],
              ["IG_DEMO_AUTO", "IG DEMO AUTO"],
              ["IG_LIVE_AUTO", "IG LIVE AUTO"]
            ] as Array<[AutoTradeMode, string]>
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={`gm-btn gm-at-mode${status?.mode === mode ? " is-active" : ""}`}
              disabled={busy || (status?.locked && mode !== "OFF")}
              data-testid={`autotrade-mode-${mode}`}
              onClick={() => {
                if (mode === "IG_LIVE_AUTO") return;
                void run(() => api.autoTradeSetMode(mode));
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {status?.locked ? (
          <button
            type="button"
            className="gm-btn gm-btn-gold"
            disabled={busy}
            data-testid="autotrade-unlock"
            onClick={() => void run(() => api.autoTradeUnlock())}
          >
            Unlock (returns to OFF)
          </button>
        ) : null}
      </section>

      <section className="gm-section gm-autotrade-panel" data-testid="autotrade-budget">
        <div className="gm-section-head">
          <h2 className="gm-section-title">Daily &amp; weekly budget</h2>
        </div>
        <div className="gm-autotrade-metrics">
          <div>
            <span className="gm-label">Risk per trade</span>
            <strong>{money(limits.maxLossPerTrade)}</strong>
          </div>
          <div>
            <span className="gm-label">Remaining daily</span>
            <strong>{money(budget?.remainingDailyLossCapacity)}</strong>
          </div>
          <div>
            <span className="gm-label">Remaining weekly</span>
            <strong>{money(budget?.remainingWeeklyLossCapacity)}</strong>
          </div>
          <div>
            <span className="gm-label">Trades today</span>
            <strong>
              {budget?.tradesUsed ?? 0}/{budget?.tradesMax ?? limits.maxTradesPerDay}
            </strong>
          </div>
          <div>
            <span className="gm-label">Min score</span>
            <strong>{limits.minGoldMetaScore}</strong>
          </div>
          <div>
            <span className="gm-label">Stop protection</span>
            <strong>{limits.stopProtection.replaceAll("_", " ")}</strong>
          </div>
        </div>
      </section>

      <section className="gm-section gm-autotrade-panel" data-testid="autotrade-risk-settings">
        <div className="gm-section-head">
          <h2 className="gm-section-title">First-pilot risk settings</h2>
          <p className="gm-meta">Defaults are conservative EUR pilot limits.</p>
        </div>
        <ul className="gm-autotrade-limits-list">
          <li>Max loss / trade: {money(limits.maxLossPerTrade)}</li>
          <li>Max margin / position: {money(limits.maxMarginPerPosition)}</li>
          <li>Max daily loss: {money(limits.maxDailyLoss)}</li>
          <li>Max weekly loss: {money(limits.maxWeeklyLoss)}</li>
          <li>Max open positions: {limits.maxOpenPositions}</li>
          <li>Max trades / day: {limits.maxTradesPerDay}</li>
          <li>Max consecutive losses: {limits.maxConsecutiveLosses}</li>
          <li>Cooldown after loss: {limits.cooldownAfterLossMinutes} min</li>
          <li>
            Min R:R 1:{limits.minRiskReward} · Sessions:{" "}
            {limits.allowedSessions.join(", ")}
          </li>
        </ul>
        <p className="gm-meta">
          Forbidden: WAIT execution, martingale, averaging down, pyramiding, unprotected
          positions, blind retries after uncertain broker responses.
        </p>
      </section>

      <section className="gm-section gm-autotrade-panel" data-testid="autotrade-positions">
        <div className="gm-section-head">
          <h2 className="gm-section-title">Open positions</h2>
        </div>
        {(status?.positions?.length ?? 0) === 0 ? (
          <p className="gm-empty">No open AutoTrade positions.</p>
        ) : (
          <ul className="gm-autotrade-positions">
            {status!.positions.map((p) => (
              <li key={p.positionId}>
                <strong>
                  {p.direction} {p.size} {p.marketName}
                </strong>
                <span>
                  Entry {p.entry} · Stop {p.stop ?? "—"} · TP {p.takeProfit ?? "—"} ·{" "}
                  {p.protectionStatus}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="gm-section gm-autotrade-panel" data-testid="autotrade-activity">
        <div className="gm-section-head">
          <h2 className="gm-section-title">Activity log</h2>
        </div>
        {(status?.activity?.length ?? 0) === 0 ? (
          <p className="gm-empty">No AutoTrade activity yet.</p>
        ) : (
          <ol className="gm-autotrade-log">
            {status!.activity.map((entry) => (
              <li key={entry.id} data-level={entry.level}>
                <time>{new Date(entry.at).toLocaleString()}</time>
                <span>{entry.message}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="gm-section gm-autotrade-panel gm-autotrade-live" data-testid="autotrade-live-activation">
        <div className="gm-section-head">
          <h2 className="gm-section-title">Live activation</h2>
          <p className="gm-meta">
            Preview of the deliberate LIVE enable flow. Server feature flag is{" "}
            <strong>{status?.liveExecutionFeatureEnabled ? "ON" : "OFF"}</strong>.
          </p>
        </div>
        <ol className="gm-autotrade-live-steps">
          <li>Verified IG live connection</li>
          <li>Verified active account ({connection?.accountIdMasked ?? "—"})</li>
          <li>
            Risk limits shown — max loss {money(limits.maxLossPerTrade)}, daily{" "}
            {money(limits.maxDailyLoss)}
          </li>
          <li>
            Instrument {connection?.marketName ?? "Spot Gold"} · min size{" "}
            {connection?.minDealSize ?? "—"}
          </li>
          <li>Maximum planned loss equals configured max loss per trade</li>
        </ol>
        <label className="gm-autotrade-field">
          Type ENABLE LIVE AUTOTRADE
          <input
            value={livePhrase}
            onChange={(e) => setLivePhrase(e.target.value)}
            autoComplete="off"
            data-testid="autotrade-live-phrase"
          />
        </label>
        <label className="gm-check-row">
          <input
            type="checkbox"
            checked={liveAck}
            onChange={(e) => setLiveAck(e.target.checked)}
            data-testid="autotrade-live-risk-ack"
          />
          I confirm the displayed risk limits
        </label>
        <label className="gm-check-row">
          <input
            type="checkbox"
            checked={liveAccountAck}
            onChange={(e) => setLiveAccountAck(e.target.checked)}
            data-testid="autotrade-live-account-ack"
          />
          I verify the live account details above
        </label>
        <label className="gm-check-row">
          <input
            type="checkbox"
            checked={liveSecondConfirm}
            onChange={(e) => setLiveSecondConfirm(e.target.checked)}
            data-testid="autotrade-live-second-confirm"
          />
          Second confirmation — enable LIVE AutoTrade
        </label>
        <button
          type="button"
          className="gm-btn gm-btn-primary"
          disabled={
            busy ||
            !liveAck ||
            !liveAccountAck ||
            !liveSecondConfirm ||
            livePhrase !== "ENABLE LIVE AUTOTRADE"
          }
          data-testid="autotrade-enable-live"
          onClick={() =>
            void run(() =>
              api.autoTradeSetMode("IG_LIVE_AUTO", {
                liveConfirmationPhrase: livePhrase,
                riskAcknowledged: liveAck,
                accountVerified: liveAccountAck
              })
            )
          }
        >
          Request LIVE AutoTrade
        </button>
        <p className="gm-meta">
          After deploy or restart, LIVE mode does not auto-restore. This preview keeps LIVE
          execution blocked server-side.
        </p>
      </section>
    </div>
  );
}
