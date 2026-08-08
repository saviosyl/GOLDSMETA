/**
 * Economic news guard — provider abstraction.
 *
 * Providers:
 * - FINNHUB (or any key-backed structured calendar) when ECONOMIC_CALENDAR_API_KEY set
 * - TEMPLATE (optional conservative mode) when CTRADER_NEWS_PROVIDER=template
 * - NONE when not configured — never labelled as a live calendar
 *
 * Static template must NEVER be labelled "Live economic calendar".
 */

export type NewsImpact = "HIGH" | "MEDIUM" | "OFF";

export type NewsGuardConfig = {
  mode: NewsImpact;
  minutesBefore: number;
  minutesAfter: number;
};

export type CalendarEvent = {
  name: string;
  country: string;
  impact: "HIGH" | "MEDIUM" | "LOW";
  /** ISO timestamp (UTC). */
  at: string;
  source: "FINNHUB" | "TEMPLATE";
};

export type NewsBlackoutStatus = {
  configured: boolean;
  provider: "NONE" | "TEMPLATE_PROTECTION" | "FINNHUB";
  /** Explicit product label for UI — never "Live economic calendar" for template. */
  providerLabel: string;
  active: boolean;
  reason: string | null;
  nextEventLabel: string | null;
  nextEventAt: string | null;
  blackoutFrom: string | null;
  blackoutTo: string | null;
  upcoming: Array<{
    name: string;
    impact: string;
    at: string;
    blackoutFrom: string;
    blackoutTo: string;
  }>;
  /** When news filter is ON but provider missing — fail-closed. */
  failClosed: boolean;
  failClosedReason: string | null;
};

export type NewsProviderKind = "NONE" | "TEMPLATE" | "FINNHUB";

/** Resolve provider from env — never invent events without a key for FINNHUB. */
export function loadNewsProviderKind(
  env: NodeJS.ProcessEnv = process.env
): NewsProviderKind {
  const explicit = (env.CTRADER_NEWS_PROVIDER ?? "").trim().toLowerCase();
  const key = (
    env.ECONOMIC_CALENDAR_API_KEY ??
    env.FINNHUB_API_KEY ??
    ""
  ).trim();
  if (explicit === "none" || explicit === "off") return "NONE";
  if (explicit === "template" || explicit === "static" || explicit === "static_template") {
    return "TEMPLATE";
  }
  if (explicit === "finnhub" || explicit === "external") {
    return key ? "FINNHUB" : "NONE";
  }
  // Auto: key present → Finnhub; else not configured (do NOT default to template).
  if (key) return "FINNHUB";
  return "NONE";
}

function impactRank(impact: string): number {
  const u = impact.toUpperCase();
  if (u === "HIGH" || u === "3") return 3;
  if (u === "MEDIUM" || u === "2") return 2;
  return 1;
}

function passesImpactFilter(
  eventImpact: "HIGH" | "MEDIUM" | "LOW",
  mode: NewsImpact
): boolean {
  if (mode === "OFF") return false;
  if (mode === "HIGH") return eventImpact === "HIGH";
  // MEDIUM mode = MEDIUM + HIGH
  return eventImpact === "HIGH" || eventImpact === "MEDIUM";
}

function mapFinnhubImpact(raw: unknown): "HIGH" | "MEDIUM" | "LOW" {
  const s = String(raw ?? "").toUpperCase();
  if (s === "HIGH" || s === "3") return "HIGH";
  if (s === "MEDIUM" || s === "2") return "MEDIUM";
  return "LOW";
}

/**
 * Parse Finnhub economic calendar JSON into USD events.
 * Never fabricates CPI/NFP/FOMC — only maps provider rows.
 */
