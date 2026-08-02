import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { friendlyBrokerReason } from "../lib/brokerFriendlyCopy";

type SetupMode = "standard" | "custom";

type SetupResponse = {
  setup: {
    templateMode: SetupMode;
    templateId: string;
    templateVersion: string;
    connectionStatus: string;
    setupLabel: string;
    selectedSymbolAlias: string;
    selectedTimeframes: string[];
    lastSignalAt: string | null;
    lastValidSignalAt: string | null;
    lastRejectedSignalAt: string | null;
    lastRejectReason: string | null;
    hasWebhook: boolean;
    webhookIdMasked: string | null;
  };
  template: {
    id: string;
    name: string;
    description: string;
    recommended?: boolean;
    supportedTimeframes: Array<{ value: string; label: string }>;
    symbolAliases: Record<string, string>;
    instructions: string[];
    releaseNotes?: string;
  };
  webhookUrl: string | null;
  alertGuide: {
    alertName: string;
    messageBody: string;
    pineReminder: string;
  };
};

const SYMBOL_OPTIONS = [
  "XAUUSD",
  "OANDA:XAUUSD",
  "FOREXCOM:XAUUSD",
  "PEPPERSTONE:XAUUSD",
  "CAPITALCOM:GOLD"
];

function statusLabel(status: string): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "waiting_for_alert":
      return "Waiting for TradingView alert";
    case "error":
      return "Needs attention";
    default:
      return "Not connected";
  }
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Easy TradingView setup for every verified user.
 * Standard template by default; optional custom mapping; private webhook per user.
 */
