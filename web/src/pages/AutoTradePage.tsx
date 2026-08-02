import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type {
  AutoTradeStatus,
  SelectedBrokerId,
  T212InstrumentCandidate
} from "../lib/autoTradeTypes";
import {
  FIRST_PILOT_LIMITS_CLIENT,
  T212_PROXY_DISCLAIMER_CLIENT
} from "../lib/autoTradeTypes";
import type {
  BrokerControlCentreResponse,
  CTraderBrokerAccountOption,
  CTraderDiagnosticsReport,
  UserAutoTradeSettingsDto
} from "../lib/broker/ctraderTypes";
import {
  AutoTradeOnboarding,
  buildOnboardingSteps
} from "../components/autotrade/AutoTradeOnboarding";
import { LiveActivationConfirm } from "../components/autotrade/LiveActivationConfirm";

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

type ModeTab = "demo" | "live";

export function AutoTradePage() {
  const { api, account } = useAuth();
  const [status, setStatus] = useState<AutoTradeStatus | null>(null);
  const [centre, setCentre] = useState<BrokerControlCentreResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<CTraderDiagnosticsReport | null>(null);
  const [accounts, setAccounts] = useState<CTraderBrokerAccountOption[]>([]);
  const [settings, setSettings] = useState<UserAutoTradeSettingsDto | null>(null);
  const [recommended, setRecommended] = useState<Record<string, unknown> | null>(null);
  const [mode, setMode] = useState<ModeTab>("demo");
  const [showSettings, setShowSettings] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const [showLiveConfirm, setShowLiveConfirm] = useState(false);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showT212, setShowT212] = useState(false);
  const [instrumentQuery, setInstrumentQuery] = useState("");
  const [showInstrumentPicker, setShowInstrumentPicker] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [previewOk, setPreviewOk] = useState(false);
  const [pendingLiveAccountId, setPendingLiveAccountId] = useState<string | null>(null);

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
      /* optional */
    }
    try {
      const d = await api.getCTraderDiagnostics();
      setDiagnostics(d);
      if (d.selectedAccountIsLive || d.environment === "LIVE") setMode("live");
      else if (d.demoAccountSelected) setMode("demo");
    } catch {
      setDiagnostics(null);
    }
    try {
      const listed = await api.listCTraderAccounts();
      setAccounts(listed.accounts ?? []);
    } catch {
      setAccounts([]);
    }
  }, [api]);

  const loadSettings = useCallback(
    async (env: ModeTab) => {
      try {
        const res = await api.getAutoTradeSettings(env);
        setSettings(res.settings);
        setRecommended(res.recommended ?? null);
      } catch {
        setSettings(null);
      }
    },
    [api]
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void loadSettings(mode);
  }, [loadSettings, mode]);

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

  const connectionLabel = diagnostics?.oauthConnected
    ? diagnostics.accountSelected || diagnostics.demoAccountSelected
      ? "Connected"
      : "Action required"
    : centre?.readiness?.connected
      ? "Connected"
      : "Disconnected";

  const autoTradeLabel = "OFF";
  const rawMarket = diagnostics?.quote?.marketStatus || connection?.marketStatus || "";
  const symbolName =
    diagnostics?.symbol?.symbolName ?? connection?.marketName ?? "XAUUSD";
  const marketOpen =
    rawMarket.toUpperCase() === "OPEN" || rawMarket.toUpperCase().includes("TRADEABLE");
  const marketLabel = rawMarket
    ? `${symbolName} · ${marketOpen ? "Open" : rawMarket}`
    : `${symbolName} · status unknown`;

  const accountLabel = diagnostics?.connection?.accountMasked
    ? `${diagnostics.connection.brokerName ?? "Broker"} ${mode === "live" ? "Live" : "Demo"} · ${diagnostics.connection.accountMasked}`
    : mode === "live"
      ? "No Live account selected"
      : "No Demo account selected";

  const modeLabel = mode === "live" ? "Live AutoTrade" : "Demo AutoTrade";
  const fundsLabel = mode === "live" ? "Real money" : "Demo funds";

  const onboarding = useMemo(
    () =>
      buildOnboardingSteps({
        emailVerified: account?.emailVerified !== false,
        connected: Boolean(diagnostics?.oauthConnected || centre?.readiness?.connected),
        accountSelected: Boolean(
          diagnostics?.accountSelected || diagnostics?.demoAccountSelected
        ),
        mode,
        goldOk: Boolean(diagnostics?.goldSymbolFound),
        settingsSaved,
        checksOk: Boolean(diagnostics?.liveQuoteReceived),
        previewOk,
        tradingAuthorised: false,
        autoTradeOn: false
      }),
    [account?.emailVerified, centre, diagnostics, mode, settingsSaved, previewOk]
  );

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

  const selectAccount = async (acct: CTraderBrokerAccountOption) => {
    setBusy(true);
    setError(null);
    try {
      if (acct.isLive) {
        setMode("live");
        setPendingLiveAccountId(acct.ctidTraderAccountId);
        setShowLiveConfirm(true);
        return;
      }
      await api.selectCTraderAccount({
        ctidTraderAccountId: acct.ctidTraderAccountId,
        confirmPepperstone: true,
        confirmLiveSelection: false
      });
      setMode("demo");
      await reload();
      await loadSettings("demo");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not select account");
    } finally {
      setBusy(false);
    }
  };

  const confirmLiveAccount = async (phrase: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.confirmLiveAutoTradeActivation(phrase);
      const targetId =
        pendingLiveAccountId ??
        accounts.find((a) => a.isLive && a.selected)?.ctidTraderAccountId ??
        accounts.find((a) => a.isLive)?.ctidTraderAccountId;
      if (!targetId) throw new Error("No Live account available");
      await api.selectCTraderAccount({
        ctidTraderAccountId: targetId,
        confirmPepperstone: true,
        confirmLiveSelection: true
      });
      setShowLiveConfirm(false);
      setPendingLiveAccountId(null);
      setMode("live");
      await reload();
      await loadSettings("live");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Live confirmation failed");
    } finally {
      setBusy(false);
    }
  };

  const saveSettingsPatch = async (patch: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.saveAutoTradeSettings(mode, patch);
      setSettings(res.settings);
      setSettingsSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async () => {
    setBusy(true);
    setError(null);
    setPreviewNote(null);
    try {
      const result = (await api.createCTraderPreview({
        decision: "BUY",
        confidence: settings?.minConfidence ?? 85
      })) as { notice?: string; preview?: { action?: string; state?: string } };
      setPreviewNote(
        result.notice ??
          `Preview ${result.preview?.action ?? "—"} · ${result.preview?.state ?? "—"} — no order submitted.`
      );
      setPreviewOk(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  };

  const emergencyStop = async () => {
    setBusy(true);
    try {
      await api.setCTraderEmergencyStop({ environment: mode, active: true });
      await run(() => api.autoTradeEmergencyStop());
    } finally {
      setBusy(false);
    }
  };

  const demoAccount = diagnostics?.account;
  const quote = diagnostics?.quote;
  const position = status?.positions?.[0] ?? null;
  const currency =
    demoAccount?.currency ??
    diagnostics?.connection?.currency ??
    connection?.currency ??
    budget?.currency ??
    "EUR";

  const filteredAccounts = accounts.filter((a) => (mode === "live" ? a.isLive : !a.isLive));

  return (
    <div className="gm-autotrade gm-at-dashboard" data-testid="autotrade-page">
      <header className="gm-autotrade-hero">
        <div className="gm-autotrade-hero-copy">
          <p className="gm-autotrade-kicker">GoldMeta</p>
          <h1 className="gm-page-title gm-autotrade-title">AutoTrade</h1>
          <p className="gm-meta gm-autotrade-lead">
            Connect your own broker account, choose Demo or Live, configure risk, and preview
            trades. Order submission stays disabled in this preview.
          </p>
        </div>
      </header>

      <section className="gm-at-summary" data-testid="autotrade-status" aria-label="Status summary">
        <div>
          <span className="gm-label">Account</span>
          <strong data-testid="autotrade-broker-badge">{accountLabel}</strong>
        </div>
        <div>
          <span className="gm-label">Mode</span>
          <strong data-testid="autotrade-mode-label">{modeLabel}</strong>
        </div>
        <div>
          <span className="gm-label">Connection</span>
          <strong data-testid="autotrade-connection-label">{connectionLabel}</strong>
        </div>
        <div>
          <span className="gm-label">Market</span>
          <strong data-testid="autotrade-market-label">{marketLabel}</strong>
        </div>
        <div>
          <span className="gm-label">AutoTrade</span>
          <span className={`gm-at-pill ${statusTone(display)}`} data-testid="autotrade-mode-pill">
            {autoTradeLabel}
          </span>
        </div>
        <div>
          <span className="gm-label">Funds</span>
          <strong>{fundsLabel}</strong>
        </div>
      </section>

      <div className="gm-at-mode-tabs" role="tablist" aria-label="Account type">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "demo"}
          className={`gm-btn${mode === "demo" ? " is-active" : ""}`}
          data-testid="autotrade-tab-demo"
          onClick={() => setMode("demo")}
        >
          Demo
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "live"}
          className={`gm-btn${mode === "live" ? " is-active" : ""}`}
          data-testid="autotrade-tab-live"
          onClick={() => setMode("live")}
        >
          Live
        </button>
      </div>

      <div className="gm-autotrade-readonly-banner" data-testid="autotrade-readonly-banner">
        Broker order submission is disabled. AutoTrade stays OFF. You can select Demo or Live
        accounts, save settings, and run previews — no Demo or Live order is submitted.
      </div>

      <section
        className="gm-autotrade-stop-bar"
        aria-label="Emergency stop"
        data-testid="autotrade-emergency-bar"
      >
        <div>
          <strong>Emergency STOP</strong>
          <p className="gm-meta">
            Applies to your {mode === "live" ? "Live" : "Demo"} automation only. Turns AutoTrade OFF
            for that mode. Open positions are not closed automatically.
          </p>
        </div>
        <button
          type="button"
          className="gm-btn gm-btn-danger"
          data-testid="autotrade-emergency-stop"
          disabled={busy}
          onClick={() => void emergencyStop()}
        >
          Emergency STOP
        </button>
      </section>

      {error ? (
        <p className="gm-error" role="alert">
          {error}
        </p>
      ) : null}
      {previewNote ? (
        <p className="gm-meta" data-testid="autotrade-preview-note">
          {previewNote}
        </p>
      ) : null}

      {showLiveConfirm ? (
        <LiveActivationConfirm
          brokerName={
            accounts.find((a) => a.isLive)?.brokerNameTitle ??
            diagnostics?.connection?.brokerName ??
            "Pepperstone"
          }
          accountMasked={
            accounts.find((a) => a.isLive)?.accountIdMasked ??
            diagnostics?.connection?.accountMasked ??
            "—"
          }
          currency={currency}
          riskPerTrade={settings?.fixedRiskAmount ?? 20}
          maxDailyLoss={settings?.maxDailyLoss ?? 50}
          maxTradesPerDay={settings?.maxTradesPerDay ?? 3}
          busy={busy}
          onCancel={() => setShowLiveConfirm(false)}
          onConfirm={confirmLiveAccount}
        />
      ) : null}

      <AutoTradeOnboarding steps={onboarding} />

      <section className="gm-at-actions" aria-label="Primary controls">
        <button
          type="button"
          className="gm-btn gm-btn-primary"
          data-testid="autotrade-select-account"
          onClick={() => setShowAccounts((v) => !v)}
        >
          Select account
        </button>
        <Link className="gm-btn" to="/brokers" data-testid="autotrade-connect-ctrader">
          Connect cTrader
        </Link>
        <button
          type="button"
          className="gm-btn"
          data-testid="autotrade-edit-settings"
          onClick={() => setShowSettings((v) => !v)}
        >
          Edit AutoTrade settings
        </button>
        <button
          type="button"
          className="gm-btn"
          disabled={busy}
          onClick={() => void runPreview()}
          data-testid="autotrade-preview-trade"
        >
          Preview next trade
        </button>
        <button
          type="button"
          className="gm-btn"
          disabled
          title="Order submission disabled in this preview"
          data-testid="autotrade-enable-demo-auto"
        >
          Enable Demo Auto
        </button>
        <button
          type="button"
          className="gm-btn"
          disabled={mode !== "live"}
          title="Requires Live confirmation — execution still OFF in preview"
          data-testid="autotrade-open-live-confirm"
          onClick={() => setShowLiveConfirm(true)}
        >
          Enable Live Auto
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
        <button
          type="button"
          className="gm-btn"
          disabled
          title="Position close requires trading scope"
          data-testid="autotrade-close-position"
        >
          Close selected position
        </button>
        <button
          type="button"
          className="gm-btn"
          disabled
          title="Requires separate approval for trading scope"
          data-testid="autotrade-authorise-demo-trading"
        >
          Authorise trading
        </button>
        <button
          type="button"
          className="gm-btn"
          disabled={busy || !pepperstoneSelected}
          onClick={() => void reload()}
          data-testid="autotrade-run-check"
        >
          Run connection check
        </button>
      </section>

      {showAccounts ? (
        <section className="gm-at-account-list" data-testid="autotrade-account-list">
          <h2 className="gm-section-title">Authorised broker accounts</h2>
          <p className="gm-meta">
            Showing {mode === "live" ? "Live (real money)" : "Demo (demo funds)"} accounts returned
            by your cTrader connection.
          </p>
          {filteredAccounts.length === 0 ? (
            <p className="gm-meta">No {mode === "live" ? "Live" : "Demo"} accounts found. Connect cTrader first.</p>
          ) : (
            <ul>
              {filteredAccounts.map((acct) => (
                <li key={acct.ctidTraderAccountId}>
                  <button
                    type="button"
                    className={`gm-at-account-option${acct.selected ? " is-selected" : ""}`}
                    disabled={busy}
                    onClick={() => void selectAccount(acct)}
                  >
                    <strong>{acct.brokerNameTitle ?? "Broker"}</strong>
                    <span>
                      {acct.isLive ? "Live account" : "Demo account"} · {acct.accountIdMasked}
                    </span>
                    <span>
                      {acct.depositCurrency ?? "—"}
                      {acct.balance != null ? ` · ${money(acct.balance, acct.depositCurrency ?? "EUR")}` : ""}
                    </span>
                    <span>{acct.connectionStatus ?? "Connected"} · {acct.tradingPermission ?? "Read only"}</span>
                    {acct.selected ? <em>Selected</em> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {showSettings && settings ? (
        <section className="gm-at-settings" data-testid="autotrade-settings-panel">
          <h2 className="gm-section-title">
            {mode === "live" ? "Live" : "Demo"} AutoTrade settings
          </h2>
          <p className="gm-meta">
            Settings are stored separately for Demo and Live under your account. Recommended values
            are shown beside each field.
          </p>
          <div className="gm-at-settings-grid">
            <label>
              Sizing mode
              <select
                value={settings.sizingMode}
                onChange={(e) =>
                  void saveSettingsPatch({
                    sizingMode: e.target.value as "automatic_risk" | "manual_lots"
                  })
                }
              >
                <option value="automatic_risk">Automatic risk-based</option>
                <option value="manual_lots">Manual lot size</option>
              </select>
              <span className="gm-meta">
                Recommended: {String(recommended?.sizingMode ?? "automatic_risk")}
              </span>
            </label>
            <label>
              Fixed risk amount
              <input
                type="number"
                value={settings.fixedRiskAmount}
                onChange={(e) =>
                  setSettings({ ...settings, fixedRiskAmount: Number(e.target.value) })
                }
                onBlur={() => void saveSettingsPatch({ fixedRiskAmount: settings.fixedRiskAmount })}
              />
              <span className="gm-meta">Recommended: {String(recommended?.fixedRiskAmount ?? 20)}</span>
            </label>
            <label>
              Percentage risk
              <input
                type="number"
                step="0.01"
                value={settings.percentageRisk}
                onChange={(e) =>
                  setSettings({ ...settings, percentageRisk: Number(e.target.value) })
                }
                onBlur={() => void saveSettingsPatch({ percentageRisk: settings.percentageRisk })}
              />
            </label>
            <label>
              Manual lot size
              <input
                type="number"
                step="0.01"
                value={settings.manualLotSize}
                disabled={settings.sizingMode !== "manual_lots"}
                onChange={(e) =>
                  setSettings({ ...settings, manualLotSize: Number(e.target.value) })
                }
                onBlur={() => void saveSettingsPatch({ manualLotSize: settings.manualLotSize })}
              />
            </label>
            <label>
              Maximum daily loss
              <input
                type="number"
                value={settings.maxDailyLoss}
                onChange={(e) =>
                  setSettings({ ...settings, maxDailyLoss: Number(e.target.value) })
                }
                onBlur={() => void saveSettingsPatch({ maxDailyLoss: settings.maxDailyLoss })}
              />
            </label>
            <label>
              Maximum trades per day
              <input
                type="number"
                value={settings.maxTradesPerDay}
                onChange={(e) =>
                  setSettings({ ...settings, maxTradesPerDay: Number(e.target.value) })
                }
                onBlur={() => void saveSettingsPatch({ maxTradesPerDay: settings.maxTradesPerDay })}
              />
            </label>
            <label>
              Maximum open positions
              <input
                type="number"
                value={settings.maxOpenPositions}
                onChange={(e) =>
                  setSettings({ ...settings, maxOpenPositions: Number(e.target.value) })
                }
                onBlur={() =>
                  void saveSettingsPatch({ maxOpenPositions: settings.maxOpenPositions })
                }
              />
            </label>
            <label>
              Minimum confidence
              <input
                type="number"
                value={settings.minConfidence}
                onChange={(e) =>
                  setSettings({ ...settings, minConfidence: Number(e.target.value) })
                }
                onBlur={() => void saveSettingsPatch({ minConfidence: settings.minConfidence })}
              />
            </label>
            <label>
              Minimum risk/reward
              <input
                type="number"
                step="0.1"
                value={settings.minRiskReward}
                onChange={(e) =>
                  setSettings({ ...settings, minRiskReward: Number(e.target.value) })
                }
                onBlur={() => void saveSettingsPatch({ minRiskReward: settings.minRiskReward })}
              />
            </label>
            <label>
              Maximum spread
              <input
                type="number"
                step="0.01"
                value={settings.maxSpread}
                onChange={(e) => setSettings({ ...settings, maxSpread: Number(e.target.value) })}
                onBlur={() => void saveSettingsPatch({ maxSpread: settings.maxSpread })}
              />
            </label>
            <label>
              Maximum quote age (seconds)
              <input
                type="number"
                value={settings.maxQuoteAgeSeconds}
                onChange={(e) =>
                  setSettings({ ...settings, maxQuoteAgeSeconds: Number(e.target.value) })
                }
                onBlur={() =>
                  void saveSettingsPatch({ maxQuoteAgeSeconds: settings.maxQuoteAgeSeconds })
                }
              />
            </label>
            <label>
              Trade cooldown (minutes)
              <input
                type="number"
                value={settings.tradeCooldownMinutes}
                onChange={(e) =>
                  setSettings({ ...settings, tradeCooldownMinutes: Number(e.target.value) })
                }
                onBlur={() =>
                  void saveSettingsPatch({ tradeCooldownMinutes: settings.tradeCooldownMinutes })
                }
              />
            </label>
            <label>
              Pause after consecutive losses
              <input
                type="number"
                value={settings.pauseAfterConsecutiveLosses}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    pauseAfterConsecutiveLosses: Number(e.target.value)
                  })
                }
                onBlur={() =>
                  void saveSettingsPatch({
                    pauseAfterConsecutiveLosses: settings.pauseAfterConsecutiveLosses
                  })
                }
              />
            </label>
            <label className="gm-at-switch">
              <input
                type="checkbox"
                checked={settings.newsFilterEnabled}
                onChange={(e) => void saveSettingsPatch({ newsFilterEnabled: e.target.checked })}
              />
              News filter
            </label>
            <label className="gm-at-switch">
              <input
                type="checkbox"
                checked={settings.confirmationCandleRequired}
                onChange={(e) =>
                  void saveSettingsPatch({ confirmationCandleRequired: e.target.checked })
                }
              />
              Confirmation candle
            </label>
            <label className="gm-at-switch">
              <input
                type="checkbox"
                checked={settings.trendConfirmationRequired}
                onChange={(e) =>
                  void saveSettingsPatch({ trendConfirmationRequired: e.target.checked })
                }
              />
              Trend confirmation
            </label>
            <label className="gm-at-switch">
              <input
                type="checkbox"
                checked={settings.volumeConfirmationRequired}
                onChange={(e) =>
                  void saveSettingsPatch({ volumeConfirmationRequired: e.target.checked })
                }
              />
              Volume confirmation
            </label>
            <label className="gm-at-switch">
              <input
                type="checkbox"
                checked={settings.breakEvenEnabled}
                onChange={(e) => void saveSettingsPatch({ breakEvenEnabled: e.target.checked })}
              />
              Break-even rule
            </label>
            <label className="gm-at-switch">
              <input
                type="checkbox"
                checked={settings.trailingStopEnabled}
                onChange={(e) => void saveSettingsPatch({ trailingStopEnabled: e.target.checked })}
              />
              Trailing-stop rule
            </label>
            <label className="gm-at-switch">
              <input
                type="checkbox"
                checked={settings.partialTakeProfitEnabled}
                onChange={(e) =>
                  void saveSettingsPatch({ partialTakeProfitEnabled: e.target.checked })
                }
              />
              Partial take-profit
            </label>
          </div>
        </section>
      ) : null}

      <p className="gm-meta gm-at-locked-note" data-testid="autotrade-demo-auto-note">
        Demo and Live AutoTrade interfaces are available to every verified active user. Execution
        remains OFF while order submission is disabled.
      </p>

      <section className="gm-at-cards" aria-label="Daily overview">
        <article className="gm-at-card" data-testid="autotrade-card-market">
          <h3>Market</h3>
          <dl>
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
              <dt>Market status</dt>
              <dd>{quote?.marketStatus ?? connection?.marketStatus ?? "—"}</dd>
            </div>
          </dl>
        </article>

        <article className="gm-at-card" data-testid="autotrade-card-signal">
          <h3>Signal</h3>
          <p className="gm-meta">
            BUY / SELL / WAIT · confidence · entry · stop loss · take profit — preview only.
          </p>
          <button type="button" className="gm-btn gm-btn-text" onClick={() => void runPreview()}>
            Preview next trade
          </button>
        </article>

        <article className="gm-at-card" data-testid="autotrade-card-risk">
          <h3>Trade size</h3>
          <dl data-testid="autotrade-budget">
            <div>
              <dt>Sizing mode</dt>
              <dd>
                {settings?.sizingMode === "manual_lots"
                  ? "Manual lot size"
                  : "Automatic risk-based"}
              </dd>
            </div>
            <div>
              <dt>Risk amount</dt>
              <dd>{money(settings?.fixedRiskAmount ?? limits.maxLossPerTrade, currency)}</dd>
            </div>
            <div>
              <dt>Manual lots</dt>
              <dd>{settings?.manualLotSize ?? "—"}</dd>
            </div>
            <div>
              <dt>Broker min / step</dt>
              <dd>
                {diagnostics?.symbol?.minVolume ?? "—"} / {diagnostics?.symbol?.volumeStep ?? "—"}
              </dd>
            </div>
          </dl>
        </article>

        <article className="gm-at-card" data-testid="autotrade-card-account">
          <h3>Today</h3>
          <dl>
            <div>
              <dt>P/L</dt>
              <dd>{money(budget?.dailyRealisedPnl ?? 0, currency)}</dd>
            </div>
            <div>
              <dt>Trades taken</dt>
              <dd>
                {budget?.tradesUsed ?? 0} / {settings?.maxTradesPerDay ?? limits.maxTradesPerDay}
              </dd>
            </div>
            <div>
              <dt>Daily limit used</dt>
              <dd>
                {money(budget?.dailyRealisedPnl ?? 0, currency)} /{" "}
                {money(settings?.maxDailyLoss ?? limits.maxDailyLoss, currency)}
              </dd>
            </div>
            <div>
              <dt>Open positions</dt>
              <dd>{status?.positions?.length ?? 0}</dd>
            </div>
            <div>
              <dt>Balance</dt>
              <dd>{money(demoAccount?.balance ?? connection?.balance, currency)}</dd>
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
                <dt>Size</dt>
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
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              className={`gm-btn${status?.mode === m ? " is-active" : ""}`}
              data-testid={`autotrade-mode-${m}`}
              disabled={busy || Boolean(status?.locked && m !== "OFF")}
              onClick={() => void run(() => api.autoTradeSetMode(m))}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="gm-btn"
            data-testid="autotrade-mode-IG_DEMO_AUTO"
            disabled
            title="Demo Auto execution locked while order submission is disabled"
          >
            Demo Auto (locked)
          </button>
          <button
            type="button"
            className="gm-btn"
            data-testid="autotrade-mode-IG_LIVE_AUTO"
            disabled
            title="Live Auto execution locked while order submission is disabled"
          >
            Live Auto (locked)
          </button>
        </div>
      </section>

      <details className="gm-at-advanced" data-testid="autotrade-advanced">
        <summary>Advanced diagnostics</summary>
        <div className="gm-at-advanced-body">
          <p className="gm-meta">
            Secrets and full account numbers are never shown. Selected account environment comes
            from your authorised broker account, not a browser invent.
          </p>
          <ul className="gm-meta">
            <li>
              Selected mode: {mode === "live" ? "Live" : "Demo"} · Order submission: locked
            </li>
            <li>
              Credentials configured:{" "}
              {diagnostics?.credentialsConfigured || centre?.readiness?.oauthConfigured
                ? "yes"
                : "unknown / missing"}
            </li>
            <li>Pepperstone confirmed: {diagnostics?.pepperstoneConfirmed ? "yes" : "not yet"}</li>
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
        <summary>Other brokers (not part of the cTrader journey)</summary>
        <div className="gm-autotrade-broker-grid" data-testid="autotrade-broker-selection">
          <button
            type="button"
            className={`gm-autotrade-broker-card${
              selectedBroker === "PEPPERSTONE_CTRADER" ? " is-active" : ""
            }`}
            disabled={busy}
            onClick={() => selectBroker("PEPPERSTONE_CTRADER")}
          >
            <strong>Pepperstone cTrader</strong>
            <span>Primary path · Demo or Live · AutoTrade OFF</span>
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
