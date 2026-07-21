import { useEffect, useState } from "react";
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

export function SettingsPage() {
  const { api, signOut, apiBaseUrl, user } = useAuth();
  const [settings, setSettings] = useState<BackendSettings | null>(null);
  const [connections, setConnections] = useState<TradingViewConnection[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState(getNotificationPermission());
  const [busy, setBusy] = useState(false);
  const [createdWebhookUrl, setCreatedWebhookUrl] = useState<string | null>(null);

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

  const toggleNotifications = async () => {
    if (!settings || !navigator.onLine) return;
    setBusy(true);
    try {
      const updated = await api.updateSettings({
        notificationsEnabled: !settings.notificationsEnabled
      });
      setSettings(updated);
      setMessage("Settings saved.");
    } catch (err) {
      setError(formatClientError(err, "Failed to update settings"));
    } finally {
      setBusy(false);
    }
  };

  const createConnection = async () => {
    if (!navigator.onLine) return;
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
          ? "TradingView connection created. Copy the webhook URL below into TradingView."
          : "TradingView connection created."
      );
      await reload();
    } catch (err) {
      setError(formatClientError(err, "Failed to create TradingView connection"));
    } finally {
      setBusy(false);
    }
  };

  const revokeConnection = async (conn: TradingViewConnection) => {
    if (!navigator.onLine || !isActiveConnection(conn)) return;
    const webhookId = conn.webhookId ?? conn.id;
    const confirmed = window.confirm(
      `Revoke TradingView connection ${webhookId}? Alerts using this webhook URL will stop working.`
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
    if (!navigator.onLine) return;
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
        <p className="settings-meta">{user?.email}</p>
        <p className="settings-meta">
          <span className="settings-meta-label">API</span>
          <span className="url-break" data-testid="api-base-url">
            {apiBaseUrl}
          </span>
        </p>
        <button type="button" className="btn danger block" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>

      <div className="card settings-card">
        <h2>Notifications</h2>
        <p className="muted settings-help">
          Permission is requested only after you tap Enable. On iPhone, Web Push works for Home
          Screen-installed PWAs on compatible iOS versions — not verified until tested on a real
          device.
        </p>
        <dl className="settings-status-list">
          <div className="settings-status-row">
            <dt>Browser permission</dt>
            <dd>
              <strong>{pushStatus}</strong>
            </dd>
          </div>
          <div className="settings-status-row">
            <dt>Installed PWA heuristic</dt>
            <dd>
              <strong>{isProbablyInstalledPwa() ? "yes" : "no"}</strong>
            </dd>
          </div>
          <div className="settings-status-row">
            <dt>Web Push API</dt>
            <dd>
              <strong>{isWebPushSupported() ? "available" : "unavailable"}</strong>
            </dd>
          </div>
          <div className="settings-status-row">
            <dt>Backend notifications flag</dt>
            <dd>
              <strong>{settings?.notificationsEnabled ? "on" : "off"}</strong>
            </dd>
          </div>
        </dl>
        <div className="btn-stack">
          <button
            type="button"
            className="btn primary"
            disabled={busy || !navigator.onLine}
            onClick={() => void enablePush()}
          >
            Enable Web Push
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void disablePush()}>
            Unsubscribe
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !settings}
            onClick={() => void toggleNotifications()}
          >
            Toggle server flag
          </button>
        </div>
      </div>

      <div className="card settings-card">
        <h2>TradingView connection</h2>
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
                    <span className="connection-id url-break">{webhookId}</span>
                  </div>
                  <div className="connection-url url-break" data-testid={`connection-url-${conn.id}`}>
                    {url || "URL hidden"}
                  </div>
                  <div className="muted connection-meta">Last alert {formatWhen(conn.lastAlertAt)}</div>
                  {active && (
                    <button
                      type="button"
                      className="btn danger connection-revoke"
                      disabled={busy || !navigator.onLine}
                      onClick={() => void revokeConnection(conn)}
                    >
                      Revoke
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {createdWebhookUrl && (
          <div className="created-webhook">
            <p className="muted">Webhook URL (copy into TradingView):</p>
            <code className="url-break" data-testid="created-webhook-url">
              {createdWebhookUrl}
            </code>
          </div>
        )}
        <div className="btn-stack">
          <button
            type="button"
            className="btn primary"
            disabled={busy || !navigator.onLine}
            onClick={() => void createConnection()}
          >
            Create connection
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !navigator.onLine}
            onClick={() => void sendTest()}
          >
            Send TEST alert
          </button>
        </div>
      </div>

      <div className="card settings-card">
        <h2>Install / offline</h2>
        <p className="muted settings-help">
          On iPhone: open in Safari → Share → Add to Home Screen. The app does not install
          automatically. Cached decisions are marked stale when offline.
        </p>
      </div>
    </div>
  );
}