export function TradingViewSetupPage() {
  const { api } = useAuth();
  const [data, setData] = useState<SetupResponse | null>(null);
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<SetupMode>("standard");
  const [symbol, setSymbol] = useState("XAUUSD");
  const [timeframes, setTimeframes] = useState<string[]>(["15"]);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [oneTimeSecret, setOneTimeSecret] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customTvField, setCustomTvField] = useState("trend_value");
  const [customGmField, setCustomGmField] = useState("trendMeter");

  const load = useCallback(async () => {
    try {
      const res = (await api.getTradingViewSetup()) as SetupResponse;
      setData(res);
      setMode(res.setup.templateMode);
      setSymbol(res.setup.selectedSymbolAlias || "XAUUSD");
      setTimeframes(res.setup.selectedTimeframes?.length ? res.setup.selectedTimeframes : ["15"]);
      setWebhookUrl(res.webhookUrl);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load TradingView setup");
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const createWebhook = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = (await api.createTradingViewConnection()) as {
        webhookUrl?: string;
        secret?: string;
        connection?: { webhookURL?: string; webhookUrl?: string; payloadSecret?: string };
      };
      const url =
        res.webhookUrl ?? res.connection?.webhookURL ?? res.connection?.webhookUrl ?? null;
      setWebhookUrl(url);
      setOneTimeSecret(res.secret ?? res.connection?.payloadSecret ?? null);
      setMessage("Private webhook created. Copy it now — the secret is shown only once.");
      await load();
      setStep(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create webhook");
    } finally {
      setBusy(false);
    }
  };

  const savePrefs = async () => {
    setBusy(true);
    try {
      await api.updateTradingViewSetup({
        templateMode: mode,
        selectedSymbolAlias: symbol,
        selectedTimeframes: timeframes
      });
      setMessage("Setup preferences saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save setup");
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.sendTestAlert();
      setMessage("Test alert accepted. Check Dashboard or History for the TEST decision.");
      await load();
      setStep(7);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test alert failed");
    } finally {
      setBusy(false);
    }
  };

  const restoreStandard = async () => {
    setBusy(true);
    try {
      await api.restoreTradingViewStandard();
      setMode("standard");
      setMessage("Restored GoldMeta Standard Setup. Your private webhook is unchanged.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not restore standard setup");
    } finally {
      setBusy(false);
    }
  };

  const saveCustomMapping = async () => {
    setBusy(true);
    try {
      await api.saveTradingViewCustomMapping({
        fieldMappings: [
          {
            tradingViewField: customTvField,
            goldMetaField: customGmField,
            required: false
          }
        ],
        staleSignalLimitSeconds: 1800
      });
      setMode("custom");
      setMessage("Custom mapping saved. Server validation still applies.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid custom mapping");
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    const id = data?.setup.webhookIdMasked;
    if (!webhookUrl) return;
    const webhookId = webhookUrl.split("/").pop();
    if (!webhookId) return;
    setBusy(true);
    try {
      const res = await api.rotateTradingViewConnection(webhookId);
      setOneTimeSecret(res.secret ?? null);
      setWebhookUrl(res.webhookUrl ?? webhookUrl);
      setMessage("Webhook secret rotated. Update TradingView if you embed the secret.");
      void id;
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rotate webhook");
    } finally {
      setBusy(false);
    }
  };

  const tfOptions = data?.template.supportedTimeframes ?? [];
  const alertBody = data?.alertGuide.messageBody ?? "{{alert_message}}";

  const connectionLabel = useMemo(
    () => statusLabel(data?.setup.connectionStatus ?? "not_connected"),
    [data?.setup.connectionStatus]
  );

  return (
    <div className="gm-tv-setup" data-testid="tradingview-setup-page">
      <header className="gm-tv-setup-hero">
        <p className="gm-autotrade-kicker">GoldMeta</p>
        <h1 className="gm-page-title">TradingView Setup</h1>
        <p className="gm-meta">
          Use the same standard alert structure as the platform. Your webhook and signals stay
          private to your account.
        </p>
      </header>

      <section className="gm-tv-status-card" data-testid="tv-status-card" aria-label="TradingView status">
        <div>
          <span className="gm-label">TradingView</span>
          <strong>{connectionLabel}</strong>
        </div>
        <div>
          <span className="gm-label">Setup</span>
          <strong>{data?.setup.setupLabel ?? "GoldMeta Standard"}</strong>
        </div>
        <div>
          <span className="gm-label">Symbol</span>
          <strong>{symbol}</strong>
        </div>
        <div>
          <span className="gm-label">Timeframe</span>
          <strong>
            {tfOptions.find((t) => t.value === timeframes[0])?.label ?? `${timeframes[0]} minutes`}
          </strong>
        </div>
        <div>
          <span className="gm-label">Last alert</span>
          <strong>{relativeTime(data?.setup.lastSignalAt ?? null)}</strong>
        </div>
        <div>
          <span className="gm-label">Signal</span>
          <strong>
            {data?.setup.lastValidSignalAt
              ? "Accepted"
              : data?.setup.lastRejectReason
                ? `Rejected · ${friendlyBrokerReason(data.setup.lastRejectReason)}`
                : "—"}
          </strong>
        </div>
      </section>

      {error ? (
        <p className="gm-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p className="gm-meta">{message}</p> : null}

      <div className="gm-tv-actions">
        <button type="button" className="gm-btn gm-btn-primary" onClick={() => setStep(1)}>
          Set up TradingView
        </button>
        <button
          type="button"
          className="gm-btn"
          disabled={!webhookUrl}
          onClick={() => void copyText(webhookUrl ?? "").then((ok) => setMessage(ok ? "Webhook URL copied." : "Copy failed — select the URL manually."))}
        >
          Copy webhook
        </button>
        <button
          type="button"
          className="gm-btn"
          onClick={() => void copyText(alertBody).then((ok) => setMessage(ok ? "Alert message copied." : "Copy failed."))}
        >
          Copy alert message
        </button>
        <button type="button" className="gm-btn" disabled={busy} onClick={() => void sendTest()}>
          Test connection
        </button>
        <button
          type="button"
          className="gm-btn"
          aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          Advanced setup
        </button>
        <Link className="gm-btn" to="/history">
          View signal history
        </Link>
      </div>

      <section className="gm-tv-wizard" data-testid="tv-setup-wizard">
        <h2 className="gm-section-title">Setup wizard · Step {step} of 7</h2>

        {step === 1 ? (
          <div className="gm-tv-step">
            <h3>Choose setup type</h3>
            <label className={`gm-tv-choice${mode === "standard" ? " is-active" : ""}`}>
              <input
                type="radio"
                name="mode"
                checked={mode === "standard"}
                onChange={() => setMode("standard")}
              />
              <span>
                <strong>GoldMeta Standard Setup</strong>
                <em className="gm-tv-badge-recommended" data-testid="tv-recommended-badge">
                  Recommended
                </em>
                <p className="gm-meta">
                  {data?.template.description ??
                    "Use the shared GoldMeta alert format. Fastest way to get started."}
                </p>
              </span>
            </label>
            <label className={`gm-tv-choice${mode === "custom" ? " is-active" : ""}`}>
              <input
                type="radio"
                name="mode"
                checked={mode === "custom"}
                onChange={() => {
                  setMode("custom");
                  setShowAdvanced(true);
                }}
              />
              <span>
                <strong>Custom TradingView Setup</strong>
                <em data-testid="tv-advanced-badge">Advanced</em>
                <p className="gm-meta">
                  Map your own field names. Server validation still applies. Restoring Standard
                  keeps your private webhook.
                </p>
              </span>
            </label>
            <button type="button" className="gm-btn gm-btn-primary" onClick={() => setStep(2)}>
              Continue
            </button>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="gm-tv-step">
            <h3>Select TradingView symbol</h3>
            <label>
              Symbol / alias
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                {SYMBOL_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <div className="gm-tv-step-nav">
              <button type="button" className="gm-btn" onClick={() => setStep(1)}>
                Back
              </button>
              <button
                type="button"
                className="gm-btn gm-btn-primary"
                onClick={() => {
                  void savePrefs();
                  setStep(3);
                }}
              >
                Continue
              </button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="gm-tv-step">
            <h3>Select timeframe</h3>
            <div className="gm-tv-tf-grid">
              {tfOptions.map((tf) => {
                const on = timeframes.includes(tf.value);
                return (
                  <button
                    key={tf.value}
                    type="button"
                    className={`gm-btn${on ? " is-active" : ""}`}
                    onClick={() =>
                      setTimeframes((prev) =>
                        prev.includes(tf.value)
                          ? prev.filter((x) => x !== tf.value)
                          : [...prev, tf.value]
                      )
                    }
                  >
                    {tf.label}
                  </button>
                );
              })}
            </div>
            <div className="gm-tv-step-nav">
              <button type="button" className="gm-btn" onClick={() => setStep(2)}>
                Back
              </button>
              <button
                type="button"
                className="gm-btn gm-btn-primary"
                onClick={() => {
                  void savePrefs();
                  setStep(4);
                }}
              >
                Continue
              </button>
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="gm-tv-step">
            <h3>Copy private webhook URL</h3>
            <p className="gm-meta">
              This URL is only for your account. Never share it. It is not the admin webhook.
            </p>
            {!webhookUrl ? (
              <button
                type="button"
                className="gm-btn gm-btn-primary"
                disabled={busy}
                onClick={() => void createWebhook()}
              >
                Create private webhook
              </button>
            ) : (
              <>
                <code className="gm-tv-url" data-testid="tv-webhook-url">
                  {webhookUrl}
                </code>
                <button
                  type="button"
                  className="gm-btn gm-btn-primary"
                  onClick={() =>
                    void copyText(webhookUrl).then((ok) =>
                      setMessage(ok ? "Webhook URL copied." : "Copy failed.")
                    )
                  }
                >
                  Copy webhook URL
                </button>
                {oneTimeSecret ? (
                  <p className="gm-meta">
                    One-time secret (optional in alert body): <code>{oneTimeSecret}</code>
                  </p>
                ) : null}
              </>
            )}
            <div className="gm-tv-step-nav">
              <button type="button" className="gm-btn" onClick={() => setStep(3)}>
                Back
              </button>
              <button
                type="button"
                className="gm-btn gm-btn-primary"
                disabled={!webhookUrl}
                onClick={() => setStep(5)}
              >
                Continue
              </button>
            </div>
          </div>
        ) : null}

        {step === 5 ? (
          <div className="gm-tv-step">
            <h3>Copy standard alert message</h3>
            <p className="gm-meta">{data?.alertGuide.pineReminder}</p>
            <label>
              Alert name
              <input readOnly value={data?.alertGuide.alertName ?? "GoldMeta XAUUSD 15"} />
            </label>
            <label>
              Alert message
              <textarea
                readOnly
                rows={3}
                value={alertBody}
                data-testid="tv-alert-message"
                className="gm-tv-alert-editor"
              />
            </label>
            <button
              type="button"
              className="gm-btn gm-btn-primary"
              onClick={() =>
                void copyText(alertBody).then((ok) =>
                  setMessage(ok ? "Alert message copied." : "Copy failed.")
                )
              }
            >
              Copy alert message
            </button>
            <div className="gm-tv-step-nav">
              <button type="button" className="gm-btn" onClick={() => setStep(4)}>
                Back
              </button>
              <button type="button" className="gm-btn gm-btn-primary" onClick={() => setStep(6)}>
                Continue
              </button>
            </div>
          </div>
        ) : null}

        {step === 6 ? (
          <div className="gm-tv-step">
            <h3>Test connection</h3>
            <p className="gm-meta">
              Sends a safe TEST alert into your own decision engine. AutoTrade stays OFF. No broker
              order is submitted.
            </p>
            <button
              type="button"
              className="gm-btn gm-btn-primary"
              disabled={busy}
              onClick={() => void sendTest()}
            >
              Send test alert
            </button>
            <div className="gm-tv-step-nav">
              <button type="button" className="gm-btn" onClick={() => setStep(5)}>
                Back
              </button>
              <button type="button" className="gm-btn" onClick={() => setStep(7)}>
                Skip to status
              </button>
            </div>
          </div>
        ) : null}

        {step === 7 ? (
          <div className="gm-tv-step" data-testid="tv-confirm-signal">
            <h3>Confirm first valid signal</h3>
            <ul className="gm-meta">
              <li>Status: {connectionLabel}</li>
              <li>Last alert received: {relativeTime(data?.setup.lastSignalAt ?? null)}</li>
              <li>
                Signal:{" "}
                {data?.setup.lastValidSignalAt
                  ? "Accepted"
                  : data?.setup.lastRejectReason
                    ? `Rejected — ${friendlyBrokerReason(data.setup.lastRejectReason)}`
                    : "Waiting for TradingView alert"}
              </li>
            </ul>
            <Link className="gm-btn gm-btn-primary" to="/">
              Open Dashboard
            </Link>
          </div>
        ) : null}
      </section>

      {showAdvanced || mode === "custom" ? (
        <section className="gm-tv-advanced" data-testid="tv-advanced-mapping">
          <h2 className="gm-section-title">Advanced · custom mapping</h2>
          <p className="gm-meta">
            For experienced users. Restoring Standard does not delete your private webhook.
            Template upgrades never overwrite a custom setup.
          </p>
          <div className="gm-tv-map-row">
            <label>
              TradingView field
              <input value={customTvField} onChange={(e) => setCustomTvField(e.target.value)} />
            </label>
            <span aria-hidden>→</span>
            <label>
              GoldMeta field
              <select value={customGmField} onChange={(e) => setCustomGmField(e.target.value)}>
                <option value="trendMeter">Trend Meter</option>
                <option value="confirmationCandle">Confirmation Candle</option>
                <option value="poc">POC</option>
                <option value="vah">VAH</option>
                <option value="val">VAL</option>
                <option value="atr">ATR</option>
                <option value="rsi">RSI</option>
                <option value="vwap">VWAP</option>
                <option value="confidence">Confidence</option>
              </select>
            </label>
          </div>
          <div className="gm-tv-actions">
            <button type="button" className="gm-btn" disabled={busy} onClick={() => void saveCustomMapping()}>
              Validate mapping
            </button>
            <button type="button" className="gm-btn" disabled={busy} onClick={() => void sendTest()}>
              Send test payload
            </button>
            <button type="button" className="gm-btn" disabled={busy} onClick={() => void restoreStandard()}>
              Use standard setup
            </button>
            <button type="button" className="gm-btn" disabled={busy || !webhookUrl} onClick={() => void rotate()}>
              Rotate webhook
            </button>
          </div>
        </section>
      ) : null}

      <p className="gm-meta gm-at-locked-note">
        AutoTrade remains OFF. Order submission stays disabled. Signals feed only your analysis.
      </p>
    </div>
  );
}
