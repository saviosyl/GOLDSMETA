/**
 * Server-side market status derivation for T212 Invest instruments.
 * Never trusts client-supplied marketOpen.
 *
 * T212 /equity/metadata/exchanges shape:
 *   [{ id, name, workingSchedules: [{ id, timeEvents: [{ date, type: OPEN|CLOSE }] }] }]
 * Instrument.workingScheduleId matches workingSchedules[].id (not exchange.id).
 */

export type MarketStatus = "OPEN" | "CLOSED" | "UNKNOWN";

export interface ExchangeTimeEventLike {
  date?: string;
  type?: string;
}

export interface WorkingScheduleLike {
  id?: number | string;
  timeEvents?: ExchangeTimeEventLike[];
  open?: boolean;
  openFrom?: string;
  openTo?: string;
}

export interface ExchangeScheduleLike {
  id?: number | string;
  workingScheduleId?: number | string;
  open?: boolean;
  openFrom?: string;
  openTo?: string;
  name?: string;
  workingSchedules?: WorkingScheduleLike[];
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

function findWorkingSchedule(
  exchanges: ExchangeScheduleLike[],
  scheduleId: string
): WorkingScheduleLike | null {
  for (const exchange of exchanges) {
    // Flat legacy shape: schedule fields on the exchange row itself
    if (
      String(exchange.id ?? "") === scheduleId ||
      String(exchange.workingScheduleId ?? "") === scheduleId
    ) {
      if (Array.isArray(exchange.workingSchedules) && exchange.workingSchedules.length > 0) {
        const nested = exchange.workingSchedules.find(
          (ws) => String(ws.id ?? "") === scheduleId
        );
        if (nested) return nested;
      }
      return {
        id: exchange.id ?? exchange.workingScheduleId,
        open: exchange.open,
        openFrom: exchange.openFrom,
        openTo: exchange.openTo,
        timeEvents: undefined
      };
    }

    const nested = (exchange.workingSchedules ?? []).find(
      (ws) => String(ws.id ?? "") === scheduleId
    );
    if (nested) return nested;
  }
  return null;
}

function statusFromTimeEvents(
  timeEvents: ExchangeTimeEventLike[],
  now: Date
): MarketStatusResult | null {
  const events = timeEvents
    .filter((e) => e.date && (e.type === "OPEN" || e.type === "CLOSE"))
    .map((e) => ({
      at: Date.parse(String(e.date)),
      type: String(e.type)
    }))
    .filter((e) => !Number.isNaN(e.at))
    .sort((a, b) => a.at - b.at);

  if (events.length === 0) return null;

  const nowMs = now.getTime();
  let last: "OPEN" | "CLOSE" | null = null;
  for (const ev of events) {
    if (ev.at <= nowMs) {
      last = ev.type === "OPEN" ? "OPEN" : "CLOSE";
    }
  }

  if (last === "OPEN") {
    return {
      status: "OPEN",
      marketOpen: true,
      source: "working_schedule_time_events",
      rejectionReason: null,
      notes: ["Derived OPEN from last OPEN/CLOSE timeEvents before now."]
    };
  }
  if (last === "CLOSE") {
    return {
      status: "CLOSED",
      marketOpen: false,
      source: "working_schedule_time_events",
      rejectionReason: "MARKET_CLOSED",
      notes: ["Derived CLOSED from last OPEN/CLOSE timeEvents before now."]
    };
  }

  // Before the first known event — indeterminate
  return null;
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
  const now = args.now ?? new Date();

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

  const match = findWorkingSchedule(exchanges, String(scheduleId));

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

  if (Array.isArray(match.timeEvents) && match.timeEvents.length > 0) {
    const fromEvents = statusFromTimeEvents(match.timeEvents, now);
    if (fromEvents) {
      return { ...fromEvents, notes: [...notes, ...fromEvents.notes] };
    }
  }

  // Time window fallback when open flag absent
  if (match.openFrom && match.openTo) {
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
