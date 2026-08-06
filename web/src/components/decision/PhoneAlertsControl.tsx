import { useMemo, useState } from "react";
import { useAuth } from "../../lib/auth";
import {
  getNotificationPermission,
  isProbablyInstalledPwa,
  isWebPushSupported,
  subscribeWebPush
} from "../../lib/push";

type PushResult = Awaited<ReturnType<typeof subscribeWebPush>> | null;

const isIosDevice = (): boolean =>
  typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);

function statusCopy(args: {
  permission: NotificationPermission | "unsupported";
  supported: boolean;
  installed: boolean;
  result: PushResult;
}): { label: string; detail: string; canEnable: boolean; tone: string; showIosSteps: boolean } {
  if (args.result?.status === "subscribed" || args.permission === "granted") {
    return {
      label: "Phone alerts active",
      detail: "This browser can receive GoldMeta plan alerts when your event preferences are on.",
      canEnable: false,
      tone: "green",
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
    label: "Permission required",
    detail: "Tap Enable alerts to request notification permission.",
    canEnable: true,
    tone: "amber",
    showIosSteps: false
  };
}

export function PhoneAlertsControl({ compact = true }: { compact?: boolean }) {
  const { api } = useAuth();
  const [permission, setPermission] = useState(getNotificationPermission());
  const [result, setResult] = useState<PushResult>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = isWebPushSupported();
  const installed = isProbablyInstalledPwa();
  const copy = useMemo(
    () => statusCopy({ permission, supported, installed, result }),
    [permission, supported, installed, result]
  );

  const enable = async () => {
    if (!copy.canEnable || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await subscribeWebPush(api);
      setResult(next);
      setPermission(getNotificationPermission());
      if (next.status !== "subscribed") {
        setError(next.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Phone alert setup failed.");
    } finally {
      setBusy(false);
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
        {(!compact || copy.showIosSteps) && <p>{copy.detail}</p>}
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
          </ol>
        </details>
      )}
      {error && (
        <p className="gm-meta" role="status" data-testid="phone-alerts-message">
          {error}
        </p>
      )}
      {copy.canEnable ? (
        <button
          type="button"
          className="gm-btn-primary gm-phone-alert-button"
          onClick={() => void enable()}
          disabled={busy}
          data-testid="enable-phone-alerts"
        >
          {busy ? "Enabling…" : "Enable alerts"}
        </button>
      ) : null}
    </section>
  );
}
