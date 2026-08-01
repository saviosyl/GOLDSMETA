import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type {
  AutoTradeStatus,
  SelectedBrokerId,
  SetupStepStatus,
  T212InstrumentCandidate
} from "../lib/autoTradeTypes";
import {
  FIRST_PILOT_LIMITS_CLIENT,
  T212_PROXY_DISCLAIMER_CLIENT
} from "../lib/autoTradeTypes";
import type {
  BrokerControlCentreResponse,
  CTraderDiagnosticsReport
} from "../lib/broker/ctraderTypes";

function money(n: number | null | undefined, currency = "EUR"): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(n);
}

function num(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
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

function stepTone(status: SetupStepStatus): string {
  switch (status) {
    case "Complete":
      return "gm-at-step--complete";
    case "Current":
      return "gm-at-step--current";
    case "Error":
      return "gm-at-step--error";
    case "Waiting for owner":
      return "gm-at-step--waiting";
    case "Action required":
      return "gm-at-step--action";
    default:
      return "gm-at-step--locked";
  }
}

type JourneyStep = {
  id: number;
  title: string;
  status: SetupStepStatus;
  detail: string;
};

function buildJourney(
  status: AutoTradeStatus | null,
  centre: BrokerControlCentreResponse | null,
  diagnostics: CTraderDiagnosticsReport | null
): JourneyStep[] {
  const readiness = centre?.readiness;
  const connected = Boolean(readiness?.connected || diagnostics?.oauthConnected);
  const demoSelected = Boolean(diagnostics?.demoAccountSelected);
  const goldOk = Boolean(diagnostics?.goldSymbolFound);
  const quoteOk = Boolean(diagnostics?.liveQuoteReceived && !diagnostics?.quote?.stale);
  const secretsOk = Boolean(
    readiness?.oauthConfigured || diagnostics?.credentialsConfigured
  );
  const emergency = Boolean(status?.emergencyStopActive);

  const steps: JourneyStep[] = [
    {
      id: 1,
      title: "Credentials ready",
      status: secretsOk ? "Complete" : "Waiting for owner",
      detail: secretsOk
        ? "cTrader Demo app credentials are configured for the preview API."
        : "Owner must confirm Secret Manager bindings for apiCTraderPreview."
    },
    {
      id: 2,
      title: "Connect cTrader",
      status: !secretsOk
        ? "Locked"
        : connected
          ? "Complete"
          : "Action required",
      detail: connected
        ? "Demo OAuth connected (accounts scope — read only)."
        : "Owner approval required before opening the cTrader consent page."
    },
    {
      id: 3,
      title: "Select Pepperstone Demo",
      status: !connected ? "Locked" : demoSelected ? "Complete" : "Current",
      detail: demoSelected
        ? "Pepperstone Demo account selected."
        : "Choose a Demo account returned by cTrader — Live accounts are rejected."
    },
    {
      id: 4,
      title: "Verify Gold symbol",
      status: !demoSelected ? "Locked" : goldOk ? "Complete" : "Current",
      detail: goldOk
        ? `Gold symbol resolved: ${diagnostics?.symbol?.symbolName ?? "XAUUSD"}.`
        : "Discover XAUUSD / GOLD variants dynamically — owner confirms if ambiguous."
    },
    {
      id: 5,
      title: "Confirm live prices",
      status: !goldOk ? "Locked" : quoteOk ? "Complete" : "Current",
      detail: quoteOk
        ? "Fresh Demo bid/ask received."
        : "Waiting for a healthy Demo quote stream."
    },
    {
      id: 6,
      title: "Complete Demo order tests",
      status: "Locked",
      detail: "Controlled Demo BUY/SELL/close tests require separate owner approval."
    },
    {
      id: 7,
      title: "Enable Demo Auto",
      status: emergency ? "Error" : "Locked",
      detail: emergency
        ? "Emergency STOP is active — AutoTrade stays OFF."
        : "Demo Auto stays OFF until every qualification gate passes and owner approves."
    }
  ];

  // Ensure exactly one Current when earlier steps incomplete
  let sawOpen = false;
  return steps.map((s) => {
    if (s.status === "Complete" || s.status === "Locked" || s.status === "Error" || s.status === "Waiting for owner") {
      return s;
    }
    if (!sawOpen) {
      sawOpen = true;
      return { ...s, status: s.status === "Action required" ? "Action required" : "Current" };
    }
    return { ...s, status: "Locked" };
  });
}

export function AutoTradePage() {
  const { api, account } = useAuth();
  const isOwner = (account?.role ?? "").toUpperCase() === "OWNER";
  const [status, setStatus] = useState<AutoTradeStatus | null>(null);
  const [centre, setCentre] = useState<BrokerControlCentreResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<CTraderDiagnosticsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showT212, setShowT212] = useState(false);
  const [instrumentQuery, setInstrumentQuery] = useState("");
  const [showInstrumentPicker, setShowInstrumentPicker] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await api.autoTradeStatus();
      setStatus(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load AutoTrade status");
    }
    try {
      const c = await api.getBrokerControlCentre();
      setCentre(c);
    } catch {
      /* broker centre optional for non-owner */
    }
    try {
      if (isOwner) {
        const d = await api.getCTraderDiagnostics();
        setDiagnostics(d);
      }
    } catch {
      setDiagnostics(null);
    }
  }, [api, isOwner]);

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

  const selectedBroker: SelectedBrokerId = status?.selectedBroker ?? "PEPPERSTONE_CTRADER";
  const pepperstoneSelected =
    selectedBroker === "PEPPERSTONE_CTRADER" || selectedBroker === "IG_DEMO";
  const limits = status?.limits ?? FIRST_PILOT_LIMITS_CLIENT;
  const budget = status?.budget;
  const connection = status?.connection;
  const t212 = status?.t212;
  const display = status?.displayStatus ?? "OFF";
  const proposal = status?.t212PendingProposal;
  const candidates = status?.t212GoldCandidates ?? [];
  const journey = useMemo(
    () => buildJourney(status, centre, diagnostics),
    [status, centre, diagnostics]
  );

  const connectionLabel = diagnostics?.oauthConnected
    ? diagnostics.demoAccountSelected
      ? "Connected"
      : "Action required"
    : centre?.readiness?.connected
      ? "Connected"
      : "Disconnected";

  const permissionLabel = "Read Only";
  const autoTradeLabel = status?.emergencyStopActive
    ? "OFF"
    : display === "LOCKED"
      ? "OFF"
      : "OFF";
  const rawMarket = diagnostics?.quote?.marketStatus || connection?.marketStatus || "";
  const symbolName =
    diagnostics?.symbol?.symbolName ?? connection?.marketName ?? "XAUUSD";
  const marketOpen =
    rawMarket.toUpperCase() === "OPEN" || rawMarket.toUpperCase().includes("TRADEABLE");
  const marketLabel = rawMarket
    ? `${symbolName} ${marketOpen ? "Open" : rawMarket}`
    : `${symbolName} — status unknown`;

  const selectBroker = (broker: SelectedBrokerId) => {
    if (broker === selectedBroker) return;
    if (broker === "IG_DEMO") return;
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
  };

  const demoAccount = diagnostics?.account;
  const quote = diagnostics?.quote;
  const position = status?.positions?.[0] ?? null;
  const currency = demoAccount?.currency ?? connection?.currency ?? budget?.currency ?? "EUR";

  return (
    <div className="gm-autotrade gm-at-dashboard" data-testid="autotrade-page">
      <header className="gm-autotrade-hero">
        <div className="gm-autotrade-hero-copy">
          <p className="gm-autotrade-kicker">GoldMeta · Broker & AutoTrade</p>
          <h1 className="gm-page-title gm-autotrade-title">Broker & AutoTrade</h1>
          <p className="gm-meta gm-autotrade-lead">
            Pepperstone cTrader Demo is the active broker path. Orders stay locked. AutoTrade stays
            OFF until every Demo qualification gate passes and the owner approves.
          </p>
        </div>
      </header>

      <section className="gm-at-summary" data-testid="autotrade-status" aria-label="Status summary">
        <div>
          <span className="gm-label">Broker</span>
          <strong data-testid="autotrade-broker-badge">Pepperstone cTrader Demo</strong>
        </div>
        <div>
          <span className="gm-label">Connection</span>
          <strong data-testid="autotrade-connection-label">{connectionLabel}</strong>
        </div>
        <div>
          <span className="gm-label">Permission</span>
          <strong>{permissionLabel}</strong>
        </div>
        <div>
          <span className="gm-label">AutoTrade</span>
          <span className={`gm-at-pill ${statusTone(display)}`} data-testid="autotrade-mode-pill">
            {autoTradeLabel}
          </span>
        </div>
        <div>
          <span className="gm-label">Market</span>
          <strong data-testid="autotrade-market-label">{marketLabel}</strong>
        </div>
      </section>

      <div className="gm-autotrade-readonly-banner" data-testid="autotrade-readonly-banner">
        Broker order submission is disabled. Demo trading scope and Demo Auto require separate owner
        approval. Live trading stays locked.
      </div>

      <section
        className="gm-autotrade-stop-bar"
        aria-label="Emergency stop"
        data-testid="autotrade-emergency-bar"
      >
        <div>
          <strong>Emergency STOP</strong>
          <p className="gm-meta">
            Always available. Turns AutoTrade OFF, blocks new orders, and requires an explicit owner
            reset. Open positions are not closed automatically.
          </p>
        </div>
        <button
          type="button"
          className="gm-btn gm-btn-danger"
          data-testid="autotrade-emergency-stop"
          disabled={busy}
          onClick={() => void run(() => api.autoTradeEmergencyStop())}
        >
          Emergency STOP
        </button>
      </section>

      {error ? (
        <p className="gm-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="gm-at-journey" aria-labelledby="journey-heading">
        <h2 id="journey-heading" className="gm-section-title">
          Setup journey
        </h2>
        <ol className="gm-at-journey-list" data-testid="autotrade-setup-journey">
          {journey.map((step) => (
            <li key={step.id} className={`gm-at-step ${stepTone(step.status)}`}>
              <span className="gm-at-step-index">{step.id}</span>
              <div>
                <strong>{step.title}</strong>
                <em data-testid={`autotrade-step-${step.id}-status`}>{step.status}</em>
                <p className="gm-meta">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="gm-at-actions" aria-label="Primary controls">
        <Link className="gm-btn gm-btn-primary" to="/brokers" data-testid="autotrade-connect-ctrader">
          Connect cTrader
        </Link>
        <button
          type="button"
          className="gm-btn"
          disabled={busy || !pepperstoneSelected}
          onClick={() => {
            if (!pepperstoneSelected) {
              void selectBroker("PEPPERSTONE_CTRADER");
            }
            void reload();
          }}
          data-testid="autotrade-run-check"
        >
          Run connection check
        </button>
        <button
          type="button"
          className="gm-btn"
          disabled
          title="Requires separate owner approval for trading scope"
          data-testid="autotrade-authorise-demo-trading"
        >
          Authorise Demo Trading
        </button>
        <button
          type="button"
          className="gm-btn"
          disabled
          title="Demo Auto stays OFF until qualification and owner approval"
          data-testid="autotrade-enable-demo-auto"
        >
          Enable Demo Auto
        </button>
        <button
          type="button"
          className="gm-btn"
          disabled={busy || !status?.mode || status.mode === "OFF"}
          onClick={() => void run(() => api.autoTradeSetMode("OFF"))}
          data-testid="autotrade-pause"
        >
          Pause AutoTrade
        </button>
      </section>

      <p className="gm-meta gm-at-locked-note" data-testid="autotrade-demo-auto-note">
        Demo Auto preparation is available in code. Owner approval required. AutoTrade OFF.
      </p>

      <section className="gm-at-cards" aria-label="Daily overview">
        <article className="gm-at-card" data-testid="autotrade-card-account">
          <h3>Account</h3>
          <dl>
            <div>
              <dt>Balance</dt>
              <dd>{money(demoAccount?.balance ?? connection?.balance, currency)}</dd>
            </div>
            <div>
              <dt>Equity</dt>
              <dd>{money(demoAccount?.equity ?? null, currency)}</dd>
            </div>
            <div>
              <dt>Free margin</dt>
              <dd>{money(demoAccount?.freeMargin ?? connection?.available, currency)}</dd>
            </div>
            <div>
              <dt>Used margin</dt>
              <dd>{money(demoAccount?.usedMargin ?? connection?.marginUsed, currency)}</dd>
            </div>
            <div>
              <dt>Daily P/L</dt>
              <dd>{money(budget?.dailyRealisedPnl ?? 0, currency)}</dd>
            </div>
          </dl>
        </article>

        <article className="gm-at-card" data-testid="autotrade-card-market">
          <h3>Gold market</h3>
          <dl>
            <div>
              <dt>Symbol</dt>
              <dd>{diagnostics?.symbol?.symbolName ?? connection?.marketName ?? "—"}</dd>
            </div>
            <div>
              <dt>Bid</dt>
              <dd>{num(quote?.bid ?? connection?.bid, 3)}</dd>
            </div>
            <div>
              <dt>Ask</dt>
              <dd>{num(quote?.ask ?? connection?.ask, 3)}</dd>
            </div>
            <div>
              <dt>Spread</dt>
              <dd>{num(quote?.spread ?? connection?.spread, 3)}</dd>
            </div>
            <div>
              <dt>Quote time</dt>
              <dd>{quote?.timestamp ?? connection?.lastHeartbeatAt ?? "—"}</dd>
            </div>
            <div>
              <dt>Market status</dt>
              <dd>{quote?.marketStatus ?? connection?.marketStatus ?? "—"}</dd>
            </div>
          </dl>
        </article>

        <article className="gm-at-card" data-testid="autotrade-card-signal">
          <h3>GoldMeta signal</h3>
          <p className="gm-meta">
            Preview only — no order will be submitted. Open Intelligence for the live BUY / SELL /
            WAIT recommendation.
          </p>
          <Link className="gm-btn gm-btn-text" to="/">
            Review trade on Dashboard
          </Link>
        </article>

        <article className="gm-at-card" data-testid="autotrade-card-risk">
          <h3>Risk today</h3>
          <dl data-testid="autotrade-budget">
            <div>
              <dt>Trades used / max</dt>
              <dd>
                {budget?.tradesUsed ?? 0} / {budget?.tradesMax ?? limits.maxTradesPerDay}
              </dd>
            </div>
            <div>
              <dt>Daily loss / limit</dt>
              <dd>
                {money(budget?.dailyRealisedPnl ?? 0, currency)} /{" "}
                {money(budget?.dailyLossLimit ?? limits.maxDailyLoss, currency)}
              </dd>
            </div>
            <div>
              <dt>Open exposure</dt>
              <dd>{money(budget?.marginUsed ?? 0, currency)}</dd>
            </div>
            <div>
              <dt>Risk per trade</dt>
              <dd>{money(limits.maxLossPerTrade, currency)}</dd>
            </div>
            <div>
              <dt>AutoTrade eligibility</dt>
              <dd>Not completed — waiting for owner</dd>
            </div>
          </dl>
        </article>

        <article className="gm-at-card" data-testid="autotrade-card-position">
          <h3>Current position</h3>
          {position ? (
            <dl>
              <div>
                <dt>Direction</dt>
                <dd>{position.direction}</dd>
              </div>
              <div>
                <dt>Volume</dt>
                <dd>{position.size}</dd>
              </div>
              <div>
                <dt>Entry</dt>
                <dd>{num(position.entry, 3)}</dd>
              </div>
              <div>
                <dt>SL</dt>
                <dd>{num(position.stop, 3)}</dd>
              </div>
              <div>
                <dt>TP</dt>
                <dd>{num(position.takeProfit, 3)}</dd>
              </div>
              <div>
                <dt>Floating P/L</dt>
                <dd>{money(position.unrealisedPnl, currency)}</dd>
              </div>
              <div>
                <dt>Position ID</dt>
                <dd>{position.dealId ? `…${String(position.dealId).slice(-4)}` : "—"}</dd>
              </div>
            </dl>
          ) : (
            <p className="gm-meta">No open Gold position.</p>
          )}
        </article>
      </section>

      <section className="gm-autotrade-panel" aria-labelledby="mode-heading">
        <h2 id="mode-heading" className="gm-section-title">
          Operating mode
        </h2>
        <div className="gm-autotrade-mode-grid">
          {(
            [
              ["OFF", "OFF"],
              ["SHADOW", "SHADOW (analysis only)"]
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={`gm-btn${status?.mode === mode ? " is-active" : ""}`}
              data-testid={`autotrade-mode-${mode}`}
              disabled={busy || Boolean(status?.locked && mode !== "OFF")}
              onClick={() => void run(() => api.autoTradeSetMode(mode))}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="gm-btn"
            data-testid="autotrade-mode-IG_DEMO_AUTO"
            disabled
            title="Replaced by Pepperstone cTrader Demo Auto — locked"
          >
            Demo Auto (locked)
          </button>
          <button
            type="button"
            className="gm-btn"
            data-testid="autotrade-mode-IG_LIVE_AUTO"
            disabled
            title="Live Auto is permanently locked"
          >
            Live Auto (locked)
          </button>
        </div>
      </section>

      <details className="gm-at-advanced" data-testid="autotrade-advanced">
        <summary>
          Advanced diagnostics {isOwner ? "(owner)" : "(restricted)"}
        </summary>
        <div className="gm-at-advanced-body">
          <p className="gm-meta">
            Raw broker diagnostics stay here so the daily dashboard stays clear. Secrets and full
            account numbers are never shown.
          </p>
          <ul className="gm-meta">
            <li>Environment: DEMO only · Live disabled</li>
            <li>Order submission: locked</li>
            <li>Trading scope: not requested</li>
            <li>
              Credentials configured:{" "}
              {diagnostics?.credentialsConfigured || centre?.readiness?.oauthConfigured
                ? "yes"
                : "unknown / missing"}
            </li>
            <li>
              Pepperstone confirmed: {diagnostics?.pepperstoneConfirmed ? "yes" : "not yet"}
            </li>
          </ul>
          <Link className="gm-btn" to="/brokers">
            Open Broker Control Centre
          </Link>
        </div>
      </details>

      <details
        className="gm-at-other-brokers"
        data-testid="autotrade-other-brokers"
        open={showT212 || selectedBroker === "T212_INVEST" || selectedBroker === "MANUAL"}
        onToggle={(e) => setShowT212((e.target as HTMLDetailsElement).open)}
      >
        <summary>Other brokers (not part of the cTrader Demo journey)</summary>
        <div className="gm-autotrade-broker-grid" data-testid="autotrade-broker-selection">
          <button
            type="button"
            className={`gm-autotrade-broker-card${
              selectedBroker === "PEPPERSTONE_CTRADER" ? " is-active" : ""
            }`}
            disabled={busy}
            onClick={() => selectBroker("PEPPERSTONE_CTRADER")}
          >
            <strong>Pepperstone cTrader Demo</strong>
            <span>Primary path · Demo read-only · AutoTrade OFF</span>
          </button>
          <button
            type="button"
            className={`gm-autotrade-broker-card${
              selectedBroker === "T212_INVEST" ? " is-active" : ""
            }`}
            disabled={busy}
            onClick={() => selectBroker("T212_INVEST")}
          >
            <strong>Trading 212 Practice</strong>
            <span>Separate gold-proxy path · read-only</span>
          </button>
          <button
            type="button"
            className={`gm-autotrade-broker-card${selectedBroker === "MANUAL" ? " is-active" : ""}`}
            disabled={busy}
            onClick={() => selectBroker("MANUAL")}
            data-testid="autotrade-manual-note"
          >
            <strong>Manual XAUUSD</strong>
            <span>Signals and confirm workflow · no broker orders</span>
          </button>
        </div>

        {selectedBroker === "T212_INVEST" ? (
          <section className="gm-autotrade-panel" data-testid="autotrade-t212-panel">
            <h3 className="gm-section-title">Trading 212 Practice</h3>
            <p className="gm-autotrade-disclaimer" data-testid="autotrade-t212-disclaimer">
              {status?.t212Disclaimer ?? T212_PROXY_DISCLAIMER_CLIENT}
            </p>
            <p className="gm-meta">
              Connection: {t212?.connectionState ?? "Disconnected"} · Orders locked
            </p>
            <div className="gm-autotrade-actions">
              <button
                type="button"
                className="gm-btn"
                disabled={busy}
                onClick={() => void run(() => api.autoTradeT212Connect("PRACTICE"))}
              >
                Connect Trading 212
              </button>
              <button
                type="button"
                className="gm-btn"
                disabled={busy}
                onClick={() => void searchInstruments()}
              >
                Search gold instruments
              </button>
            </div>
            {showInstrumentPicker ? (
              <ul className="gm-autotrade-candidate-list">
                {candidates.map((c) => (
                  <li key={c.instrumentId}>
                    <button
                      type="button"
                      className="gm-autotrade-candidate"
                      onClick={() => void confirmInstrument(c)}
                    >
                      <strong>{c.ticker}</strong>
                      <span>{c.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {proposal ? (
              <p className="gm-meta">
                Pending proposal status:{" "}
                {proposal.status === "DRY_RUN_APPROVED"
                  ? "Trade preview passed the safety checks"
                  : proposal.status === "SUBMISSION_DISABLED"
                    ? "Order submission is currently locked"
                    : proposal.status.replace(/_/g, " ")}
              </p>
            ) : null}
            <label className="gm-meta">
              Instrument query
              <input
                value={instrumentQuery}
                onChange={(e) => setInstrumentQuery(e.target.value)}
              />
            </label>
          </section>
        ) : null}
      </details>

      <section className="gm-autotrade-panel" aria-labelledby="activity-heading">
        <h2 id="activity-heading" className="gm-section-title">
          Activity
        </h2>
        <ul className="gm-autotrade-activity" data-testid="autotrade-activity">
          {(status?.activity ?? []).slice(0, 12).map((item) => (
            <li key={item.id} data-level={item.level}>
              <time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time>
              <span>{item.message}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
