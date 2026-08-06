import { useEffect, useRef } from "react";
import { useAuth } from "./auth";
import {
  formatCompactLocalTime,
  formatCompactLocalTimeWithSeconds,
  loadTimezonePreference
} from "./timezone";
import {
  LIVE_QUOTE_DISPLAY_THROTTLE_MS,
  LIVE_QUOTE_POLL_MS,
  shouldFlushQuoteDisplay,
  type LiveQuotePayload,
  type QuoteFreshness
} from "./liveQuote";
import { useShellQuote, type ShellQuote } from "./quoteContext";

type QuoteApiResponse = {
  available?: boolean;
  quote?: (Partial<LiveQuotePayload> & {
    timestamp?: string;
    mid?: number;
    bid?: number | null;
    ask?: number | null;
    freshness?: QuoteFreshness;
  }) | null;
  mid?: number | null;
  freshness?: QuoteFreshness;
  livePriceHealth?: QuoteFreshness;
  label?: string;
};

function toShellQuote(payload: QuoteApiResponse): ShellQuote | null {
  const q = payload.quote;
  if (!q || q.bid == null || q.ask == null) {
    if (payload.available === false || payload.livePriceHealth === "UNAVAILABLE") {
      return {
        price: null,
        updatedLabel: "—",
        freshness: "UNAVAILABLE",
        unavailable: true,
        source: "broker",
        fresh: false
      };
    }
    return null;
  }
  const mid =
    typeof q.mid === "number"
      ? q.mid
      : Number((((q.bid as number) + (q.ask as number)) / 2).toFixed(6));
  const ts = q.brokerTimestamp ?? q.timestamp ?? q.receivedAt ?? null;
  const freshness = (q.freshness ?? payload.freshness ?? "LIVE") as QuoteFreshness;
  const tz = loadTimezonePreference();
  return {
    price: mid,
    bid: q.bid,
    ask: q.ask,
    updatedLabel: formatCompactLocalTimeWithSeconds(ts, tz),
    sessionLabel: undefined,
    freshness,
    fresh: freshness === "LIVE",
    source: "broker",
    unavailable: false
  };
}

/**
 * Continuously feeds the shell QuoteHeader from the backend Pepperstone quote.
 * Independent of plan polls, WAIT decisions, AutoTrade OFF, and Refresh.
 */
export function useLiveXauusdQuote(opts?: { enabled?: boolean }): void {
  const enabled = opts?.enabled !== false;
  const { api } = useAuth();
  const { quote, setQuote } = useShellQuote();
  const lastFlushAt = useRef(0);
  const lastMid = useRef<number | null>(null);
  const inFlight = useRef(false);
  const quoteRef = useRef(quote);
  quoteRef.current = quote;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: number | null = null;

    const apply = (next: ShellQuote) => {
      if (cancelled) return;
      const now = Date.now();
      const mid = next.price;
      if (
        mid != null &&
        !shouldFlushQuoteDisplay({
          previousMid: lastMid.current,
          nextMid: mid,
          lastFlushAt: lastFlushAt.current,
          nowMs: now,
          throttleMs: LIVE_QUOTE_DISPLAY_THROTTLE_MS
        })
      ) {
        return;
      }
      lastFlushAt.current = now;
      lastMid.current = mid;
      setQuote((current) => {
        // Do not let decision-page fallback overwrite a broker quote.
        if (
          current?.source === "broker" &&
          next.source !== "broker" &&
          !next.unavailable
        ) {
          return current;
        }
        return next;
      });
    };

    const tick = async (force = false) => {
      if (inFlight.current) return;
      if (
        !force &&
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      inFlight.current = true;
      try {
        const res = (await api.getCTraderLiveQuote(
          force ? { refresh: true } : undefined
        )) as QuoteApiResponse;
        const shell = toShellQuote(res);
        if (shell) apply(shell);
      } catch {
        // Keep last verified broker quote visible; mark delayed if we had one.
        const current = quoteRef.current;
        if (current?.source === "broker" && current.price != null) {
          apply({
            ...current,
            freshness: current.freshness === "MARKET_CLOSED" ? "MARKET_CLOSED" : "DELAYED",
            fresh: false
          });
        }
      } finally {
        inFlight.current = false;
      }
    };

    // Immediate snapshot on open / mount — do not wait for first interval.
    void tick(true);
    timer = window.setInterval(() => {
      void tick(false);
    }, LIVE_QUOTE_POLL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void tick(true);
      }
    };
    const onOnline = () => {
      void tick(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      if (timer != null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled, setQuote, api]);
}

/** @deprecated — keep named export for tests that assert compact time helpers. */
export function formatQuoteUpdatedLabel(iso: string | null | undefined): string {
  return formatCompactLocalTimeWithSeconds(iso, loadTimezonePreference());
}

export { formatCompactLocalTime };
