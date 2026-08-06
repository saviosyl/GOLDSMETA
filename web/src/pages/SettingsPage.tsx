import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  ChevronRight,
  HelpCircle,
  LogOut,
  Monitor,
  Scale,
  Shield,
  Target,
  UserRound
} from "lucide-react";
import { useAuth } from "../lib/auth";
import type { BackendSettings, ManualRiskSettings, TradingViewConnection } from "../types/models";
import {
  getNotificationPermission,
  isProbablyInstalledPwa,
  isWebPushSupported,
  subscribeWebPush,
  unsubscribeWebPush
} from "../lib/push";
import { cacheKeys, saveCache } from "../lib/offlineCache";
import { formatWhen } from "../lib/format";
import { formatClientError } from "../lib/errors";
import { AdminMarketFeedStatus } from "../components/decision/AdminMarketFeedStatus";
import {
  detectBrowserTimezone,
  loadTimezonePreference,
  saveTimezonePreference,
  type TimezonePreference
} from "../lib/timezone";
import {
  loadAlertPrefs,
  loadTradingHours,
  saveAlertPrefs,
  saveTradingHours,
  type AlertPrefs,
  type TradingHoursPreference
} from "../lib/overnight";

const connectionUrl = (conn: TradingViewConnection): string =>
  conn.webhookURL ?? conn.webhookUrl ?? "";

const isActiveConnection = (conn: TradingViewConnection): boolean =>
  String(conn.status).toUpperCase() === "ACTIVE";

type NotificationUx = {
  headline: string;
  detail: string;
  canEnable: boolean;
  canUnsubscribe: boolean;
  enableReason?: string;
};

const isIosDevice = (): boolean =>
  typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);

const notificationUx = (
  pushStatus: NotificationPermission | "default" | "denied" | "granted" | string,
  installed: boolean,
  pushSupported: boolean,
  online: boolean
): NotificationUx => {
  if (!online) {
    return {
      headline: "Offline",
      detail: "Reconnect to change notification settings.",
      canEnable: false,
      canUnsubscribe: false,
      enableReason: "You are offline."
    };
  }
  if (!pushSupported) {
    return {
      headline: "Unavailable in this browser",
      detail: "Web Push is not supported here. On iPhone, install GoldMeta to the Home Screen first.",
      canEnable: false,
      canUnsubscribe: false,
      enableReason: "Web Push is unavailable in this browser."
    };
  }
  if (isIosDevice() && !installed) {
    return {
      headline: "Install required on iPhone",
      detail:
        "Safari only delivers Web Push for Home Screen apps. Use Share → Add to Home Screen, then enable notifications.",
      canEnable: false,
      canUnsubscribe: false,
      enableReason: "Install the PWA to the Home Screen first."
    };
  }
  if (pushStatus === "denied") {
    return {
      headline: "Blocked by the browser",
      detail: "Notifications were denied. Enable them in system / Safari settings, then try again.",
      canEnable: false,
      canUnsubscribe: true,
      enableReason: "Browser permission is denied."
    };
  }
  if (pushStatus === "granted") {
    return {
      headline: "Enabled on this device",
      detail: "This browser can receive GoldMeta decision alerts when the server flag is on.",
      canEnable: false,
      canUnsubscribe: true,
      enableReason: "Already enabled."
    };
  }
  return {
    headline: "Ready to enable",
    detail: "Permission is requested only after you tap Enable Web Push.",
    canEnable: true,
    canUnsubscribe: false
  };
};