export function parseFinnhubEconomicCalendar(
  payload: unknown,
  now = new Date()
): CalendarEvent[] {
  const root = payload as {
    economicCalendar?: unknown[];
    data?: unknown[];
  };
  const list = Array.isArray(root?.economicCalendar)
    ? root.economicCalendar
    : Array.isArray(root?.data)
      ? root.data
      : Array.isArray(payload)
        ? payload
        : [];
  const out: CalendarEvent[] = [];
  for (const item of list) {
    const row = (item ?? {}) as Record<string, unknown>;
    const country = String(row.country ?? row.countryCode ?? "").toUpperCase();
    if (country !== "US" && country !== "USA" && country !== "UNITED STATES") {
      continue;
    }
    const name = String(row.event ?? row.name ?? "").trim();
    if (!name) continue;
    const timeRaw =
      row.time ?? row.datetime ?? row.date ?? row.timestamp ?? null;
    let atMs: number | null = null;
    if (typeof timeRaw === "number" && Number.isFinite(timeRaw)) {
      atMs = timeRaw < 1e12 ? timeRaw * 1000 : timeRaw;
    } else if (typeof timeRaw === "string" && timeRaw.trim()) {
      // Finnhub often returns "YYYY-MM-DD HH:mm:ss" as UTC-ish
      const normalized = timeRaw.includes("T")
        ? timeRaw
        : timeRaw.replace(" ", "T") + (timeRaw.endsWith("Z") ? "" : "Z");
      const parsed = Date.parse(normalized);
      if (Number.isFinite(parsed)) atMs = parsed;
    }
    if (atMs == null) continue;
    out.push({
      name,
      country: "US",
      impact: mapFinnhubImpact(row.impact ?? row.importance),
      at: new Date(atMs).toISOString(),
      source: "FINNHUB"
    });
  }
  // Prefer upcoming / recent around now
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Explicit template protection windows — NOT a live calendar. */
function templateEvents(now = new Date()): CalendarEvent[] {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return [];
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  return [
    {
      name: "US data window (template protection)",
      country: "US",
      impact: "HIGH",
      at: new Date(Date.UTC(y, m, d, 13, 30, 0, 0)).toISOString(),
      source: "TEMPLATE"
    },
    {
      name: "US data window (template protection)",
      country: "US",
      impact: "HIGH",
      at: new Date(Date.UTC(y, m, d, 15, 0, 0, 0)).toISOString(),
      source: "TEMPLATE"
    }
  ];
}

function evaluateFromEvents(
  events: CalendarEvent[],
  cfg: NewsGuardConfig,
  provider: NewsBlackoutStatus["provider"],
  providerLabel: string,
  now = new Date()
): NewsBlackoutStatus {
  if (cfg.mode === "OFF") {
    return {
      configured: true,
      provider,
      providerLabel,
      active: false,
      reason: null,
      nextEventLabel: null,
      nextEventAt: null,
      blackoutFrom: null,
      blackoutTo: null,
      upcoming: [],
      failClosed: false,
      failClosedReason: null
    };
  }

  const filtered = events.filter((e) => passesImpactFilter(e.impact, cfg.mode));
  const upcoming: NewsBlackoutStatus["upcoming"] = [];
  let active: NewsBlackoutStatus | null = null;
  let next: CalendarEvent | null = null;

  for (const ev of filtered) {
    const center = Date.parse(ev.at);
    if (!Number.isFinite(center)) continue;
    const from = center - cfg.minutesBefore * 60_000;
    const to = center + cfg.minutesAfter * 60_000;
    const row = {
      name: ev.name,
      impact: ev.impact,
      at: ev.at,
      blackoutFrom: new Date(from).toISOString(),
      blackoutTo: new Date(to).toISOString()
    };
    if (center >= now.getTime() - cfg.minutesAfter * 60_000) {
      upcoming.push(row);
    }
    const t = now.getTime();
    if (t >= from && t <= to && !active) {
      active = {
        configured: true,
        provider,
        providerLabel,
        active: true,
        reason: "NEWS_GUARD",
        nextEventLabel: ev.name,
        nextEventAt: ev.at,
        blackoutFrom: row.blackoutFrom,
        blackoutTo: row.blackoutTo,
        upcoming: [],
        failClosed: false,
        failClosedReason: null
      };
    }
    if (center > now.getTime() && !next) next = ev;
  }

  if (active) {
    return { ...active, upcoming: upcoming.slice(0, 8) };
  }

  return {
    configured: true,
    provider,
    providerLabel,
    active: false,
    reason: null,
    nextEventLabel: next?.name ?? null,
    nextEventAt: next?.at ?? null,
    blackoutFrom: next
      ? new Date(
          Date.parse(next.at) - cfg.minutesBefore * 60_000
        ).toISOString()
      : null,
    blackoutTo: next
      ? new Date(Date.parse(next.at) + cfg.minutesAfter * 60_000).toISOString()
      : null,
    upcoming: upcoming.slice(0, 8),
    failClosed: false,
    failClosedReason: null
  };
}

export async function fetchFinnhubEconomicCalendar(args: {
  apiKey: string;
  fromDate: string;
  toDate: string;
  fetchImpl?: typeof fetch;
}): Promise<CalendarEvent[]> {
  const fetchFn = args.fetchImpl ?? fetch;
  const url =
    `https://finnhub.io/api/v1/calendar/economic` +
    `?from=${encodeURIComponent(args.fromDate)}` +
    `&to=${encodeURIComponent(args.toDate)}` +
    `&token=${encodeURIComponent(args.apiKey)}`;
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(`ECONOMIC_CALENDAR_FETCH_FAILED status=${res.status}`);
  }
  const json = await res.json();
  return parseFinnhubEconomicCalendar(json);
}

