import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../lib/auth";
import type { BackendSettings, TradingViewConnection } from "../types/models";
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
  const { api, signOut, user } = useAuth();
  const [settings, setSettings] = useState<BackendSettings | null>(null);
  const [connections, setConnections] = useState<TradingViewConnection[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState(getNotificationPermission());
  const [busy, setBusy] = useState(false);
  const [createdWebhookUrl, setCreatedWebhookUrl] = useState<string | null>(null);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  const installed = isProbablyInstalledPwa();
  const pushSupported = isWebPushSupported();
  const notif = useMemo(
    () => notificationUx(pushStatus, installed, pushSupported, online),
    [pushStatus, installed, pushSupported, online]
  );

  const reload = async () => {
    const [nextSettings, nextConnections] = await Promise.all([
      api.getSettings(),
      api.listTradingViewConnections()
    ]);
    setSettings(nextSettings);
    setConnections(nextConnections);
    saveCache(cacheKeys.settings, nextSettings);
  };

  useEffect(() => {
    void reload().catch((err) => setError(formatClientError(err, "Failed to load settings")));
  }, [api]);

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

  return (
    <div className="settings-page">
      <h1 className="brand" style={{ fontSize: "1.4rem" }}>
        Settings
      </h1>
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

      <div className="card settings-card">
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
      </div>

      <div className="card settings-card">
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
      </div>

      <div className="card settings-card">
        <h2>TradingView connection</h2>
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
                  <div className="connection-url url-break" data-testid={`connection-url-${conn.id}`}>
                    {url || "URL hidden"}
                  </div>
                  <div className="muted connection-meta">Last alert {formatWhen(conn.lastAlertAt)}</div>
                  <div className="connection-actions">
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
            <p className="muted">New webhook URL</p>
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
    </div>
  );
}
