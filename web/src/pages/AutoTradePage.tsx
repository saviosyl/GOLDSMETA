import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import type {
  AutoTradeMode,
  AutoTradeStatus,
  SelectedBrokerId,
  T212InstrumentCandidate
} from "../lib/autoTradeTypes";
import {
  FIRST_PILOT_LIMITS_CLIENT,
  T212_PROXY_DISCLAIMER_CLIENT
} from "../lib/autoTradeTypes";

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

function brokerPillTone(badge: string): string {
  if (badge.startsWith("T212 LIVE")) return "gm-at-pill--locked";
  if (badge.startsWith("T212")) return "gm-at-pill--demo";
  if (badge.startsWith("IG")) return "gm-at-pill--shadow";
  return "gm-at-pill--off";
}

const BROKER_OPTIONS: Array<{
  id: SelectedBrokerId;
  title: string;
  description: string;
}> = [
  {
    id: "T212_INVEST",
    title: "Trading 212 Invest",
    description: "Gold ETF/ETC proxy · long-only · API-supported read-only stage"
  },
  {
    id: "IG_DEMO",
    title: "IG Demo",
    description: "Parked · temporarily unavailable for this release"
  },
  {
    id: "MANUAL",
    title: "Manual XAUUSD",
    description: "Existing signal / confirm workflow · no broker orders"
  }
];

