import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import type {
  BrokerControlCentreResponse,
  CTraderDemonstrationBundle,
  CTraderDemoAccountOption,
  CTraderDiagnosticsReport
} from "../../lib/broker/ctraderTypes";
import { describeClientError } from "../../lib/errors";
import {
  brokerBadgeLabel,
  brokerDisplayName,
  connectionStatusLabel,
  formatUserTimestamp,
  wizardStatusLabel,
  wizardStatusTone
} from "../../lib/plainLanguage";
import { FriendlyErrorBanner } from "../../components/FriendlyErrorBanner";
import { StatusBadge } from "../../components/ui/primitives";
import { ApiError } from "../../types/models";

const FALLBACK_WIZARD = [
  {
    step: 1,
    title: "Create Pepperstone cTrader Demo account",
    status: "AVAILABLE",
    detail: "Open a Pepperstone Demo account that supports cTrader. TradingView alone is not enough."
  },
  {
    step: 2,
    title: "Register cTrader Open API application",
    status: "SETUP_REQUIRED",
    detail: "Create a Demo Open API app and set the GoldMeta redirect URL."
  },
  {
    step: 3,
    title: "Add secure credentials",
    status: "SETUP_REQUIRED",
    detail: "Store client ID, client secret and redirect URI in Secret Manager — never in the browser or GitHub."
  },
  {
    step: 4,
    title: "Connect account",
    status: "SETUP_REQUIRED",
    detail: "Use secure OAuth to connect. GoldMeta never asks for your broker password."
  },
  {
    step: 5,
    title: "Verify XAUUSD",
    status: "SETUP_REQUIRED",
    detail: "Confirm gold symbol metadata: volume minimum, step, contract size and margin."
  },
  {
    step: 6,
    title: "Run read-only checks",
    status: "SETUP_REQUIRED",
    detail: "Confirm live bid/ask, spread and market-open state without placing orders."
  },
  {
    step: 7,
    title: "Run trade previews",
    status: "SETUP_REQUIRED",
    detail: "Preview BUY / SELL sizing only. No Demo or Live order is submitted."
  },
  {
    step: 8,
    title: "Request Demo trading approval",
    status: "BLOCKED",
    detail: "Demo trading stays locked until readiness checks and separate approval are complete."
  }
];

function diagTone(ok: boolean): "positive" | "warning" | "negative" {
  return ok ? "positive" : "warning";
}

/**
 * Broker Control Centre — MANUAL / T212 / Pepperstone cTrader / IG parked.
 * AutoTrade remains OFF. No order submission. Demonstration data clearly labelled.
 */
