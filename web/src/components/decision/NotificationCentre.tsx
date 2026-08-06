import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import type { InAppNotification, NotificationEventGroup, NotificationPreferences } from "../../types/models";

const EVENT_GROUPS: Array<{ key: NotificationEventGroup; label: string }> = [
  { key: "VALID_PLAN_CREATED", label: "Valid plan created" },
  { key: "ENTRY_ZONE_APPROACHING", label: "Entry zone approaching" },
  { key: "ENTRY_ZONE_REACHED", label: "Entry zone reached" },
  { key: "CONFIRM_5M", label: "5M confirmation" },
  { key: "PLAN_INVALIDATED", label: "Plan invalidated" },
  { key: "TARGETS_REACHED", label: "Targets reached" }
];

const DEFAULT_PREFS = EVENT_GROUPS.reduce(
  (acc, item) => ({ ...acc, [item.key]: false }),
  {} as NotificationPreferences
);

function shortTime(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return iso;
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function notificationMessage(item: InAppNotification): string {
  return item.shortMessage ?? item.message ?? String(item.event).replace(/_/g, " ");
}

export function NotificationCentre() {
  const { api } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InAppNotification[]>([]);
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_PREFS);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  const unread = useMemo(() => items.filter((item) => !item.read && !item.readAt).length, [items]);

  const reload = async () => {
    if (
      !api ||
      typeof api.listNotifications !== "function" ||
      typeof api.notificationPreferences !== "function"
    ) {
      return;
    }
    try {
      const [nextItems, nextPrefs] = await Promise.all([
        api.listNotifications(20).catch(() => []),
        api.notificationPreferences().catch(() => DEFAULT_PREFS)
      ]);
      setItems(nextItems);
      setPrefs({ ...DEFAULT_PREFS, ...nextPrefs });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Notifications unavailable.");
    }
  };

  useEffect(() => {
    void reload();
  }, [api]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const togglePref = async (key: NotificationEventGroup, checked: boolean) => {
    if (!api || typeof api.updateNotificationPreferences !== "function") return;
    const next = { ...prefs, [key]: checked };
    setPrefs(next);
    setBusy(true);
    try {
      setPrefs({ ...DEFAULT_PREFS, ...(await api.updateNotificationPreferences({ [key]: checked })) });
      setMessage("Notification preferences updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preference update failed.");
      setPrefs(prefs);
    } finally {
      setBusy(false);
    }
  };

  const markAllRead = async () => {
    if (!api || typeof api.markNotificationsRead !== "function") return;
    setBusy(true);
    try {
      await api.markNotificationsRead(items.map((item) => item.id));
      setItems((prev) => prev.map((item) => ({ ...item, read: true, readAt: item.readAt ?? new Date().toISOString() })));
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    if (!api || typeof api.sendTestNotification !== "function") return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await api.sendTestNotification();
      setMessage(result.message ?? "Test notification sent.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test notification failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gm-notification-centre" data-testid="notification-centre" ref={ref}>
      <button
        type="button"
        className="gm-notification-bell"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">Bell</span>
        {unread > 0 && <span className="gm-notification-count">{unread}</span>}
      </button>

      {open && (
        <div className="gm-notification-popover" role="dialog" aria-label="Notifications">
          <div className="gm-section-head">
            <h2>Notifications</h2>
            <button type="button" className="gm-linkish" onClick={() => void markAllRead()} disabled={busy || unread === 0}>
              Mark read
            </button>
          </div>
          {message && <p className="gm-meta" role="status">{message}</p>}
          {error && <p className="gm-meta error" role="alert">{error}</p>}

          <ul className="gm-notification-list" aria-label="Recent notifications">
            {items.length === 0 ? (
              <li className="gm-meta">No notifications yet.</li>
            ) : (
              items.map((item) => {
                const planId = item.planId ?? item.decisionId ?? item.setupId ?? null;
                const unreadItem = !item.read && !item.readAt;
                return (
                  <li key={item.id} className={unreadItem ? "is-unread" : undefined}>
                    <div>
                      <strong>
                        {String(item.event).replace(/_/g, " ")}
                        {item.direction ? ` - ${item.direction}` : ""}
                      </strong>
                      <span>{shortTime(item.createdAt)}</span>
                    </div>
                    <p>{notificationMessage(item)}</p>
                    <p className="gm-meta">
                      Plan ID: {planId ?? "--"} {unreadItem ? "Unread" : "Read"}
                    </p>
                    {planId && (
                      <Link className="gm-linkish" to={`/history/${encodeURIComponent(planId)}`} onClick={() => setOpen(false)}>
                        Open plan
                      </Link>
                    )}
                  </li>
                );
              })
            )}
          </ul>

          <h3>Phone alert preferences</h3>
          <div className="gm-notification-prefs">
            {EVENT_GROUPS.map((group) => (
              <label key={group.key} className="gm-check-row">
                <input
                  type="checkbox"
                  checked={Boolean(prefs[group.key])}
                  onChange={(event) => void togglePref(group.key, event.target.checked)}
                />
                {group.label}
              </label>
            ))}
          </div>
          <button type="button" className="gm-btn-outline" onClick={() => void sendTest()} disabled={busy}>
            Send test notification
          </button>
        </div>
      )}
    </div>
  );
}
