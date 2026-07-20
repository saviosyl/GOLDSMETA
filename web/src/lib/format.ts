/** Format helpers for dashboard numbers — display only, never invent decisions. */

export const formatPrice = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(2);
};

export const formatPercent = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value)}%`;
};

export const formatRatio = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(2)}R`;
};

export const formatWhen = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

export const entryDisplay = (entry: {
  price: number | null;
  zoneLow: number | null;
  zoneHigh: number | null;
}): string => {
  if (entry.price !== null) return formatPrice(entry.price);
  if (entry.zoneLow !== null && entry.zoneHigh !== null) {
    return `${formatPrice(entry.zoneLow)} – ${formatPrice(entry.zoneHigh)}`;
  }
  return "Wait";
};

export const tpPrice = (
  takeProfits: Array<{ label: string; price: number }>,
  label: string
): string => {
  const match = takeProfits.find((tp) => tp.label.toUpperCase() === label.toUpperCase());
  return formatPrice(match?.price);
};

export const isTestDecision = (decision: {
  isTestDecision?: boolean | null;
  environment?: string | null;
  dataSourceLabel?: string;
}): boolean =>
  decision.isTestDecision === true ||
  decision.environment === "TEST" ||
  decision.dataSourceLabel === "TEST";

export const isStaleDecision = (decision: {
  dataQuality?: string;
  dataSourceLabel?: string;
}): boolean =>
  decision.dataQuality === "STALE" ||
  decision.dataSourceLabel === "STALE" ||
  decision.dataSourceLabel === "OFFLINE";