export function SettingsPage() {
  const { api, signOut, user, account } = useAuth();
  const [settings, setSettings] = useState<BackendSettings | null>(null);
  const [connections, setConnections] = useState<TradingViewConnection[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState(getNotificationPermission());
  const [busy, setBusy] = useState(false);
  const [createdWebhookUrl, setCreatedWebhookUrl] = useState<string | null>(null);
  const [tzPref, setTzPref] = useState<TimezonePreference>(() => loadTimezonePreference());
  const [hoursPref, setHoursPref] = useState<TradingHoursPreference>(() => loadTradingHours());
  const [alertPrefs, setAlertPrefs] = useState<AlertPrefs>(() => loadAlertPrefs());
  const browserTz = detectBrowserTimezone();
  const [revealedWebhooks, setRevealedWebhooks] = useState<Record<string, boolean>>({});
  const [settingsTab, setSettingsTab] = useState("account");
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  const installed = isProbablyInstalledPwa();
  const pushSupported = isWebPushSupported();
  const isStaff = account?.role === "OWNER" || account?.role === "ADMIN";
  const notif = useMemo(
    () => notificationUx(pushStatus, installed, pushSupported, online),
    [pushStatus, installed, pushSupported, online]
  );

  const reload = async () => {
    const [nextSettings, nextConnections] = await Promise.all([
      api.getSettings(),
      isStaff ? api.listTradingViewConnections() : Promise.resolve([])
    ]);
    setSettings(nextSettings);
    setConnections(nextConnections);
    saveCache(cacheKeys.settings, nextSettings);
  };

  useEffect(() => {
    void reload().catch((err) => setError(formatClientError(err, "Failed to load settings")));
  }, [api, isStaff]);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const toggleNotifications = async () => {
    if (!settings || !online) return;
    setBusy(true);
    try {
      const updated = await api.updateSettings({
        notificationsEnabled: !settings.notificationsEnabled
      });
      setSettings(updated);
      setMessage(
        updated.notificationsEnabled
          ? "Server notifications turned on."
          : "Server notifications turned off."
      );
    } catch (err) {
      setError(formatClientError(err, "Failed to update settings"));
    } finally {
      setBusy(false);
    }
  };

  const createConnection = async () => {
    if (!online) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.createTradingViewConnection();
      const webhook =
        result.webhookUrl ?? result.connection.webhookURL ?? result.connection.webhookUrl ?? null;
      setCreatedWebhookUrl(webhook);
      setMessage(
        webhook
          ? "TradingView connection created. Copy the webhook URL into TradingView."
          : "TradingView connection created."
      );
      await reload();
    } catch (err) {
      setError(formatClientError(err, "Failed to create TradingView connection"));
    } finally {
      setBusy(false);
    }
  };

  const copyWebhook = async (url: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Webhook URL copied.");
      setError(null);
    } catch {
      setError("Could not copy webhook URL. Long-press the URL to copy manually.");
    }
  };

  const revokeConnection = async (conn: TradingViewConnection) => {
    if (!online || !isActiveConnection(conn)) return;
    const webhookId = conn.webhookId ?? conn.id;
    const confirmed = window.confirm(
      "Revoke this TradingView connection? Alerts using this webhook URL will stop working."
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.revokeTradingViewConnection(webhookId);
      if (createdWebhookUrl && createdWebhookUrl.includes(webhookId)) {
        setCreatedWebhookUrl(null);
      }
      setMessage("TradingView connection revoked.");
      await reload();
    } catch (err) {
      setError(formatClientError(err, "Failed to revoke TradingView connection"));
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    if (!online) return;
    setBusy(true);
    setError(null);
    try {
      const active = connections.find(isActiveConnection);
      const result = await api.sendTestAlert(active?.id);
      setMessage(result.message || "Test alert queued.");
    } catch (err) {
      setError(formatClientError(err, "Test alert failed"));
    } finally {
      setBusy(false);
    }
  };

  const enablePush = async () => {
    if (!notif.canEnable) return;
    setBusy(true);
    setError(null);
    try {
      const result = await subscribeWebPush(api);
      setPushStatus(getNotificationPermission());
      setMessage(result.message);
      if (result.status === "subscribed" && settings && !settings.notificationsEnabled) {
        const updated = await api.updateSettings({ notificationsEnabled: true });
        setSettings(updated);
      }
    } catch (err) {
      setError(formatClientError(err, "Push registration failed"));
    } finally {
      setBusy(false);
    }
  };

  const disablePush = async () => {
    if (!notif.canUnsubscribe) return;
    setBusy(true);
    try {
      await unsubscribeWebPush(api);
      setPushStatus(getNotificationPermission());
      setMessage("Unsubscribed from Web Push for this browser.");
    } catch (err) {
      setError(formatClientError(err, "Unsubscribe failed"));
    } finally {
      setBusy(false);
    }
  };

  const activeCount = connections.filter(isActiveConnection).length;

  const saveManualRisk = async (patch: Partial<ManualRiskSettings>) => {
    if (!settings || !online) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateSettings({ manualRisk: patch });
      setSettings(updated);
      setMessage("Manual risk limits updated (change logged).");
    } catch (err) {
      setError(formatClientError(err, "Failed to update risk limits"));
    } finally {
      setBusy(false);
    }
  };

  const SETTINGS_TABS = [
    { id: "account", label: "Account" },
    { id: "notifications", label: "Notifications" },
    ...(isStaff ? [{ id: "tradingview", label: "TradingView" }] : []),
    { id: "risk", label: "Risk preferences" },
    { id: "timezone", label: "Timezone" },
    { id: "appearance", label: "Appearance" },
    { id: "installation", label: "Installation" },
    { id: "advanced", label: "Advanced" }
  ];

  const MORE_NAV: Array<{
    id: string;
    label: string;
    icon: typeof UserRound;
    tab?: string;
    href?: string;
    action?: "signout";
  }> = [
    { id: "profile", label: "Profile", icon: UserRound, tab: "account" },
    { id: "notifications", label: "Notifications", icon: Bell, tab: "notifications" },
    { id: "display", label: "Display", icon: Monitor, tab: "appearance" },
    { id: "risk", label: "Risk", icon: Target, tab: "risk" },
    { id: "security", label: "Security", icon: Shield, tab: "advanced" },
    { id: "help", label: "Help", icon: HelpCircle, href: "/help" },
    { id: "legal", label: "Legal", icon: Scale, href: "/legal/terms" },
    { id: "signout", label: "Sign out", icon: LogOut, action: "signout" }
  ];

  return (
    <div className="settings-page gm-premium-v2" data-testid="settings-page">
      <h1 className="gm-page-title">Settings</h1>
      <p className="gm-meta" style={{ marginBottom: 16 }}>
        Grouped preferences. Webhook URLs stay hidden until you reveal them.
      </p>
      {message && (
        <div className="banner" role="status">
          {message}
        </div>
      )}
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      <section
        className="gm-card-v2 gm-settings-more-nav"
        data-testid="settings-more-nav"
        aria-label="More / Settings"
      >
        <h2 className="gm-section-title">More / Settings</h2>
        <nav className="gm-settings-nav-list">
          {MORE_NAV.map((item) => {
            const Icon = item.icon;
            if (item.href) {
              return (
                <Link key={item.id} to={item.href} className="gm-settings-nav-item">
                  <Icon size={18} aria-hidden />
                  <span>{item.label}</span>
                  <ChevronRight className="gm-chevron" size={18} aria-hidden />
                </Link>
              );
            }
            if (item.action === "signout") {
              return (
                <button
                  key={item.id}
                  type="button"
                  className="gm-settings-nav-item"
                  onClick={() => void signOut()}
                >
                  <Icon size={18} aria-hidden />
                  <span>{item.label}</span>
                  <ChevronRight className="gm-chevron" size={18} aria-hidden />
                </button>
              );
            }
            return (
              <button
                key={item.id}
                type="button"
                className={`gm-settings-nav-item${settingsTab === item.tab ? " active" : ""}`}
                onClick={() => {
                  if (item.tab) {
                    setSettingsTab(item.tab);
                    document.getElementById(`settings-${item.tab}`)?.scrollIntoView({
                      behavior: "smooth",
                      block: "start"
                    });
                  }
                }}
              >
                <Icon size={18} aria-hidden />
                <span>{item.label}</span>
                <ChevronRight className="gm-chevron" size={18} aria-hidden />
              </button>
            );
          })}
        </nav>
      </section>

      <div className="gm-tabs" role="tablist" aria-label="Settings sections" data-testid="settings-tabs">
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={settingsTab === t.id}
            className={settingsTab === t.id ? "active" : undefined}
            onClick={() => setSettingsTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {settingsTab === "account" && (
        <div className="card settings-card" id="settings-account">
          <h2>Account</h2>
          <p className="settings-email" data-testid="account-email">
            {user?.email ?? "Signed in"}
          </p>
          <p className="settings-meta" data-testid="connection-status">
            <span className={`status-dot ${online ? "online" : "offline"}`} aria-hidden />
            {online ? "Connected" : "Offline"}
            {settings ? " · session ready" : ""}
          </p>
          <button type="button" className="btn danger block" onClick={() => void signOut()}>
            Sign out
          </button>
          <p className="settings-meta" style={{ marginTop: 12 }}>
            <a href="/account/delete-request" data-testid="request-deletion-link">
              Request account deletion
            </a>
          </p>
          {!isStaff && (
            <p className="settings-meta" data-testid="centrally-managed-feed-settings">
              GoldMeta's market feed is centrally managed. No TradingView setup is required.
            </p>
          )}
        </div>
      )}

      {settingsTab === "notifications" && (
        <div className="card settings-card" id="settings-notifications">
          <h2>Notifications</h2>
          <p className="settings-status-headline" data-testid="notif-headline">
            {notif.headline}
          </p>
          <p className="muted settings-help">{notif.detail}</p>
          <p className="settings-meta">
            Server alerts:{" "}
            <strong>{settings?.notificationsEnabled ? "on" : "off"}</strong>
          </p>
          <div className="btn-stack">
            <button
              type="button"
              className="btn primary"
              disabled={busy || !notif.canEnable}
              title={notif.enableReason}
              onClick={() => void enablePush()}
            >
              Enable Web Push
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || !notif.canUnsubscribe}
              onClick={() => void disablePush()}
            >
              Unsubscribe
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || !settings || !online}
              onClick={() => void toggleNotifications()}
            >
              {settings?.notificationsEnabled ? "Turn server alerts off" : "Turn server alerts on"}
            </button>
          </div>
          {!notif.canEnable && notif.enableReason && (
            <p className="muted settings-help" data-testid="notif-enable-hint">
              Enable Web Push: {notif.enableReason}
            </p>
          )}

          <h3 style={{ marginTop: 24 }}>Alert priorities</h3>
          <p className="muted settings-help">
            Analysis and SHADOW alerts only — never BUY NOW / SELL NOW execution prompts. Ordinary
            WAIT updates stay quiet by default.
          </p>
          <div className="gm-alert-prefs" data-testid="alert-prefs">
            {(
              [
                ["validatedShadowPlan", "Validated shadow plan"],
                ["highQualityOnly", "High-quality setup only"],
                ["planWeakening", "Plan weakening"],
                ["planConflict", "Plan conflict"],
                ["planResolved", "Plan resolved"],
                ["overnightSummary", "Overnight summary"],
                ["candidateForming", "Candidate forming"],
                ["allAnalysis", "All analysis updates"]
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="gm-check-row">
                <input
                  type="checkbox"
                  checked={alertPrefs[key]}
                  onChange={(e) => {
                    const next = { ...alertPrefs, [key]: e.target.checked };
                    setAlertPrefs(next);
                    saveAlertPrefs(next);
                  }}
                />
                {label}
              </label>
            ))}
            <label className="gm-check-row">
              <input
                type="checkbox"
                checked={alertPrefs.quietHoursEnabled}
                onChange={(e) => {
                  const next = { ...alertPrefs, quietHoursEnabled: e.target.checked };
                  setAlertPrefs(next);
                  saveAlertPrefs(next);
                }}
              />
              Quiet hours
            </label>
            {alertPrefs.quietHoursEnabled && (
              <div className="gm-inline-fields">
                <label>
                  From
                  <input
                    type="time"
                    value={alertPrefs.quietStart}
                    onChange={(e) => {
                      const next = { ...alertPrefs, quietStart: e.target.value };
                      setAlertPrefs(next);
                      saveAlertPrefs(next);
                    }}
                  />
                </label>
                <label>
                  To
                  <input
                    type="time"
                    value={alertPrefs.quietEnd}
                    onChange={(e) => {
                      const next = { ...alertPrefs, quietEnd: e.target.value };
                      setAlertPrefs(next);
                      saveAlertPrefs(next);
                    }}
                  />
                </label>
              </div>
            )}
            <label className="gm-check-row">
              <input
                type="checkbox"
                checked={alertPrefs.urgentHighQuality}
                onChange={(e) => {
                  const next = { ...alertPrefs, urgentHighQuality: e.target.checked };
                  setAlertPrefs(next);
                  saveAlertPrefs(next);
                }}
              />
              Urgent high-quality shadow alert (off by default — not a profit guarantee)
            </label>
          </div>
        </div>
      )}

      {settingsTab === "tradingview" && (
        <div className="card settings-card">
          <AdminMarketFeedStatus />
          <h2>TradingView connection</h2>
          <p className="muted settings-help">
            New users start on <strong>GoldMeta Standard Setup</strong>. Open the guided wizard for
            your private webhook and alert message.
          </p>
          <p>
            <Link className="gm-btn gm-btn-primary" to="/tradingview">
              Open TradingView setup wizard
            </Link>
          </p>
          <p className="muted settings-help">
            {activeCount === 0
              ? "No active webhook yet. Create one connection and paste its URL into TradingView."
              : activeCount === 1
                ? "One active webhook. Keep only one URL in your TradingView alert."
                : `${activeCount} active webhooks. Revoke unused ones so only one is live.`}
          </p>
          {connections.length === 0 ? (
            <p className="muted">No connections yet.</p>
          ) : (
            <ul className="connection-list">
              {connections.map((conn) => {
                const active = isActiveConnection(conn);
                const url = connectionUrl(conn);
                const webhookId = conn.webhookId ?? conn.id;
                const revealed = Boolean(revealedWebhooks[conn.id]);
                return (
                  <li key={conn.id} className="connection-item" data-testid={`connection-${conn.id}`}>
                    <div className="connection-item-header">
                      <span
                        className={`connection-status ${active ? "active" : "revoked"}`}
                        data-testid={`connection-status-${conn.id}`}
                      >
                        {String(conn.status).toUpperCase()}
                      </span>
                      <span className="connection-id url-break">ID ···{webhookId.slice(-6)}</span>
                    </div>
                    <div
                      className="connection-url url-break"
                      data-testid={`connection-url-${conn.id}`}
                    >
                      {url
                        ? revealed
                          ? url
                          : `${url.slice(0, 28)}… (hidden)`
                        : "URL hidden"}
                    </div>
                    <div className="muted connection-meta">Last alert {formatWhen(conn.lastAlertAt)}</div>
                    <div className="connection-actions">
                      {url && (
                        <button
                          type="button"
                          className="btn"
                          onClick={() =>
                            setRevealedWebhooks((prev) => ({
                              ...prev,
                              [conn.id]: !prev[conn.id]
                            }))
                          }
                        >
                          {revealed ? "Hide webhook" : "Reveal webhook"}
                        </button>
                      )}
                      {url && (
                        <button
                          type="button"
                          className="btn connection-copy"
                          disabled={busy}
                          onClick={() => void copyWebhook(url)}
                        >
                          Copy webhook
                        </button>
                      )}
                      {active && (
                        <button
                          type="button"
                          className="btn danger connection-revoke"
                          disabled={busy || !online}
                          onClick={() => void revokeConnection(conn)}
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {createdWebhookUrl && (
            <div className="created-webhook">
              <p className="muted">New webhook URL (copy now)</p>
              <code className="url-break" data-testid="created-webhook-url">
                {createdWebhookUrl}
              </code>
              <button
                type="button"
                className="btn"
                onClick={() => void copyWebhook(createdWebhookUrl)}
              >
                Copy webhook
              </button>
            </div>
          )}
          <div className="btn-stack">
            <button
              type="button"
              className="btn primary"
              disabled={busy || !online}
              onClick={() => void createConnection()}
            >
              Create connection
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || !online || activeCount === 0}
              onClick={() => void sendTest()}
            >
              Send TEST alert
            </button>
          </div>
        </div>
      )}

      {settingsTab === "risk" && (
        <div className="card settings-card" id="settings-risk" data-testid="manual-risk-settings">
          <h2>Risk preferences</h2>
          <p className="muted settings-help">
            Editable safety limits for manual trading. Changes are logged. GoldMeta never places
            broker orders. Use the{" "}
            <a href="/planner">Risk planner</a> for progressive sizing calculations.
          </p>
          {settings?.manualRisk && (
            <div className="form-grid">
              <label className="field">
                <span>Currency</span>
                <select
                  value={settings.manualRisk.currency}
                  disabled={busy || !online}
                  onChange={(e) =>
                    void saveManualRisk({
                      currency: e.target.value as "EUR" | "USD" | "GBP"
                    })
                  }
                >
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                  <option value="GBP">GBP</option>
                </select>
              </label>
              <label className="field">
                <span>Max risk / trade</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={1}
                  defaultValue={settings.manualRisk.maxCashRiskPerTrade}
                  disabled={busy || !online}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v > 0 && v !== settings.manualRisk?.maxCashRiskPerTrade) {
                      void saveManualRisk({ maxCashRiskPerTrade: v });
                    }
                  }}
                />
              </label>
              <label className="field">
                <span>Max daily loss</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={1}
                  defaultValue={settings.manualRisk.maxDailyRealisedLoss}
                  disabled={busy || !online}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v > 0 && v !== settings.manualRisk?.maxDailyRealisedLoss) {
                      void saveManualRisk({ maxDailyRealisedLoss: v });
                    }
                  }}
                />
              </label>
              <label className="field">
                <span>Stop after losses</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  defaultValue={settings.manualRisk.stopAfterConsecutiveLosses}
                  disabled={busy || !online}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v > 0 && v !== settings.manualRisk?.stopAfterConsecutiveLosses) {
                      void saveManualRisk({ stopAfterConsecutiveLosses: v });
                    }
                  }}
                />
              </label>
              <label className="field">
                <span>Max simultaneous</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={5}
                  defaultValue={settings.manualRisk.maxSimultaneousManualTrades}
                  disabled={busy || !online}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v > 0 && v !== settings.manualRisk?.maxSimultaneousManualTrades) {
                      void saveManualRisk({ maxSimultaneousManualTrades: v });
                    }
                  }}
                />
              </label>
              <label className="field">
                <span>Value per point</span>
                <input
                  type="number"
                  inputMode="decimal"
                  defaultValue={settings.manualRisk.valuePerPoint ?? ""}
                  placeholder="from broker"
                  disabled={busy || !online}
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    const v = raw === "" ? null : Number(raw);
                    if (v !== settings.manualRisk?.valuePerPoint) {
                      void saveManualRisk({ valuePerPoint: v });
                    }
                  }}
                />
              </label>
            </div>
          )}
          {(settings?.manualRiskLimitChangeLog?.length ?? 0) > 0 && (
            <details className="change-log">
              <summary>Limit change log</summary>
              <ul className="list">
                {settings!.manualRiskLimitChangeLog!.slice(0, 10).map((c) => (
                  <li key={`${c.at}-${c.field}`}>
                    {c.field}: {String(c.from)} → {String(c.to)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {settingsTab === "timezone" && (
        <div className="card settings-card" data-testid="timezone-settings">
          <h2>Timezone</h2>
          <p className="muted settings-help">
            Backend timestamps stay in UTC. The interface shows your local time first. Ireland
            daylight saving uses Europe/Dublin when selected — never a hard-coded offset.
          </p>
          <label className="gm-field">
            Display timezone
            <select
              value={tzPref.mode === "iana" ? `iana:${tzPref.iana}` : tzPref.mode}
              onChange={(e) => {
                const v = e.target.value;
                let next: TimezonePreference = { mode: "auto" };
                if (v === "utc") next = { mode: "utc" };
                else if (v.startsWith("iana:")) next = { mode: "iana", iana: v.slice(5) };
                setTzPref(next);
                saveTimezonePreference(next);
                setMessage("Timezone preference saved on this device.");
              }}
            >
              <option value="auto">Automatic local ({browserTz})</option>
              <option value="utc">UTC</option>
              <option value="iana:Europe/Dublin">Europe/Dublin</option>
              <option value="iana:Europe/London">Europe/London</option>
              <option value="iana:America/New_York">America/New_York</option>
              <option value="iana:Asia/Dubai">Asia/Dubai</option>
              <option value="iana:Asia/Singapore">Asia/Singapore</option>
            </select>
          </label>

          <h3 style={{ marginTop: 24 }}>Preferred trading hours</h3>
          <p className="muted settings-help">
            Affects alert preference and overnight summaries only. V4 continues collecting full
            24-hour shadow evidence.
          </p>
          <label className="gm-field">
            Hours
            <select
              value={hoursPref.mode}
              onChange={(e) => {
                const next = {
                  ...hoursPref,
                  mode: e.target.value as TradingHoursPreference["mode"]
                };
                setHoursPref(next);
                saveTradingHours(next);
              }}
            >
              <option value="24h">24 hours</option>
              <option value="london">London session</option>
              <option value="newyork">New York session</option>
              <option value="london_ny">London + New York</option>
              <option value="asia">Asia session</option>
              <option value="custom">Custom schedule</option>
            </select>
          </label>
          {hoursPref.mode === "custom" && (
            <div className="gm-inline-fields">
              <label>
                Start
                <input
                  type="time"
                  value={hoursPref.customStart ?? "08:00"}
                  onChange={(e) => {
                    const next = { ...hoursPref, customStart: e.target.value };
                    setHoursPref(next);
                    saveTradingHours(next);
                  }}
                />
              </label>
              <label>
                End
                <input
                  type="time"
                  value={hoursPref.customEnd ?? "17:00"}
                  onChange={(e) => {
                    const next = { ...hoursPref, customEnd: e.target.value };
                    setHoursPref(next);
                    saveTradingHours(next);
                  }}
                />
              </label>
            </div>
          )}
        </div>
      )}

      {settingsTab === "appearance" && (
        <div className="card settings-card" id="settings-appearance">
          <h2>Appearance</h2>
          <p className="muted settings-help">
            GoldMeta uses the approved navy + gold light theme. Brand assets use the official logo.
          </p>
        </div>
      )}

      {settingsTab === "installation" && (
        <div className="card settings-card">
          <h2>Install / offline</h2>
          <p className="muted settings-help">
            On iPhone: open in Safari → Share → Add to Home Screen. GoldMeta does not install
            automatically. Cached decisions are marked stale when you are offline.
          </p>
          <p className="settings-meta">
            Home Screen app: <strong>{installed ? "yes" : "not detected"}</strong>
          </p>
        </div>
      )}

      {settingsTab === "advanced" && (
        <div className="card settings-card" id="settings-advanced">
          <h2>Advanced</h2>
          <p className="muted settings-help">
            Diagnostics are available only to operators with the admin claim. Broker mode remains
            disabled. V4 remains SHADOW only.
          </p>
          <a className="gm-linkish" href="/diagnostics">
            Open diagnostics
          </a>
          <p className="settings-meta" style={{ marginTop: 12 }}>
            BROKER_MODE: DISABLED · V4: SHADOW · AI_ENABLED: false
          </p>
        </div>
      )}
    </div>
  );
}
