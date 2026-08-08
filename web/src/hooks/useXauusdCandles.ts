import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import type { CandleBar, CandlesResponse, ChartTimeframe } from "../lib/xauusdCandles";

const POLL_MS = 60_000;

export function useXauusdCandles(timeframe: ChartTimeframe, enabled = true) {
  const { api } = useAuth();
  const [bars, setBars] = useState<CandleBar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(
    async (force = false) => {
      if (!enabled) return;
      if (inFlight.current && !force) return;
      inFlight.current = true;
      try {
        const res = (await api.getCTraderCandles({
          timeframe,
          count: 120
        })) as CandlesResponse;
        const next = Array.isArray(res.bars) ? res.bars : [];
        setBars(next);
        setSource(res.source ?? "CTRADER_TRENDBARS");
        setError(next.length ? null : "No candle history available");
      } catch (e) {
        const code =
          e && typeof e === "object" && "code" in e
            ? String((e as { code: string }).code)
            : e instanceof Error
              ? e.message
              : "CTRADER_CANDLES_UNAVAILABLE";
        setError(code);
        // Keep last good series when refresh fails (market closed / transient).
      } finally {
        setLoading(false);
        inFlight.current = false;
      }
    },
    [api, enabled, timeframe]
  );

  useEffect(() => {
    setLoading(true);
    void load(true);
    if (!enabled) return;
    const timer = window.setInterval(() => {
      void load(false);
    }, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled, load]);

  return { bars, loading, error, source, refresh: () => load(true) };
}
