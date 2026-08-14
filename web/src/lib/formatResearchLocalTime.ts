/**
 * Research monitor display-only local time formatting.
 * Backend timestamps remain UTC ISO; this never mutates stored values.
 */

export function formatResearchLocalTime(
  iso: string | null | undefined,
  opts?: {
    timeZone?: string;
    now?: Date;
  }
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  const timeZone = opts?.timeZone; // undefined → browser local
  const fmt = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone
  });
  return `${fmt.format(d)} LOCAL`;
}

export function formatResearchUtcTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  const fmt = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC"
  });
  return `${fmt.format(d)} UTC`;
}