export function BrokerControlCentrePage() {
  const { api } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [centre, setCentre] = useState<BrokerControlCentreResponse | null>(null);
  const [demo, setDemo] = useState<CTraderDemonstrationBundle | null>(null);
  const [diagnostics, setDiagnostics] = useState<CTraderDiagnosticsReport | null>(null);
  const [accounts, setAccounts] = useState<CTraderDemoAccountOption[]>([]);
  const [previewResult, setPreviewResult] = useState<{
    notice?: string;
    preview?: { action?: string; state?: string; proposedVolume?: number | null; riskAmount?: number | null };
    quote?: { bid?: number | null; ask?: number | null; spread?: number | null };
  } | null>(null);
  const [errorDetail, setErrorDetail] = useState<ReturnType<typeof describeClientError> | null>(
    null
  );
  const [infoBanner, setInfoBanner] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDemo, setShowDemo] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [selected, setSelected] = useState<string>("manual");
  const selectionTouchedRef = useRef(false);
  const oauthHandledRef = useRef(false);
  const load = useCallback(async () => {
    setLoading(true);
    setErrorDetail(null);
    try {
      const data = await api.getBrokerControlCentre();
      setCentre(data);
      if (!selectionTouchedRef.current) {
        setSelected(data.defaultBroker ?? "manual");
      }
      if (data.readiness?.connected) {
        try {
          const diag = await api.getCTraderDiagnostics();
          setDiagnostics(diag);
        } catch {
          /* diagnostics optional until account selected */
        }
      }
    } catch (e) {
      setErrorDetail(describeClientError(e, "Could not load broker options."));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (oauthHandledRef.current) return;
    const ctrader = searchParams.get("ctrader");
    if (!ctrader) return;
    oauthHandledRef.current = true;
    const reason = searchParams.get("reason");
    if (ctrader === "oauth_ok") {
      setInfoBanner("cTrader OAuth completed. Loading authorised accounts…");
      setSelected("pepperstone_ctrader");
      selectionTouchedRef.current = true;
      void api
        .listCTraderAccounts()
        .then((r) => {
          setAccounts(r.accounts ?? []);
          if ((r as { autoSelected?: { accountIdMasked?: string } }).autoSelected) {
            setInfoBanner("Pepperstone Demo account selected — read-only.");
          } else {
            setInfoBanner("OAuth completed. Select a Demo or Live account below.");
          }
          void load();
        })
        .catch((e: unknown) =>
          setErrorDetail(describeClientError(e, "Could not list broker accounts."))
        );
    } else if (ctrader === "oauth_error") {
      setErrorDetail(
        describeClientError(
          new ApiError(400, reason ?? "OAUTH_CANCELLED", "OAuth failed"),
          "Pepperstone connection could not be completed."
        )
      );
    }
    const next = new URLSearchParams(searchParams);
    next.delete("ctrader");
    next.delete("reason");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, api, load]);

  const loadDemo = async () => {
    setShowDemo(true);
    try {
      const data = await api.getCTraderDemonstration();
      setDemo(data);
    } catch (e) {
      setErrorDetail(describeClientError(e, "Could not load the labelled demonstration."));
    }
  };

  const startOAuth = async () => {
    setConnecting(true);
    setErrorDetail(null);
    try {
      const started = await api.startCTraderOAuth();
      if (started.authorizationUrl) {
        window.location.assign(started.authorizationUrl);
        return;
      }
      setErrorDetail(
        describeClientError(
          new ApiError(503, "CTRADER_SETUP_REQUIRED", "No authorization URL"),
          "Pepperstone connection could not be started."
        )
      );
    } catch (e) {
      setErrorDetail(
        describeClientError(
          e,
          "Pepperstone connection could not be started. Please try again from Broker Control Centre."
        )
      );
    } finally {
      setConnecting(false);
    }
  };

  const selectAccount = async (id: string, isLive = false) => {
    try {
      await api.selectCTraderAccount({
        ctidTraderAccountId: id,
        confirmPepperstone: true,
        confirmLiveSelection: isLive
      });
      setInfoBanner(
        isLive
          ? "Live account selected — confirmation stored; order submission stays disabled."
          : "Demo account selected — read-only checks can run."
      );
      const diag = await api.getCTraderDiagnostics();
      setDiagnostics(diag);
      await load();
    } catch (e) {
      setErrorDetail(describeClientError(e, "Could not select broker account."));
    }
  };

  const runPreview = async () => {
    try {
      const result = (await api.createCTraderPreview({
        decision: "BUY",
        confidence: 85
      })) as {
        notice?: string;
        preview?: {
          action?: string;
          state?: string;
          proposedVolume?: number | null;
          riskAmount?: number | null;
        };
        quote?: { bid?: number | null; ask?: number | null; spread?: number | null };
      };
      setPreviewResult(result);
    } catch (e) {
      setErrorDetail(describeClientError(e, "Could not build preview."));
    }
  };

  const disconnect = async () => {
    try {
      await api.disconnectCTrader();
      setDiagnostics(null);
      setAccounts([]);
      setPreviewResult(null);
      setInfoBanner("Pepperstone Demo disconnected.");
      await load();
    } catch (e) {
      setErrorDetail(describeClientError(e, "Could not disconnect."));
    }
  };

  const readiness = centre?.readiness;
  const authBlocked = Boolean(readiness?.authSetupRequired);
  const setupRequired = Boolean(readiness?.setupRequired ?? true);
  const connected = Boolean(readiness?.connected);
  const wizardSteps =
    readiness?.wizardSteps && readiness.wizardSteps.length >= 6
      ? readiness.wizardSteps
      : FALLBACK_WIZARD;
  const summary = readiness?.connectionSummary;

  const selectedBroker = (centre?.brokers ?? []).find((b) => b.id === selected);
  const connectionLabel = connected
    ? "Connected"
    : authBlocked || setupRequired
      ? "Setup required"
      : connectionStatusLabel(selectedBroker?.status);

  const diagRows: Array<{ key: string; label: string; ok: boolean }> = diagnostics
    ? [
        { key: "cred", label: "Credentials configured", ok: diagnostics.credentialsConfigured },
        { key: "oauth", label: "OAuth connected", ok: diagnostics.oauthConnected },
        { key: "demo", label: "Demo account selected", ok: diagnostics.demoAccountSelected },
        { key: "pep", label: "Pepperstone confirmed", ok: diagnostics.pepperstoneConfirmed },
        { key: "gold", label: "Gold symbol found", ok: diagnostics.goldSymbolFound },
        { key: "quote", label: "Live quote received", ok: diagnostics.liveQuoteReceived },
        { key: "spread", label: "Spread available", ok: diagnostics.spreadAvailable },
        { key: "vol", label: "Volume rules available", ok: diagnostics.volumeRulesAvailable },
        { key: "margin", label: "Margin metadata available", ok: diagnostics.marginMetadataAvailable },
        { key: "mkt", label: "Market status available", ok: diagnostics.marketStatusAvailable },
        { key: "lock", label: "Trading safely locked", ok: diagnostics.tradingSafelyLocked },
        { key: "at", label: "AutoTrade OFF", ok: diagnostics.autoTrade === "OFF" }
      ]
    : [];

  return (
    <div className="gm-broker-centre" data-testid="broker-control-centre">
      <header className="gm-broker-hero">
        <p className="gm-meta">Broker Control Centre</p>
        <h1 className="gm-section-title">Choose how GoldMeta connects to markets</h1>
        <p className="gm-broker-lead">
          Manual analysis stays available. Broker automation remains off. No order can be submitted
          from this screen.
        </p>

        <div className="gm-broker-top-status" data-testid="broker-top-status" aria-live="polite">
          <div className="gm-broker-status-cell">
            <span className="gm-label">Selected broker</span>
            <strong>{brokerDisplayName(selected, selectedBroker?.name)}</strong>
          </div>
          <div className="gm-broker-status-cell">
            <span className="gm-label">Connection</span>
            <strong data-testid="broker-connection-status">{connectionLabel}</strong>
          </div>
          <div className="gm-broker-status-cell">
            <span className="gm-label">Account type</span>
            <strong>{selected === "manual" ? "Analysis only" : "Demo"}</strong>
          </div>
          <div className="gm-broker-status-cell">
            <span className="gm-label">Trading mode</span>
            <strong>Trading locked</strong>
          </div>
          <div className="gm-broker-status-cell">
            <span className="gm-label">AutoTrade</span>
            <strong data-testid="autotrade-off-badge">OFF</strong>
          </div>
          <div className="gm-broker-status-cell">
            <span className="gm-label">Emergency STOP</span>
            <strong data-testid="emergency-stop-status">Armed (no live automation)</strong>
          </div>
        </div>

        <div className="gm-broker-status-row">
          <span className="gm-badge gm-badge-off" data-testid="no-order-badge">
            No order submission
          </span>
          <span className="gm-badge gm-badge-demo">Demo setup only</span>
          <span className="gm-badge gm-badge-warn">Live locked</span>
        </div>
      </header>

      {loading ? (
        <div className="gm-section" role="status" data-testid="broker-centre-loading">
          <div className="gm-skeleton" />
          <p>Loading broker options…</p>
        </div>
      ) : null}

      {infoBanner ? (
        <div className="gm-section" role="status" data-testid="broker-info-banner">
          <p>{infoBanner}</p>
        </div>
      ) : null}

      {errorDetail ? (
        <FriendlyErrorBanner
          detail={errorDetail}
          onRetry={() => void load()}
          testId="broker-centre-error"
        />
      ) : null}

      <section className="gm-section" aria-labelledby="broker-options-heading">
        <h2 id="broker-options-heading" className="gm-section-title">
          Broker options
        </h2>
        <div className="gm-broker-grid">
          {(centre?.brokers ?? []).map((b) => (
            <button
              key={b.id}
              type="button"
              className={`gm-broker-card${selected === b.id ? " is-selected" : ""}`}
              data-testid={`broker-card-${b.id}`}
              aria-pressed={selected === b.id}
              onClick={() => {
                selectionTouchedRef.current = true;
                setSelected(b.id);
              }}
            >
              <StatusBadge
                tone={
                  b.id === "pepperstone_ctrader"
                    ? connected
                      ? "positive"
                      : "warning"
                    : b.id === "trading212_invest"
                      ? "gold"
                      : "positive"
                }
              >
                {brokerBadgeLabel(b.badge)}
              </StatusBadge>
              <strong>{brokerDisplayName(b.id, b.name)}</strong>
              <span className="gm-broker-card-status">
                {connectionStatusLabel(b.status) === b.status
                  ? b.status.replace(/Auth Setup Required/i, "Connection setup required")
                  : connectionStatusLabel(b.status)}
              </span>
              <span className="gm-meta">
                {b.detail
                  .replace(/AutoTrade Locked/gi, "AutoTrade off")
                  .replace(/Live Locked/gi, "Live locked")
                  .replace(/order automation unmerged/gi, "practice read-only")}
              </span>
            </button>
          ))}
        </div>
        <p className="gm-meta">
          Switching brokers keeps AutoTrade OFF. Reconnecting never turns AutoTrade on.
        </p>
      </section>

      {selected === "pepperstone_ctrader" ? (
        <section
          className="gm-section gm-ctrader-panel"
          data-testid="ctrader-setup-panel"
          aria-labelledby="ctrader-heading"
        >
          <div className="gm-demo-watermark" aria-hidden="true">
            DEMO
          </div>
          <h2 id="ctrader-heading" className="gm-section-title">
            Pepperstone cTrader Demo
          </h2>
          <p className="gm-broker-lead">
            {connected
              ? "Demo OAuth connected — read-only. Trading stays locked."
              : "Connection setup required until secure credentials and OAuth are complete. TradingView alone cannot authorise GoldMeta for cTrader."}
          </p>

          {!connected ? (
            <div
              className="gm-auth-setup-required"
              data-testid="ctrader-setup-required"
              role="status"
            >
              <strong data-testid="auth-setup-required">
                {authBlocked
                  ? "Connection setup required"
                  : "Pepperstone connection required"}
              </strong>
              <p>
                {authBlocked
                  ? "Broker connect stays disabled until account security checks pass. Dashboard and analysis still work."
                  : "Add secure server credentials, then connect with OAuth. No broker password is collected here."}
              </p>
            </div>
          ) : (
            <div className="gm-risk-box" data-testid="ctrader-connected-summary" role="status">
              <strong>Connected (Demo read-only)</strong>
              <p className="gm-meta" style={{ marginBottom: 0 }}>
                Account {summary?.accountMasked ?? "—"} · {summary?.brokerName ?? "Broker pending"}
                {summary?.symbolName ? ` · ${summary.symbolName}` : ""}
                {summary?.lastSyncAt
                  ? ` · last sync ${formatUserTimestamp(summary.lastSyncAt)}`
                  : ""}
              </p>
            </div>
          )}

          <h3 className="gm-subsection-title">Setup checklist</h3>
          <ol className="gm-wizard-steps" data-testid="ctrader-wizard">
            {wizardSteps.map((step) => (
              <li key={step.step} data-testid={`wizard-step-${step.step}`}>
                <StatusBadge tone={wizardStatusTone(step.status)}>
                  <span data-testid={`wizard-status-${step.step}`}>
                    {wizardStatusLabel(step.status)}
                  </span>
                </StatusBadge>
                <div>
                  <strong>
                    Step {step.step} — {step.title}
                  </strong>
                  <p className="gm-meta">
                    {step.detail
                      .replace(/AUTH SETUP REQUIRED[^.]*\.?/gi, "Connection setup required.")
                      .replace(/CTRADER_CLIENT_[A-Z_*]+/g, "secure credentials")
                      .replace(/Missing:\s*/i, "Still needed: ")}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <div className="gm-broker-actions">
            {!connected ? (
              <button
                type="button"
                className="gm-btn"
                disabled={!readiness?.oauthConfigured || connecting}
                data-testid="ctrader-connect-btn"
                title={
                  !readiness?.oauthConfigured
                    ? "Secure credentials not added yet"
                    : "Start cTrader connection for your account"
                }
                onClick={() => void startOAuth()}
              >
                {connecting
                  ? "Starting…"
                  : !readiness?.oauthConfigured
                    ? "Connect unavailable"
                    : "Connect cTrader"}
              </button>
            ) : null}
            {connected ? (
              <>
                <button
                  type="button"
                  className="gm-btn"
                  data-testid="ctrader-refresh-accounts-btn"
                  onClick={() => {
                    void api
                      .listCTraderAccounts()
                      .then((r) => setAccounts(r.accounts ?? []))
                      .catch((e: unknown) =>
                        setErrorDetail(describeClientError(e, "Could not list broker accounts."))
                      );
                  }}
                >
                  Refresh accounts
                </button>
                <button
                  type="button"
                  className="gm-btn gm-btn-secondary"
                  data-testid="ctrader-diagnostics-btn"
                  onClick={() => {
                    void api
                      .getCTraderDiagnostics()
                      .then(setDiagnostics)
                      .catch((e: unknown) =>
                        setErrorDetail(describeClientError(e, "Could not load diagnostics."))
                      );
                  }}
                >
                  Refresh diagnostics
                </button>
                <button
                  type="button"
                  className="gm-btn gm-btn-secondary"
                  data-testid="ctrader-live-preview-btn"
                  onClick={() => void runPreview()}
                >
                  Trade preview only
                </button>
                <button
                  type="button"
                  className="gm-btn gm-btn-danger"
                  data-testid="ctrader-disconnect-btn"
                  onClick={() => void disconnect()}
                >
                  Disconnect
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="gm-btn gm-btn-secondary"
              data-testid="ctrader-demo-btn"
              onClick={() => void loadDemo()}
            >
              View labelled demonstration
            </button>
            <Link className="gm-btn gm-btn-secondary" to="/help">
              Open setup help
            </Link>
          </div>
          <p className="gm-meta" data-testid="no-order-controls">
            Order buttons stay hidden. No Demo or Live order can be sent from this page.
          </p>

          {accounts.length > 0 ? (
            <section
              className="gm-risk-box"
              data-testid="ctrader-account-selector"
              aria-labelledby="account-select-heading"
            >
              <h3 id="account-select-heading">Select broker account</h3>
              <p className="gm-meta">Demo and Live accounts from your OAuth connection. Live needs confirmation.</p>
              <ul className="gm-qual-list">
                {accounts.map((a) => (
                  <li key={a.ctidTraderAccountId}>
                    <button
                      type="button"
                      className="gm-btn gm-btn-secondary"
                      data-testid={`ctrader-account-${a.accountIdMasked}`}
                      onClick={() => void selectAccount(a.ctidTraderAccountId, Boolean(a.isLive))}
                    >
                      {a.brokerNameTitle ?? "Broker"} · {a.isLive ? "Live" : "Demo"} ·{" "}
                      {a.accountIdMasked} · {a.depositCurrency ?? "—"}
                      {a.selected ? " · Selected" : ""}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {diagnostics ? (
            <section
              className="gm-section"
              data-testid="ctrader-diagnostics"
              aria-labelledby="diag-heading"
            >
              <h3 id="diag-heading" className="gm-subsection-title">
                Connection diagnostics
              </h3>
              <ul className="gm-qual-list" data-testid="ctrader-diagnostics-list">
                {diagRows.map((row) => (
                  <li key={row.key}>
                    <StatusBadge tone={diagTone(row.ok)}>
                      {row.ok ? "Ready" : "Pending"}
                    </StatusBadge>{" "}
                    {row.label}
                  </li>
                ))}
              </ul>
              {diagnostics.quote ? (
                <div className="gm-risk-box" data-testid="ctrader-live-quote">
                  <strong>Live Demo data</strong>
                  <p className="gm-meta">
                    Bid {diagnostics.quote.bid ?? "—"} / Ask {diagnostics.quote.ask ?? "—"} ·
                    spread {diagnostics.quote.spread ?? "—"}
                    {diagnostics.quote.stale ? " · stale warning" : ""}
                    {diagnostics.quote.timestamp
                      ? ` · updated ${formatUserTimestamp(diagnostics.quote.timestamp)}`
                      : ""}
                  </p>
                </div>
              ) : null}
              {diagnostics.account ? (
                <div className="gm-risk-box" data-testid="ctrader-account-snapshot">
                  <strong>Demo account (masked)</strong>
                  <p className="gm-meta" style={{ marginBottom: 0 }}>
                    {diagnostics.account.accountIdMasked} · {diagnostics.connection.currency ?? "—"}{" "}
                    · equity {diagnostics.account.equity ?? "—"} · free{" "}
                    {diagnostics.account.freeMargin ?? "—"} · used{" "}
                    {diagnostics.account.usedMargin ?? "—"}
                    {diagnostics.account.leverage != null
                      ? ` · leverage ${diagnostics.account.leverage}`
                      : ""}
                  </p>
                </div>
              ) : null}
              <details className="gm-disclosure">
                <summary>Technical details</summary>
                <div className="gm-disclosure-body">
                  <p className="gm-meta" style={{ margin: 0 }}>
                    Symbol: {diagnostics.symbol?.symbolName ?? "—"}
                    <br />
                    Token refresh healthy:{" "}
                    {String(diagnostics.connection.tokenRefreshHealthy)}
                    <br />
                    Environment: {diagnostics.environment === "LIVE" ? "Live" : "Demo"} ·
                    AutoTrade OFF · mutations disabled
                  </p>
                </div>
              </details>
            </section>
          ) : null}

          {previewResult ? (
            <section
              className="gm-section gm-demo-fixture"
              data-testid="ctrader-preview-only"
              aria-labelledby="preview-heading"
            >
              <p className="gm-demo-banner" data-testid="preview-only-banner">
                {previewResult.notice ?? "Preview only — no order will be submitted."}
              </p>
              <h3 id="preview-heading">Trade preview</h3>
              <p>
                {previewResult.preview?.action ?? "—"} ·{" "}
                {previewResult.preview?.state?.replace(/_/g, " ") ?? "—"} · vol{" "}
                {previewResult.preview?.proposedVolume ?? "—"} · risk €
                {previewResult.preview?.riskAmount ?? "—"}
              </p>
              <p className="gm-meta">
                Bid {previewResult.quote?.bid ?? "—"} / Ask {previewResult.quote?.ask ?? "—"} ·
                spread {previewResult.quote?.spread ?? "—"}
              </p>
            </section>
          ) : null}

          <section aria-labelledby="readonly-heading" className="gm-risk-box">
            <h3 id="readonly-heading">Read-only checks (when connected)</h3>
            <ul>
              <li>Client ID / secret / redirect URI present on the server</li>
              <li>OAuth connection and Demo account selection</li>
              <li>Pepperstone account confirmation</li>
              <li>XAUUSD symbol discovery</li>
              <li>Live bid / ask, spread, volume minimum &amp; step</li>
              <li>Contract size, margin requirements, market-open state</li>
            </ul>
            <p className="gm-meta" style={{ marginBottom: 0 }}>
              Secrets are never stored in browser storage or shown in logs.
            </p>
          </section>

          <section aria-labelledby="risk-heading" className="gm-risk-box">
            <h3 id="risk-heading">Demo safety caps (server)</h3>
            <ul>
              <li>Max risk per trade €20</li>
              <li>Max one open XAUUSD position</li>
              <li>Max three trades per day</li>
              <li>Confidence ≥ 80% · signal age ≤ 90s</li>
              <li>Stop loss required · confirmed candle required</li>
              <li>No martingale / averaging / grid / pyramiding / blind retry</li>
            </ul>
          </section>

          <section aria-labelledby="qual-heading">
            <h3 id="qual-heading">Demo trading approval</h3>
            <p className="gm-meta">
              Progress is visible only — Demo Auto cannot be activated in this phase.
            </p>
            <ul className="gm-qual-list">
              {(readiness?.qualification.failed ?? []).slice(0, 8).map((g) => (
                <li key={g}>
                  <StatusBadge tone="warning">Locked</StatusBadge>{" "}
                  {g
                    .replace(/AUTH_HEALTHY/g, "Account security verified")
                    .replace(/OAUTH_HEALTHY/g, "Pepperstone connection verified")
                    .replace(/_/g, " ")
                    .toLowerCase()
                    .replace(/^\w/, (c) => c.toUpperCase())}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="emergency-heading">
            <h3 id="emergency-heading">Emergency STOP</h3>
            <p className="gm-meta">
              Emergency STOP will disable new automated entries when automation exists. It does not
              silently close positions. Trading is already locked today.
            </p>
            <div className="gm-broker-actions">
              <button type="button" className="gm-btn gm-btn-danger" disabled data-testid="emergency-stop-btn">
                Emergency STOP (armed)
              </button>
            </div>
          </section>

          <section
              className="gm-section gm-owner-setup-guide"
              data-testid="owner-setup-guide"
              aria-labelledby="owner-guide-heading"
            >
              <h3 id="owner-guide-heading">Broker setup guide</h3>
              <ol className="gm-help-steps">
                <li>TradingView connection alone is not enough for API-authorised trading.</li>
                <li>Create a Pepperstone cTrader Demo account (not just a chart login).</li>
                <li>Register a cTrader Open API Demo application.</li>
                <li>
                  Set the redirect URI to the GoldMeta OAuth callback provided by ops (server
                  function URL).
                </li>
                <li>
                  Store client ID, client secret, redirect URI and token encryption key in Secret
                  Manager — never commit them to GitHub.
                </li>
                <li>OAuth will connect the account without pasting a broker password into GoldMeta.</li>
                <li>Run read-only verification before requesting any Demo trading approval.</li>
              </ol>
              <p className="gm-meta">
                Do not paste broker passwords here. Do not enable Demo or Live order submission from
                this screen.
              </p>
              <details className="gm-disclosure">
                <summary>Technical details</summary>
                <div className="gm-disclosure-body">
                  <p className="gm-meta" style={{ margin: 0 }}>
                    Server label: {readiness?.label ?? "Pepperstone connection required"}
                    <br />
                    OAuth configured: {readiness?.oauthConfigured ? "yes" : "no"}
                    <br />
                    Flags remain hard-disabled: broker execution, Demo orders, Live trading.
                  </p>
                </div>
              </details>
            </section>
        </section>
      ) : null}

      {selected === "manual" ? (
        <section className="gm-section" data-testid="manual-broker-panel">
          <h2 className="gm-section-title">Manual mode</h2>
          <p>
            GoldMeta continues to provide BUY / SELL / WAIT analysis without any broker execution.
            Use Signal History, Outcomes and Performance as usual.
          </p>
          <Link className="gm-btn" to="/">
            Back to Dashboard
          </Link>
        </section>
      ) : null}

      {selected === "trading212_invest" ? (
        <section className="gm-section" data-testid="t212-broker-panel">
          <h2 className="gm-section-title">Trading 212 Practice</h2>
          <p>
            Practice stays read-only. Order automation is not enabled from GoldMeta in this phase.
          </p>
          <Link className="gm-btn" to="/autotrade">
            Open practice view
          </Link>
        </section>
      ) : null}

      {showDemo && demo ? (
        <section
          className="gm-section gm-demo-fixture"
          data-testid="ctrader-demonstration"
          aria-labelledby="demo-heading"
        >
          <p className="gm-demo-banner">{demo.banner || demo.notice}</p>
          <h2 id="demo-heading" className="gm-section-title">
            Demonstration mode
          </h2>
          <p className="gm-meta">Labelled sample data — no broker connection — no order placed</p>
          <div className="gm-demo-grid">
            <article>
              <h3>Sample Demo account</h3>
              <p>ID {demo.account.accountIdMasked}</p>
              <p>
                {demo.account.currency} equity {demo.account.equity} · free margin{" "}
                {demo.account.freeMargin}
              </p>
              <p>
                Broker {demo.account.brokerName} ({demo.account.brokerNameSource})
              </p>
            </article>
            <article>
              <h3>Sample XAUUSD</h3>
              <p>
                {demo.symbol.symbolName} · lot {demo.symbol.lotSize} · min {demo.symbol.minVolume}{" "}
                step {demo.symbol.volumeStep}
              </p>
              <p>
                Bid {demo.quote.bid} / Ask {demo.quote.ask} · spread {demo.quote.spread} ·{" "}
                {demo.quote.marketStatus}
              </p>
            </article>
            <article>
              <h3>Sample BUY preview</h3>
              <p>
                {demo.buyPreview.state.replace(/_/g, " ")} · vol {demo.buyPreview.proposedVolume} ·
                risk €{demo.buyPreview.riskAmount}
              </p>
            </article>
            <article>
              <h3>Sample SELL preview</h3>
              <p>
                {demo.sellPreview.state.replace(/_/g, " ")} · vol {demo.sellPreview.proposedVolume}
              </p>
            </article>
            <article>
              <h3>Blocked trade example</h3>
              <p>{demo.blockedPreview.failedGates.join(", ").replace(/_/g, " ")}</p>
            </article>
          </div>
          <details className="gm-disclosure">
            <summary>Technical details</summary>
            <div className="gm-disclosure-body">
              <p className="gm-meta" style={{ margin: 0 }}>
                Quote source: {demo.quote.source}
                <br />
                AutoTrade: {demo.autoTrade} · Order submission:{" "}
                {String(demo.orderSubmissionEnabled)}
              </p>
            </div>
          </details>
        </section>
      ) : null}

      <section className="gm-section" aria-labelledby="help-heading">
        <h2 id="help-heading" className="gm-section-title">
          Need help?
        </h2>
        <ul className="gm-help-list">
          <li>TradingView alone cannot place API-authorised cTrader orders.</li>
          <li>Create a Pepperstone cTrader Demo account, then register an Open API app.</li>
          <li>GoldMeta never collects your cTrader password.</li>
          <li>Live trading is locked and cannot be activated here.</li>
        </ul>
        <p className="gm-meta">
          <Link to="/help">Open the GoldMeta help guide</Link>
        </p>
      </section>
    </div>
  );
}
