import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../lib/auth";
import {
  ensureWebPushRegistered,
  getNotificationPermission,
  isProbablyInstalledPwa,
  isWebPushSupported,
  subscribeWebPush,
  type PushSubscribeResult
} from "../../lib/push";

type PushResult = PushSubscribeResult | null;
type ProbeState = "idle" | "probing" | "registering";

const isIosDevice = (): boolean =>
  typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);

function statusCopy(args: {
  permission: NotificationPermission | "unsupported";
  supported: boolean;
  installed: boolean;
  result: PushResult;
  probe: ProbeState;
}): { label: string; detail: string; canEnable: boolean; tone: string; showIosSteps: boolean } {
  if (args.probe === "registering") {
    return {
      label: "Registering phone…",
      detail: "Creating a Web Push subscription and saving it to your GoldMeta account.",
      canEnable: false,
      tone: "amber",
      showIosSteps: false
    };
  }
  if (args.probe === "probing") {
    return {
      label: "Checking phone alerts…",
      detail: "Confirming a real push subscription is registered with GoldMeta.",
      canEnable: false,
      tone: "amber",
      showIosSteps: false
    };
  }
  if (args.result?.status === "subscribed") {
    return {
      label: "Phone alerts active",
      detail:
        "A Web Push subscription for this phone is registered with GoldMeta. Plan alerts can reach this device when preferences are on.",
      canEnable: false,
      tone: "green",
      showIosSteps: false
    };
  }
  if (args.result?.status === "missing_vapid") {
    return {
      label: "Server configuration missing",
      detail: "GoldMeta Web Push (VAPID) is not configured on the server yet.",
      canEnable: false,
      tone: "red",
      showIosSteps: false
    };
  }
  if (args.result?.status === "failed") {
    return {
      label: "Push subscription failed",
      detail: args.result.message || "Could not register this phone for Web Push.",
      canEnable: true,
      tone: "red",
      showIosSteps: false
    };
  }
  if (args.result?.status === "denied" || args.permission === "denied") {
    return {
      label: "Notifications blocked",
      detail: "Enable notifications in your browser or device settings, then try again.",
      canEnable: false,
      tone: "red",
      showIosSteps: false
    };
  }
  if (args.result?.status === "permission_required") {
    return {
      label: "Notifications permission required",
      detail: "Tap Enable alerts to allow notifications and register this phone with GoldMeta.",
      canEnable: true,
      tone: "amber",
      showIosSteps: false
    };
  }
  if (isIosDevice() && !args.installed) {
    return {
      label: "Add to Home Screen for iPhone alerts",
      detail: "iPhone Web Push works from the installed Home Screen app.",
      canEnable: false,
      tone: "amber",
      showIosSteps: true
    };
  }
  if (!args.supported || args.result?.status === "unsupported") {
    return {
      label: "Unsupported on this browser",
      detail: "This browser does not support Web Push. In-app notifications still work from the bell.",
      canEnable: false,
      tone: "red",
      showIosSteps: false
    };
  }
  return {
    label: "Notifications permission required",
    detail: "Tap Enable alerts to allow notifications and register this phone with GoldMeta.",
    canEnable: true,
    tone: "amber",
    showIosSteps: false
  };
}

