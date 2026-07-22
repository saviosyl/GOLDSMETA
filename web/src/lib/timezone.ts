/**
 * User timezone preferences and display helpers.
 * Backend timestamps stay UTC; UI shows local (or chosen) time first.
 */

const STORAGE_KEY = "goldmeta.timezone.preference.v1";

export type TimezoneMode = "auto" | "utc" | "iana";

export type TimezonePreference = {
  mode: TimezoneMode;
  /** IANA zone when mode === "iana" */
  iana?: string;
};

export function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function loadTimezonePreference(): TimezonePreference {
  if (typeof localStorage === "undefined") return { mode: "auto" };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { mode: "auto" };
    const parsed = JSON.parse(raw) as TimezonePreference;
    if (parsed?.mode === "utc") return { mode: "utc" };
    if (parsed?.mode === "iana" && parsed.iana) return { mode: "iana", iana: parsed.iana };
    return { mode: "auto" };
  } catch {
    return { mode: "auto" };
  }
}

export function saveTimezonePreference(pref: TimezonePreference): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pref));
}

export function resolveDisplayTimezone(pref: TimezonePreference = loadTimezonePreference()): string {
  if (pref.mode === "utc") return "UTC";
  if (pref.mode === "iana" && pref.iana) return pref.iana;
  return detectBrowserTimezone();
}

export type FormattedTimestamp = {
  primary: string;
  secondaryUtc: string;
  timeZone: string;
  label: string;
};

/** Local-first timestamp; UTC always available as secondary. */
export function formatLocalTimestamp(
  iso: string | null | undefined,
  pref: TimezonePreference = loadTimezonePreference()
): FormattedTimestamp {
  if (!iso) {
    return { primary: "—", secondaryUtc: "—", timeZone: resolveDisplayTimezone(pref), label: "—" };
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { primary: iso, secondaryUtc: iso, timeZone: resolveDisplayTimezone(pref), label: iso };
  }

  const timeZone = resolveDisplayTimezone(pref);
  const primary = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone
  })
    .format(d)
    .replace(",", "");

  const secondaryUtc = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC"
  }).format(d);

  const label =
    pref.mode === "utc"
      ? `${primary} UTC`
      : `Updated ${primary} · Your time · ${timeZone}`;

  return {
    primary,
    secondaryUtc: `${secondaryUtc} UTC`,
    timeZone,
    label
  };
}

/** Compact freshness line for headers: "Updated 06:15" */
export function formatCompactLocalTime(
  iso: string | null | undefined,
  pref: TimezonePreference = loadTimezonePreference()
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const timeZone = resolveDisplayTimezone(pref);
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone
  }).format(d);
}

/** Short date + time for lists */
export function formatLocalDateTime(
  iso: string | null | undefined,
  pref: TimezonePreference = loadTimezonePreference()
): string {
  return formatLocalTimestamp(iso, pref).primary;
}
