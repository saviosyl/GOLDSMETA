/**
 * cTrader symbol schedule helpers.
 * Schedule intervals are seconds from Sunday 00:00 in the symbol timezone.
 */

export type MarketStatus = "OPEN" | "CLOSED" | "UNKNOWN";

export type ScheduleInterval = {
  startSecond: number;
  endSecond: number;
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseScheduleIntervals(raw: unknown): ScheduleInterval[] {
  if (!Array.isArray(raw)) return [];
  const out: ScheduleInterval[] = [];
  for (const item of raw) {
    const row = (item ?? {}) as Record<string, unknown>;
    const startSecond = toNumber(row.startSecond);
    const endSecond = toNumber(row.endSecond);
    if (startSecond == null || endSecond == null) continue;
    out.push({ startSecond, endSecond });
  }
  return out;
}

/** Seconds since Sunday 00:00 in the given IANA timezone. */
export function secondsSinceSundayLocal(
  date: Date,
  timeZone: string
): number | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23"
    });
    const parts = fmt.formatToParts(date);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";
    const weekday = get("weekday");
    const hour = Number(get("hour"));
    const minute = Number(get("minute"));
    const second = Number(get("second"));
    const dayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6
    };
    const day = dayMap[weekday];
    if (day == null || !Number.isFinite(hour) || !Number.isFinite(minute)) {
      return null;
    }
    return day * 86400 + hour * 3600 + minute * 60 + (Number.isFinite(second) ? second : 0);
  } catch {
    return null;
  }
}

export function marketStatusFromSchedule(args: {
  schedule: ScheduleInterval[];
  timeZone?: string | null;
  now?: Date;
}): MarketStatus {
  if (!args.schedule.length) return "UNKNOWN";
  const tz = (args.timeZone || "UTC").trim() || "UTC";
  const now = args.now ?? new Date();
  const sec = secondsSinceSundayLocal(now, tz);
  if (sec == null) return "UNKNOWN";
  const open = args.schedule.some(
    (iv) => sec >= iv.startSecond && sec < iv.endSecond
  );
  return open ? "OPEN" : "CLOSED";
}