export function PhoneAlertsControl({ compact = true }: { compact?: boolean }) {
  const { api } = useAuth();
  const [permission, setPermission] = useState(getNotificationPermission());
  const [result, setResult] = useState<PushResult>(null);
  const [probe, setProbe] = useState<ProbeState>("probing");
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const supported = isWebPushSupported();
  const installed = isProbablyInstalledPwa();
  const copy = useMemo(
    () => statusCopy({ permission, supported, installed, result, probe }),
    [permission, supported, installed, result, probe]
  );
  const active = result?.status === "subscribed";

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setProbe("probing");
      setError(null);
      try {
        const next = await ensureWebPushRegistered(api);
        if (cancelled) return;
        setResult(next);
        setPermission(getNotificationPermission());
        if (next.status === "missing_vapid" || next.status === "failed") {
          setError(next.message);
        }
      } catch (err) {
        if (cancelled) return;
        setResult({
          status: "failed",
          message: err instanceof Error ? err.message : "Push subscription failed."
        });
        setError(err instanceof Error ? err.message : "Push subscription failed.");
      } finally {
        if (!cancelled) setProbe("idle");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const enable = async () => {
    if (busy) return;
    setBusy(true);
    setProbe("registering");
    setError(null);
    setMessage(null);
    try {
      const next = await subscribeWebPush(api);
      setResult(next);
      setPermission(getNotificationPermission());
      if (next.status === "subscribed") {
        setMessage(next.message);
        try {
          const settings = await api.getSettings();
          if (!settings.notificationsEnabled) {
            await api.updateSettings({ notificationsEnabled: true });
          }
        } catch {
          /* subscription is still valid even if prefs patch fails */
        }
      } else {
        setError(next.message);
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : "Phone alert setup failed.";
      setResult({ status: "failed", message: text });
      setError(text);
    } finally {
      setProbe("idle");
      setBusy(false);
    }
  };

  const sendTest = async () => {
    if (!active || testBusy) return;
    setTestBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await api.sendTestNotification();
      const delivered =
        (response.webSent ?? 0) > 0 || (response.fcmSent ?? 0) > 0;
      if (!response.ok || !delivered) {
        setResult({
          status: "failed",
          message: response.message || "Test push was not delivered to this phone."
        });
        setError(response.message || "Test push was not delivered to this phone.");
        return;
      }
      setMessage(
        response.message ||
          (response.webSent
            ? "Test Web Push sent to this phone."
            : "Test notification sent to a registered device.")
      );
    } catch (err) {
      const text = err instanceof Error ? err.message : "Test notification failed.";
      setError(text);
      if (/NO_PUSH_TARGETS|subscription|VAPID|configuration/i.test(text)) {
        setResult({ status: "failed", message: text });
      }
    } finally {
      setTestBusy(false);
    }
  };

  return (
    <section
      className={`gm-phone-alerts tone-${copy.tone}${compact ? " gm-phone-alerts-compact" : ""}`}
      id="phone-alerts"
      data-testid="phone-alerts-control"
      tabIndex={-1}
      aria-label="Phone alerts"
    >
      <div className="gm-phone-alerts-copy">
        <h2 data-testid="phone-alerts-label">{copy.label}</h2>
        {(!compact || copy.showIosSteps || Boolean(error) || Boolean(message)) && <p>{copy.detail}</p>}
      </div>
      {copy.showIosSteps && (
        <details className="gm-phone-alert-help">
          <summary>iPhone setup</summary>
          <ol className="gm-phone-alert-steps" data-testid="iphone-alert-steps">
            <li>Open GoldMeta in Safari</li>
            <li>Tap Share</li>
            <li>Add to Home Screen</li>
            <li>Open GoldMeta from the new Home Screen icon</li>
            <li>Tap Enable alerts</li>
            <li>Tap Allow</li>
            <li>Tap Send test notification and confirm the alert appears</li>
          </ol>
        </details>
      )}
      {(error || message) && (
        <p className="gm-meta" role="status" data-testid="phone-alerts-message">
          {error ?? message}
        </p>
      )}
      {copy.canEnable ? (
        <button
          type="button"
          className="gm-btn-primary gm-phone-alert-button"
          onClick={() => void enable()}
          disabled={busy || probe !== "idle"}
          data-testid="enable-phone-alerts"
        >
          {busy || probe === "registering" ? "Registering phone…" : "Enable alerts"}
        </button>
      ) : null}
      {active ? (
        <button
          type="button"
          className="gm-btn-outline gm-phone-alert-button"
          onClick={() => void sendTest()}
          disabled={testBusy}
          data-testid="phone-alerts-send-test"
        >
          {testBusy ? "Sending…" : "Send test notification"}
        </button>
      ) : null}
    </section>
  );
}