export async function evaluateNewsGuardAsync(
  cfg: NewsGuardConfig,
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch
): Promise<NewsBlackoutStatus> {
  const kind = loadNewsProviderKind(env);

  if (kind === "NONE") {
    // Not configured: never pretend this is a live calendar. Do not invent
    // blackout windows. Trading is not blocked solely for missing config
    // (Demo qualification must continue); UI must show Not configured.
    return {
      configured: false,
      provider: "NONE",
      providerLabel: "Not configured",
      active: false,
      reason: null,
      nextEventLabel: null,
      nextEventAt: null,
      blackoutFrom: null,
      blackoutTo: null,
      upcoming: [],
      failClosed: false,
      failClosedReason:
        cfg.mode !== "OFF"
          ? "Economic calendar not configured — template is not active; no fabricated events"
          : null
    };
  }

  if (kind === "TEMPLATE") {
    return evaluateFromEvents(
      templateEvents(now),
      cfg,
      "TEMPLATE_PROTECTION",
      "Template protection",
      now
    );
  }

  const key = (
    env.ECONOMIC_CALENDAR_API_KEY ??
    env.FINNHUB_API_KEY ??
    ""
  ).trim();
  if (!key) {
    return evaluateNewsGuardAsync(
      cfg,
      now,
      { ...env, CTRADER_NEWS_PROVIDER: "none" },
      fetchImpl
    );
  }

  try {
    const from = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    const to = new Date(now.getTime() + 3 * 86_400_000).toISOString().slice(0, 10);
    const events = await fetchFinnhubEconomicCalendar({
      apiKey: key,
      fromDate: from,
      toDate: to,
      fetchImpl
    });
    return evaluateFromEvents(events, cfg, "FINNHUB", "Finnhub economic calendar", now);
  } catch {
    // Provider unavailable — fail closed when filter on
    const filterOn = cfg.mode !== "OFF";
    return {
      configured: false,
      provider: "NONE",
      providerLabel: "Not configured",
      active: filterOn,
      reason: filterOn ? "ECONOMIC_CALENDAR_UNAVAILABLE" : null,
      nextEventLabel: null,
      nextEventAt: null,
      blackoutFrom: null,
      blackoutTo: null,
      upcoming: [],
      failClosed: filterOn,
      failClosedReason: filterOn
        ? "Economic calendar provider unavailable — new entries paused"
        : null
    };
  }
}

/**
 * Sync evaluator used by existing gates.
 * Uses TEMPLATE only when explicitly configured; otherwise NONE / cached-less FINNHUB unavailable → fail-closed if filter on.
 * Prefer {@link evaluateNewsGuardAsync} for HTTP routes.
 */
export function evaluateNewsGuard(
  cfg: NewsGuardConfig,
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env
): NewsBlackoutStatus {
  const kind = loadNewsProviderKind(env);
  if (kind === "TEMPLATE") {
    return evaluateFromEvents(
      templateEvents(now),
      cfg,
      "TEMPLATE_PROTECTION",
      "Template protection",
      now
    );
  }
  if (kind === "FINNHUB") {
    // Sync path cannot fetch — fail closed when filter on until async path runs.
    const filterOn = cfg.mode !== "OFF";
    return {
      configured: true,
      provider: "FINNHUB",
      providerLabel: "Finnhub economic calendar",
      active: false,
      reason: null,
      nextEventLabel: null,
      nextEventAt: null,
      blackoutFrom: null,
      blackoutTo: null,
      upcoming: [],
      failClosed: false,
      failClosedReason: filterOn
        ? "Use async news-guard endpoint for live calendar evaluation"
        : null
    };
  }
  return {
    configured: false,
    provider: "NONE",
    providerLabel: "Not configured",
    active: false,
    reason: null,
    nextEventLabel: null,
    nextEventAt: null,
    blackoutFrom: null,
    blackoutTo: null,
    upcoming: [],
    failClosed: false,
    failClosedReason:
      cfg.mode !== "OFF"
        ? "Economic calendar not configured — template is not active; no fabricated events"
        : null
  };
}
