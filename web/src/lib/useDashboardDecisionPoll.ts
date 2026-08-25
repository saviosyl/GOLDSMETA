import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_INTERVAL_MS = 30_000;

export type DashboardPollOptions = {
  enabled?: boolean;
  intervalMs?: number;
  onTick: () => Promise<void>;
};

/**
 * Poll while the Dashboard is visible. Pauses when the tab is hidden,
 * refreshes immediately on visibility, and never overlaps in-flight work.
 */
export function useDashboardDecisionPoll({
  enabled = true,
  intervalMs = DEFAULT_INTERVAL_MS,
  onTick
}: DashboardPollOptions): {
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  pollError: boolean;
} {
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const inFlight = useRef(false);
  const onTickRef = useRef(onTick);

  useEffect(() => {
    onTickRef.current = onTick;
  }, [onTick]);

  const run = useCallback(async () => {
    if (inFlight.current) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    inFlight.current = true;
    try {
      await onTickRef.current();
      setLastSuccessAt(new Date().toISOString());
      setConsecutiveFailures(0);
    } catch {
      setConsecutiveFailures((n) => n + 1);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      void run();
    };

    // Initial load is owned by the page; polling starts after interval.
    const id = window.setInterval(tick, intervalMs);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, run]);

  return {
    lastSuccessAt,
    consecutiveFailures,
    pollError: consecutiveFailures >= 2
  };
}
