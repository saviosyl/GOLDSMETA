/**
 * Market session provider — official clock/calendar data for production SHADOW.
 * Pure local weekday helpers remain in indicators.ts for deterministic unit tests only.
 */

import type { AlpacaHttpClient } from "./alpacaHttpClient";

export type MarketSessionSnapshot = {
  isOpen: boolean;
  marketDate: string; // YYYY-MM-DD in America/New_York
  regularOpenAt: string | null; // ISO
  regularCloseAt: string | null; // ISO
  minutesToClose: number | null;
  nextOpenAt: string | null;
  earlyClose: boolean;
  source: "alpaca_clock_calendar" | "unavailable";
  asOf: string;
};

export interface MarketSessionProvider {
  getSession(now?: Date): Promise<MarketSessionSnapshot>;
}

type AlpacaClock = {
  timestamp?: string;
  is_open?: boolean;
  next_open?: string;
  next_close?: string;
};

type AlpacaCalendarDay = {
  date: string;
  open: string; // HH:MM Eastern
  close: string; // HH:MM Eastern
};

function etDateParts(now: Date): { y: number; m: number; d: number; dateStr: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  return {
    y,
    m,
    d,
    dateStr: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  };
}

/** Convert an ET calendar date + HH:MM to ISO UTC. */
export function easternWallTimeToIso(dateStr: string, hm: string): string {
  const [hh, mm] = hm.split(":").map(Number);
  // Iterate UTC candidates that format to the target ET wall time.
  const base = Date.parse(`${dateStr}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
  for (let offsetMin = -300; offsetMin <= -240; offsetMin += 60) {
    const candidate = new Date(base - offsetMin * 60_000);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(candidate);
    const y = parts.find((p) => p.type === "year")?.value;
    const mo = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    const h = parts.find((p) => p.type === "hour")?.value;
    const mi = parts.find((p) => p.type === "minute")?.value;
    if (`${y}-${mo}-${d}` === dateStr && `${h}:${mi}` === `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`) {
      return candidate.toISOString();
    }
  }
  // Fallback: assume EDT (−4) then EST (−5)
  const hour = hh ?? 0;
  const minute = mm ?? 0;
  const tryOffsets = [4, 5];
  for (const hours of tryOffsets) {
    const iso = new Date(
      Date.UTC(
        Number(dateStr.slice(0, 4)),
        Number(dateStr.slice(5, 7)) - 1,
        Number(dateStr.slice(8, 10)),
        hour + hours,
        minute,
        0
      )
    );
    return iso.toISOString();
  }
  return new Date().toISOString();
}

export class AlpacaMarketSessionProvider implements MarketSessionProvider {
  private calendarCache: { fetchedAt: number; days: AlpacaCalendarDay[]; key: string } | null =
    null;
  private readonly calendarTtlMs = 6 * 60 * 60_000;

  constructor(
    private readonly client: AlpacaHttpClient,
    private readonly nowFn: () => number = () => Date.now()
  ) {}

  async getSession(now: Date = new Date(this.nowFn())): Promise<MarketSessionSnapshot> {
    const asOf = now.toISOString();
    try {
      const clock = await this.client.getJson<AlpacaClock>("/v2/clock");
      const { dateStr } = etDateParts(now);
      const days = await this.loadCalendarAround(dateStr);
      const today = days.find((d) => d.date === dateStr) ?? null;

      if (!today) {
        // Holiday / weekend — no session today
        const next = days.find((d) => d.date > dateStr) ?? null;
        return {
          isOpen: false,
          marketDate: dateStr,
          regularOpenAt: null,
          regularCloseAt: null,
          minutesToClose: null,
          nextOpenAt: next ? easternWallTimeToIso(next.date, next.open) : clock.next_open ?? null,
          earlyClose: false,
          source: "alpaca_clock_calendar",
          asOf
        };
      }

      const regularOpenAt = easternWallTimeToIso(today.date, today.open);
      const regularCloseAt = easternWallTimeToIso(today.date, today.close);
      const openMs = Date.parse(regularOpenAt);
      const closeMs = Date.parse(regularCloseAt);
      const earlyClose = today.close !== "16:00";
      const isOpen =
        Boolean(clock.is_open) &&
        Number.isFinite(openMs) &&
        Number.isFinite(closeMs) &&
        now.getTime() >= openMs &&
        now.getTime() < closeMs;

      const minutesToClose =
        isOpen && Number.isFinite(closeMs)
          ? Math.max(0, (closeMs - now.getTime()) / 60_000)
          : null;

      const next =
        !isOpen && now.getTime() >= closeMs
          ? days.find((d) => d.date > dateStr)
          : today;

      return {
        isOpen,
        marketDate: dateStr,
        regularOpenAt,
        regularCloseAt,
        minutesToClose,
        nextOpenAt: next
          ? easternWallTimeToIso(next.date, next === today && now.getTime() < openMs ? today.open : next.open)
          : clock.next_open ?? null,
        earlyClose,
        source: "alpaca_clock_calendar",
        asOf
      };
    } catch {
      return {
        isOpen: false,
        marketDate: etDateParts(now).dateStr,
        regularOpenAt: null,
        regularCloseAt: null,
        minutesToClose: null,
        nextOpenAt: null,
        earlyClose: false,
        source: "unavailable",
        asOf
      };
    }
  }

  private async loadCalendarAround(dateStr: string): Promise<AlpacaCalendarDay[]> {
    const start = shiftDate(dateStr, -7);
    const end = shiftDate(dateStr, 14);
    const key = `${start}:${end}`;
    if (
      this.calendarCache &&
      this.calendarCache.key === key &&
      this.nowFn() - this.calendarCache.fetchedAt < this.calendarTtlMs
    ) {
      return this.calendarCache.days;
    }
    const days = await this.client.getJson<AlpacaCalendarDay[]>("/v2/calendar", {
      start,
      end
    });
    const list = Array.isArray(days) ? days : [];
    this.calendarCache = { fetchedAt: this.nowFn(), days: list, key };
    return list;
  }
}

/** Deterministic fixture provider for unit tests. */
export class FixedMarketSessionProvider implements MarketSessionProvider {
  constructor(private readonly snapshot: MarketSessionSnapshot) {}

  /* eslint-disable-next-line @typescript-eslint/require-await -- sync fixture */
  async getSession(): Promise<MarketSessionSnapshot> {
    return { ...this.snapshot, asOf: new Date().toISOString() };
  }
}

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return dt.toISOString().slice(0, 10);
}
