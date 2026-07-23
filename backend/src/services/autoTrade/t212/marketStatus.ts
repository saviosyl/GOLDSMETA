/**
 * Server-side market status derivation for T212 Invest instruments.
 * Never trusts client-supplied marketOpen.
 */

export type MarketStatus = "OPEN" | "CLOSED" | "UNKNOWN";

export interface ExchangeScheduleLike {
  id?: number | string;
  workingScheduleId?: number | string;
  open?: boolean;
  /** Optional ISO timestamps if present on payload */
  openFrom?: string;
  openTo?: string;
}

export interface InstrumentMarketContext {
  ticker: string;
  workingScheduleId?: number | string | null;
  /** Catalogue may expose these inconsistently */
  extendedHours?: boolean | null;
}

export interface MarketStatusResult {
  status: MarketStatus;
  marketOpen: boolean | null;
  source: string;
  rejectionReason: string | null;
  notes: string[];
}

/**
 * Derive market eligibility from exchange metadata + optional position quote freshness.
 * If status cannot be confirmed → MARKET_STATUS_UNKNOWN (do not submit).
 */
export function deriveT212MarketStatus(args: {
  instrument: InstrumentMarketContext;
  exchanges?: ExchangeScheduleLike[] | null;
  /**
   * When position currentPrice is present and fresh, treat as weak OPEN signal
   * only if exchange schedule also says open. Alone it is insufficient.
   */
  hasFreshQuote?: boolean;
  now?: Date;
}): MarketStatusResult {
  const notes: string[] = [];
  const exchanges = args.exchanges ?? [];

  if (!args.instrument.ticker) {
    return {
      status: "UNKNOWN",
      marketOpen: null,
      source: "missing_ticker",
      rejectionReason: "MARKET_STATUS_UNKNOWN",
      notes: ["Instrument ticker missing."]
    };
  }

  const scheduleId = args.instrument.workingScheduleId;
  if (scheduleId == null) {
    notes.push("Instrument has no workingScheduleId in catalogue.");
    return {
      status: "UNKNOWN",
      marketOpen: null,
      source: "no_schedule_id",
      rejectionReason: "MARKET_STATUS_UNKNOWN",
      notes
    };
  }

  const match = exchanges.find(
    (e) =>
      String(e.id ?? e.workingScheduleId ?? "") === String(scheduleId)
  );

  if (!match) {
    notes.push(`No exchange schedule match for workingScheduleId=${scheduleId}.`);
    return {
      status: "UNKNOWN",
      marketOpen: null,
      source: "schedule_not_found",
      rejectionReason: "MARKET_STATUS_UNKNOWN",
      notes
    };
  }

  if (typeof match.open === "boolean") {
    if (match.open) {
      notes.push("Exchange schedule reports open=true.");
      return {
        status: "OPEN",
        marketOpen: true,
        source: "exchange_open_flag",
        rejectionReason: null,
        notes
      };
    }
    notes.push("Exchange schedule reports open=false.");
    return {
      status: "CLOSED",
      marketOpen: false,
      source: "exchange_open_flag",
      rejectionReason: "MARKET_CLOSED",
      notes
    };
  }

  // Time window fallback when open flag absent
  if (match.openFrom && match.openTo) {
    const now = args.now ?? new Date();
    const from = Date.parse(match.openFrom);
    const to = Date.parse(match.openTo);
    if (!Number.isNaN(from) && !Number.isNaN(to)) {
      const open = now.getTime() >= from && now.getTime() <= to;
      return {
        status: open ? "OPEN" : "CLOSED",
        marketOpen: open,
        source: "exchange_time_window",
        rejectionReason: open ? null : "MARKET_CLOSED",
        notes: [...notes, `Window ${match.openFrom} → ${match.openTo}`]
      };
    }
  }

  notes.push("Exchange schedule present but open state indeterminate.");
  return {
    status: "UNKNOWN",
    marketOpen: null,
    source: "indeterminate",
    rejectionReason: "MARKET_STATUS_UNKNOWN",
    notes
  };
}

export function requireMarketOpenForSubmission(
  result: MarketStatusResult
): { ok: true } | { ok: false; code: string } {
  if (result.status === "OPEN" && result.marketOpen === true) return { ok: true };
  if (result.status === "CLOSED") return { ok: false, code: "MARKET_CLOSED" };
  return { ok: false, code: "MARKET_STATUS_UNKNOWN" };
}
