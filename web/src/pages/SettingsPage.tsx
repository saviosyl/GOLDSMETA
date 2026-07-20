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

export function SettingsPage() {
  const { api, signOut, apiBaseUrl, user } = useAuth();
  const [settings, setSettings] = useState<BackendSettings | null>(null);
  const [connections, setConnections] = useState<TradingViewConnection[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState(getNotificationPermission());
  const [busy, setBusy] = useState(false);

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
    void reload().catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load settings")
    );
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
      setError(err instanceof Error ? err.message : "Failed to update settings");
    } finally {
      setBusy(false);
    }
  };

  const createConnection = async () => {
    if (!navigator.onLine) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.createTradingViewConnection();
      setMessage(
        `TradingView connection created. Webhook URL ready${result.secret ? " (secret shown once in API response — store securely)." : "."}`
      );
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create connection");
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    if (!navigator.onLine) return;
    setBusy(true);
    try {
      const result = await api.sendTestAlert(connections[0]?.id);
      setMessage(result.message || "Test alert queued.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test alert failed");
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
      setError(err instanceof Error ? err.message : "Push registration failed");
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
      setError(err instanceof Error ? err.message : "Unsubscribe failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
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

      <div className="card">
        <h2>Account</h2>
        <p className="muted">{user?.email}</p>
        <p className="muted">API: {apiBaseUrl}</p>
        <button type="button" className="btn danger block" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>

      <div className="card">
        <h2>Notifications</h2>
        <p className="muted">
          Permission is requested only after you tap Enable. On iPhone, Web Push works for Home
          Screen-installed PWAs on compatible iOS versions — not verified until tested on a real
          device.
        </p>
        <p>
          Browser permission: <strong>{pushStatus}</strong>
        </p>
        <p>
          Installed PWA heuristic: <strong>{isProbablyInstalledPwa() ? "yes" : "no"}</strong>
        </p>
        <p>
          Web Push API: <strong>{isWebPushSupported() ? "available" : "unavailable"}</strong>
        </p>
        <p>
          Backend notifications flag:{" "}
          <strong>{settings?.notificationsEnabled ? "on" : "off"}</strong>
        </p>
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" className="btn primary" disabled={busy || !navigator.onLine} onClick={() => void enablePush()}>
            Enable Web Push
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void disablePush()}>
            Unsubscribe
          </button>
          <button type="button" className="btn" disabled={busy || !settings} onClick={() => void toggleNotifications()}>
            Toggle server flag
          </button>
        </div>
      </div>

      <div className="card">
        <h2>TradingView connection</h2>
        {connections.length === 0 ? (
          <p className="muted">No connections yet.</p>
        ) : (
          <ul className="list">
            {connections.map((conn) => (
              <li key={conn.id}>
                <strong>{conn.status}</strong> · {conn.id}
                <div className="muted">
                  {(conn.webhookURL ?? conn.webhookUrl) || "URL hidden"} · last alert{" "}
                  {formatWhen(conn.lastAlertAt)}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" className="btn primary" disabled={busy || !navigator.onLine} onClick={() => void createConnection()}>
            Create connection
          </button>
          <button type="button" className="btn" disabled={busy || !navigator.onLine} onClick={() => void sendTest()}>
            Send TEST alert
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Install / offline</h2>
        <p className="muted">
          On iPhone: open in Safari → Share → Add to Home Screen. The app does not install
          automatically. Cached decisions are marked stale when offline.
        </p>
      </div>
    </>
  );
}