export function AutoTradePage() {
  const { api } = useAuth();
  const [status, setStatus] = useState<AutoTradeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [livePhrase, setLivePhrase] = useState("");
  const [liveAck, setLiveAck] = useState(false);
  const [liveAccountAck, setLiveAccountAck] = useState(false);
  const [liveSecondConfirm, setLiveSecondConfirm] = useState(false);
  const [showInstrumentPicker, setShowInstrumentPicker] = useState(false);
  const [instrumentQuery, setInstrumentQuery] = useState("");
  const [pendingCandidate, setPendingCandidate] = useState<T212InstrumentCandidate | null>(
    null
  );

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

  const selectedBroker: SelectedBrokerId = status?.selectedBroker ?? "MANUAL";
  const brokerBadge = status?.brokerBadge ?? "MANUAL";
  const limits = status?.limits ?? FIRST_PILOT_LIMITS_CLIENT;
  const budget = status?.budget;
  const connection = status?.connection;
  const t212 = status?.t212;
  const display = status?.displayStatus ?? "OFF";
  const disclaimer = status?.t212Disclaimer ?? T212_PROXY_DISCLAIMER_CLIENT;
  const proposal = status?.t212PendingProposal;
  const candidates = status?.t212GoldCandidates ?? [];
  const t212Limits = status?.t212RiskLimits;

  const selectBroker = (broker: SelectedBrokerId) => {
    if (broker === selectedBroker) return;
    void run(() => api.autoTradeSelectBroker(broker));
  };

  const searchInstruments = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.autoTradeT212SearchInstruments(
        instrumentQuery.trim() || undefined
      );
      setStatus(result.status);
      setShowInstrumentPicker(true);
      setPendingCandidate(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Instrument search failed");
    } finally {
      setBusy(false);
    }
  };

  const confirmInstrument = async (candidate: T212InstrumentCandidate) => {
    await run(() =>
      api.autoTradeT212ConfirmInstrument({
        instrumentId: candidate.instrumentId,
        ticker: candidate.ticker,
        name: candidate.name,
        currency: candidate.currency ?? "EUR",
        isin: candidate.isin,
        exchange: candidate.exchange,
        fractionalSupported: candidate.fractionalSupported,
        minOrderQuantity: candidate.minOrderQuantity,
        minOrderValue: candidate.minOrderValue
      })
    );
    setShowInstrumentPicker(false);
    setPendingCandidate(null);
  };

  const approveDryRun = async () => {
    if (!proposal) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.autoTradeT212ApproveDryRun(proposal.proposalId, "manual");
      setStatus(result.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dry-run approval failed");
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gm-autotrade" data-testid="autotrade-page">
      <header className="gm-autotrade-hero">
        <div className="gm-autotrade-hero-copy">
          <p className="gm-autotrade-kicker">GoldMeta · Control Centre</p>
          <h1 className="gm-page-title gm-autotrade-title">AutoTrade</h1>
          <p className="gm-meta gm-autotrade-lead">
            Select an execution broker. Trading 212 Invest is read-only in this stage; IG Demo is
            parked; Manual keeps the existing XAUUSD confirm workflow.
          </p>
        </div>
        <div className="gm-autotrade-status-block" data-testid="autotrade-status">
          <span className="gm-label">BROKER</span>
          <span
            className={`gm-at-pill ${brokerPillTone(brokerBadge)}`}
            data-testid="autotrade-broker-badge"
          >
            {brokerBadge}
          </span>
          <span className="gm-label">AUTOTRADE</span>
          <span className={`gm-at-pill ${statusTone(display)}`} data-testid="autotrade-mode-pill">
            {display}
          </span>
          {status?.locked && status.lockReason ? (
            <p className="gm-autotrade-lock-reason" data-testid="autotrade-lock-reason">
              Locked:{" "}
              {status.lockReason === "account_mismatch" ? "Account mismatch" : status.lockReason}
            </p>
          ) : null}
        </div>
      </header>

      <div className="gm-autotrade-readonly-banner" data-testid="autotrade-readonly-banner">
        Broker order submission is disabled. Paper and live Trading 212 execution remain locked.
      </div>

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

      <section className="gm-section gm-autotrade-panel" data-testid="autotrade-broker-selection">
        <div className="gm-section-head">
          <h2 className="gm-section-title">Broker selection</h2>
          <p className="gm-meta">Changing broker turns AutoTrade OFF and requires reconnect.</p>
        </div>
        <div className="gm-autotrade-broker-grid">
          {BROKER_OPTIONS.map((opt) => {
            const active = selectedBroker === opt.id;
            const parked = opt.id === "IG_DEMO";
            return (
              <button
                key={opt.id}
                type="button"
                className={`gm-autotrade-broker-card${active ? " is-active" : ""}${
                  parked ? " is-parked" : ""
                }`}
                disabled={busy || (status?.locked && opt.id !== selectedBroker)}
                data-testid={`autotrade-broker-${opt.id}`}
                aria-pressed={active}
                onClick={() => selectBroker(opt.id)}
              >
                <strong>{opt.title}</strong>
                <span>{opt.description}</span>
                {active ? <em>Selected</em> : null}
                {parked && !active ? <em>Parked</em> : null}
              </button>
            );
          })}
        </div>
      </section>

      <p className="gm-autotrade-disclaimer" data-testid="autotrade-t212-disclaimer">
        {disclaimer}
      </p>

      {selectedBroker === "MANUAL" ? (
        <section className="gm-section gm-autotrade-panel" data-testid="autotrade-manual-note">
          <div className="gm-section-head">
            <h2 className="gm-section-title">Manual XAUUSD workflow</h2>
            <p className="gm-meta">
              Signals and confirmations stay on GoldMeta. No broker orders are placed. IG connection
              errors are ignored while Manual is selected.
            </p>
          </div>
        </section>
      ) : null}

      {selectedBroker === "T212_INVEST" ? (
        <>
          <section className="gm-section gm-autotrade-panel" data-testid="autotrade-t212-connection">
            <div className="gm-section-head">
              <h2 className="gm-section-title">Trading 212 Invest</h2>
              <p className="gm-meta">
                Read-only practice connection. Credentials stay on the server — never in the browser.
              </p>
            </div>
            <div className="gm-autotrade-metrics">
              <div>
                <span className="gm-label">Connection</span>
                <strong data-testid="autotrade-t212-connection-state">
                  {t212?.connectionState ?? (t212?.connected ? "Connected" : "Disconnected")}
                </strong>
              </div>
              <div>
                <span className="gm-label">Environment</span>
                <strong data-testid="autotrade-t212-environment">
                  {t212?.environment ?? "—"}
                </strong>
              </div>
              <div>
                <span className="gm-label">Currency</span>
                <strong>{t212?.currency ?? "—"}</strong>
              </div>
              <div>
                <span className="gm-label">Free cash</span>
                <strong>{money(t212?.freeCash, t212?.currency ?? "EUR")}</strong>
              </div>
              <div>
                <span className="gm-label">Invested</span>
                <strong>{money(t212?.investedValue, t212?.currency ?? "EUR")}</strong>
              </div>
              <div>
                <span className="gm-label">Total value</span>
                <strong>{money(t212?.totalValue, t212?.currency ?? "EUR")}</strong>
              </div>
              <div>
                <span className="gm-label">Selected gold instrument</span>
                <strong data-testid="autotrade-t212-instrument">
                  {t212?.selectedInstrument
                    ? `${t212.selectedInstrument.ticker} · ${t212.selectedInstrument.name}`
                    : "—"}
                </strong>
              </div>
              <div>
                <span className="gm-label">Instrument currency</span>
                <strong data-testid="autotrade-t212-instrument-currency">
                  {t212?.selectedInstrument?.currency ?? "—"}
                </strong>
              </div>
              <div>
                <span className="gm-label">ISIN</span>
                <strong data-testid="autotrade-t212-instrument-isin">
                  {t212?.selectedInstrument?.isin ?? "—"}
                </strong>
              </div>
              <div>
                <span className="gm-label">Type</span>
                <strong data-testid="autotrade-t212-instrument-type">
                  {t212?.selectedInstrument?.type ?? "—"}
                </strong>
              </div>
              <div>
                <span className="gm-label">Holding qty</span>
                <strong data-testid="autotrade-t212-holding">
                  {t212?.holdingQuantity ?? "—"}
                </strong>
              </div>
              <div>
                <span className="gm-label">Last heartbeat</span>
                <strong data-testid="autotrade-t212-heartbeat">
                  {t212?.lastHeartbeatAt
                    ? new Date(t212.lastHeartbeatAt).toLocaleString()
                    : "—"}
                </strong>
              </div>
            </div>
            {t212?.selectedInstrument ? (
              <p
                className="gm-autotrade-instrument-warning"
                data-testid="autotrade-t212-min-size-warning"
              >
                Dry-run risk estimate uses max order {money(t212Limits?.maxOrderValue ?? 50, "EUR")}{" "}
                only. Minimum/fractional eligibility not yet verified — catalogue did not supply
                minimum quantity, minimum order value, fractional support, exchange, or live
                tradability. No orders will be submitted. An EUR listing currency does not remove
                economic USD gold exposure; FX can still affect returns versus an EUR cash balance.
              </p>
            ) : null}
            <p
              className="gm-autotrade-instrument-warning"
              data-testid="autotrade-t212-practice-limitations"
            >
              Trading 212 Practice — Read Only. GoldMeta analyses XAUUSD and uses a confirmed gold
              Invest instrument as a proxy (not direct XAUUSD trading). Long-only: SELL with no
              holding is unsupported. No broker orders will be submitted.
            </p>
            <div className="gm-autotrade-actions">
              <button
                type="button"
                className="gm-btn gm-btn-primary"
                disabled={busy || status?.locked}
                data-testid="autotrade-t212-connect"
                onClick={() => void run(() => api.autoTradeT212Connect("PRACTICE"))}
              >
                Connect Trading 212
              </button>
              <button
                type="button"
                className="gm-btn"
                disabled={busy || status?.locked}
                data-testid="autotrade-t212-diagnostics"
                onClick={() => void run(() => api.autoTradeT212Diagnostics())}
              >
                Run read-only diagnostics
              </button>
              <button
                type="button"
                className="gm-btn"
                disabled={busy || !t212?.connected}
                data-testid="autotrade-t212-select-instrument"
                onClick={() => {
                  setShowInstrumentPicker(true);
                  void searchInstruments();
                }}
              >
                Select Gold Instrument
              </button>
              <button
                type="button"
                className="gm-btn"
                disabled={busy || !t212?.connected}
                data-testid="autotrade-t212-disconnect"
                onClick={() => void run(() => api.autoTradeT212Disconnect())}
              >
                Disconnect
              </button>
              <button
                type="button"
                className="gm-btn gm-at-stop"
                disabled={busy}
                data-testid="autotrade-t212-emergency-stop"
                onClick={() => void run(() => api.autoTradeEmergencyStop())}
              >
                Emergency STOP
              </button>
            </div>
          </section>

          {showInstrumentPicker || candidates.length > 0 ? (
            <section
              className="gm-section gm-autotrade-panel"
              data-testid="autotrade-t212-instruments"
            >
              <div className="gm-section-head">
                <h2 className="gm-section-title">Select gold instrument</h2>
                <p className="gm-meta">
                  Select marks a candidate locally. Confirm is a separate action and still does not
                  enable trading.
                </p>
              </div>
              <p
                className="gm-autotrade-instrument-warning"
                data-testid="autotrade-t212-confirm-warning"
              >
                Confirmation stores the catalogue identity for dry-run proposals only. No broker
                orders are submitted. Trading 212 Invest is long-only — shorts are unsupported.
              </p>
              <label className="gm-autotrade-field">
                Search
                <input
                  value={instrumentQuery}
                  onChange={(e) => setInstrumentQuery(e.target.value)}
                  placeholder="e.g. gold ETF"
                  data-testid="autotrade-t212-instrument-query"
                />
              </label>
              <div className="gm-autotrade-actions">
                <button
                  type="button"
                  className="gm-btn"
                  disabled={busy}
                  data-testid="autotrade-t212-search"
                  onClick={() => void searchInstruments()}
                >
                  Search instruments
                </button>
              </div>
              {(candidates.length ?? 0) === 0 ? (
                <p className="gm-empty">No gold instrument candidates yet. Run search or diagnostics.</p>
              ) : (
                <ul className="gm-autotrade-candidate-list" data-testid="autotrade-t212-candidates">
                  {candidates.map((c) => {
                    const selected = pendingCandidate?.instrumentId === c.instrumentId;
                    return (
                      <li key={c.instrumentId}>
                        <div
                          className={`gm-autotrade-candidate${selected ? " is-active" : ""}`}
                          data-testid={`autotrade-t212-candidate-${c.ticker}`}
                        >
                          <div className="gm-autotrade-candidate-copy">
                            <strong className="gm-autotrade-candidate-name">
                              {c.ticker}
                              <span aria-hidden="true"> · </span>
                              {c.name}
                            </strong>
                            <span className="gm-autotrade-candidate-meta">
                              {[c.currency, c.exchange, c.isin].filter(Boolean).join(" · ") ||
                                "Currency / ISIN / exchange not supplied"}
                            </span>
                            <span className="gm-meta">{c.goldMatchReason}</span>
                          </div>
                          <button
                            type="button"
                            className="gm-btn gm-autotrade-candidate-select"
                            disabled={busy}
                            aria-pressed={selected}
                            data-testid={`autotrade-t212-select-${c.ticker}`}
                            onClick={() => setPendingCandidate(c)}
                          >
                            {selected ? "Selected" : "Select"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {pendingCandidate ? (
                <div
                  className="gm-autotrade-confirm-summary"
                  data-testid="autotrade-t212-confirm-summary"
                >
                  <h3 className="gm-autotrade-confirm-title">Confirm instrument</h3>
                  <dl className="gm-autotrade-confirm-dl">
                    <div>
                      <dt>Ticker</dt>
                      <dd data-testid="autotrade-t212-confirm-ticker">{pendingCandidate.ticker}</dd>
                    </div>
                    <div>
                      <dt>Full name</dt>
                      <dd data-testid="autotrade-t212-confirm-name">{pendingCandidate.name}</dd>
                    </div>
                    <div>
                      <dt>Currency</dt>
                      <dd data-testid="autotrade-t212-confirm-currency">
                        {pendingCandidate.currency ?? "Not supplied"}
                      </dd>
                    </div>
                    <div>
                      <dt>ISIN</dt>
                      <dd data-testid="autotrade-t212-confirm-isin">
                        {pendingCandidate.isin ?? "Not supplied"}
                      </dd>
                    </div>
                  </dl>
                  <p className="gm-autotrade-confirm-flags">
                    Trading 212 Practice — Read Only · No orders will be submitted
                  </p>
                </div>
              ) : null}
              <div className="gm-autotrade-actions">
                <button
                  type="button"
                  className="gm-btn gm-btn-primary"
                  disabled={busy || !pendingCandidate}
                  data-testid="autotrade-t212-confirm-instrument"
                  onClick={() => {
                    if (pendingCandidate) void confirmInstrument(pendingCandidate);
                  }}
                >
                  Confirm selected instrument
                </button>
              </div>
            </section>
          ) : null}

          {proposal ? (
            <section
              className="gm-section gm-autotrade-panel"
              data-testid="autotrade-t212-confirm-mode"
            >
              <div className="gm-section-head">
                <h2 className="gm-section-title">Confirm mode</h2>
                <p className="gm-meta">
                  Review the XAUUSD decision and proposed Invest order. Approve dry-run only — no
                  order is submitted.
                </p>
              </div>
              <div className="gm-autotrade-metrics">
                <div>
                  <span className="gm-label">XAUUSD decision</span>
                  <strong data-testid="autotrade-t212-proposal-decision">
                    {proposal.goldMetaDecision}
                  </strong>
                </div>
                <div>
                  <span className="gm-label">Instrument</span>
                  <strong>
                    {proposal.instrumentTicker} · {proposal.instrumentName}
                  </strong>
                </div>
                <div>
                  <span className="gm-label">Proposed order</span>
                  <strong data-testid="autotrade-t212-proposal-order">
                    {proposal.action}
                    {proposal.side ? ` · ${proposal.side}` : ""}
                    {proposal.quantity != null ? ` · qty ${proposal.quantity}` : ""}
                    {proposal.orderValue != null
                      ? ` · ${money(proposal.orderValue, proposal.accountCurrency ?? "EUR")}`
                      : ""}
                  </strong>
                </div>
                <div>
                  <span className="gm-label">Status</span>
                  <strong>{proposal.status}</strong>
                </div>
                <div>
                  <span className="gm-label">Confidence</span>
                  <strong>{proposal.confidence ?? "—"}</strong>
                </div>
                <div>
                  <span className="gm-label">FX warning</span>
                  <strong>{proposal.fxConversionWarning ?? "—"}</strong>
                </div>
              </div>
              {proposal.rejectionReason ? (
                <p className="banner error" role="status">
                  {proposal.rejectionReason}
                </p>
              ) : null}
              {proposal.reasonCodes?.length ? (
                <ul className="gm-autotrade-limits-list">
                  {proposal.reasonCodes.map((code) => (
                    <li key={code}>{code}</li>
                  ))}
                </ul>
              ) : null}
              {t212Limits ? (
                <p className="gm-meta">
                  Risk checks: max order {money(t212Limits.maxOrderValue, t212Limits.currency)} ·
                  daily invested {money(t212Limits.maxDailyInvestedAmount, t212Limits.currency)} ·
                  min confidence {t212Limits.minGoldMetaConfidence}
                </p>
              ) : null}
              <div className="gm-autotrade-actions">
                <button
                  type="button"
                  className="gm-btn gm-btn-primary"
                  disabled={
                    busy ||
                    proposal.status === "DRY_RUN_APPROVED" ||
                    proposal.status === "BLOCKED" ||
                    proposal.status === "SUBMISSION_DISABLED"
                  }
                  data-testid="autotrade-t212-approve-dry-run"
                  onClick={() => void approveDryRun()}
                >
                  Approve dry-run
                </button>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {selectedBroker === "IG_DEMO" ? (
        <>
          <div className="gm-autotrade-readonly-banner" data-testid="autotrade-ig-parked-banner">
            IG Demo is parked / temporarily unavailable. Connection is not the primary path in this
            release.
          </div>
          <section className="gm-section gm-autotrade-panel" data-testid="autotrade-connection">
            <div className="gm-section-head">
              <h2 className="gm-section-title">IG Demo (parked)</h2>
              <p className="gm-meta">
                Credentials stay on Firebase Secret Manager only — never in the browser.
              </p>
            </div>
            <div className="gm-autotrade-metrics">
              <div>
                <span className="gm-label">Connection</span>
                <strong data-testid="autotrade-connection-state">
                  {connection?.connectionState ??
                    (connection?.connected ? "Connected" : "Disconnected")}
                </strong>
              </div>
              <div>
                <span className="gm-label">Environment</span>
                <strong data-testid="autotrade-environment">
                  {connection?.environmentLabel ?? "IG DEMO — PARKED"}
                </strong>
              </div>
              <div>
                <span className="gm-label">Account</span>
                <strong data-testid="autotrade-account-masked">
                  {connection?.accountIdMasked ?? "—"}
                </strong>
              </div>
              <div>
                <span className="gm-label">Currency</span>
                <strong>{connection?.currency ?? "—"}</strong>
              </div>
              <div>
                <span className="gm-label">Balance</span>
                <strong>{money(connection?.balance, connection?.currency ?? "EUR")}</strong>
              </div>
              <div>
                <span className="gm-label">Available funds</span>
                <strong>{money(connection?.available, connection?.currency ?? "EUR")}</strong>
              </div>
              <div>
                <span className="gm-label">Margin used</span>
                <strong>{money(connection?.marginUsed, connection?.currency ?? "EUR")}</strong>
              </div>
              <div>
                <span className="gm-label">Last heartbeat</span>
                <strong data-testid="autotrade-heartbeat">
                  {connection?.lastHeartbeatAt
                    ? new Date(connection.lastHeartbeatAt).toLocaleString()
                    : "—"}
                </strong>
              </div>
            </div>
            <div className="gm-autotrade-actions">
              <button
                type="button"
                className="gm-btn"
                disabled={busy || status?.locked}
                data-testid="autotrade-connect-demo"
                title="IG Demo is parked"
                onClick={() => void run(() => api.autoTradeConnect("DEMO"))}
              >
                Connect IG Demo (parked)
              </button>
              <button
                type="button"
                className="gm-btn"
                disabled={busy || status?.locked}
                data-testid="autotrade-refresh-diagnostics"
                onClick={() => void run(() => api.autoTradeDemoDiagnostics())}
              >
                Run read-only diagnostics
              </button>
              <button
                type="button"
                className="gm-btn"
                disabled={busy || !connection?.connected}
                data-testid="autotrade-disconnect"
                onClick={() => void run(() => api.autoTradeDisconnect())}
              >
                Disconnect
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

          <section className="gm-section gm-autotrade-panel" data-testid="autotrade-spot-gold">
            <div className="gm-section-head">
              <h2 className="gm-section-title">Spot Gold</h2>
              <p className="gm-meta">
                Discovered from IG Demo search — not permanently hard-coded.
                {status?.selectionRequired
                  ? " Multiple candidates found; explicit selection required before execution."
                  : null}
              </p>
            </div>
            <div className="gm-autotrade-metrics">
              <div>
                <span className="gm-label">Instrument</span>
                <strong>{connection?.marketName ?? "—"}</strong>
              </div>
              <div>
                <span className="gm-label">EPIC</span>
                <strong data-testid="autotrade-epic">
                  {connection?.marketEpic ?? status?.proposedEpic ?? "—"}
                </strong>
              </div>
              <div>
                <span className="gm-label">Market status</span>
                <strong>{connection?.marketStatus ?? "—"}</strong>
              </div>
              <div>
                <span className="gm-label">Bid</span>
                <strong>{connection?.bid ?? "—"}</strong>
              </div>
              <div>
                <span className="gm-label">Offer</span>
                <strong>{connection?.ask ?? "—"}</strong>
              </div>
              <div>
                <span className="gm-label">Spread</span>
                <strong>{connection?.spread ?? "—"}</strong>
              </div>
            </div>
            {(status?.goldCandidates?.length ?? 0) > 0 ? (
              <div className="gm-autotrade-candidates" data-testid="autotrade-gold-candidates">
                <h3 className="gm-section-title">Gold market candidates</h3>
                <ul className="gm-autotrade-limits-list">
                  {status!.goldCandidates!.map((c) => (
                    <li key={c.epic}>
                      <strong>{c.instrumentName}</strong> · {c.epic}
                      {c.proposedPrimary ? " · proposed" : ""} — {c.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

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
              ["IG_DEMO_AUTO", "IG DEMO AUTO (orders off)"],
              ["IG_LIVE_AUTO", "IG LIVE AUTO"]
            ] as Array<[AutoTradeMode, string]>
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={`gm-btn gm-at-mode${status?.mode === mode ? " is-active" : ""}`}
              disabled={
                busy ||
                (status?.locked && mode !== "OFF") ||
                mode === "IG_LIVE_AUTO" ||
                mode === "IG_DEMO_AUTO"
              }
              title={
                mode === "IG_DEMO_AUTO"
                  ? "Demo order submission is disabled for this verification stage"
                  : mode === "IG_LIVE_AUTO"
                    ? "LIVE execution is feature-flagged off"
                    : undefined
              }
              data-testid={`autotrade-mode-${mode}`}
              onClick={() => {
                if (mode === "IG_LIVE_AUTO" || mode === "IG_DEMO_AUTO") return;
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
            Min R:R 1:{limits.minRiskReward} · Sessions: {limits.allowedSessions.join(", ")}
          </li>
        </ul>
        <p className="gm-meta">
          Forbidden: WAIT execution, martingale, averaging down, pyramiding, unprotected positions,
          blind retries after uncertain broker responses.
        </p>
      </section>

      {selectedBroker === "IG_DEMO" ? (
        <section className="gm-section gm-autotrade-panel" data-testid="autotrade-positions">
          <div className="gm-section-head">
            <h2 className="gm-section-title">Open Demo positions</h2>
            <p className="gm-meta">Read-only list. Close / amend controls are disabled.</p>
          </div>
          {(status?.positions?.length ?? 0) === 0 ? (
            <p className="gm-empty">No open Demo positions.</p>
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
                  <button type="button" className="gm-btn" disabled title="Orders disabled">
                    Close (disabled)
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

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

      {selectedBroker === "IG_DEMO" ? (
        <section
          className="gm-section gm-autotrade-panel gm-autotrade-live"
          data-testid="autotrade-live-activation"
        >
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
      ) : null}
    </div>
  );
}
