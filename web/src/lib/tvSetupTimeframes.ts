/**
 * TradingView Setup wizard — alert-role ↔ timeframe guidance helpers.
 * Web-only guidance: webhook URL is the same for every role/timeframe.
 */

export type TvAlertRole = "PLAN_15M" | "CONFIRM_5M" | "QUOTE_1M";

export type TvTimeframeOption = {
  value: string;
  label: string;
  shortLabel: string;
};

/** Canonical wizard timeframe choices (minutes as TradingView period strings). */
export const TV_SETUP_TIMEFRAMES: TvTimeframeOption[] = [
  { value: "1", label: "1 minute", shortLabel: "1m" },
  { value: "5", label: "5 minutes", shortLabel: "5m" },
  { value: "15", label: "15 minutes", shortLabel: "15m" },
  { value: "30", label: "30 minutes", shortLabel: "30m" },
  { value: "60", label: "1 hour", shortLabel: "1h" },
  { value: "240", label: "4 hours", shortLabel: "4h" }
];

export const TV_ALERT_ROLE_OPTIONS: Array<{
  value: TvAlertRole;
  label: string;
  description: string;
}> = [
  {
    value: "PLAN_15M",
    label: "PLAN 15M",
    description: "Required plan alert — use a 15-minute chart."
  },
  {
    value: "CONFIRM_5M",
    label: "CONFIRM 5M",
    description: "Required confirmation alert — use a 5-minute chart."
  },
  {
    value: "QUOTE_1M",
    label: "QUOTE 1M",
    description: "Optional quote alert — use a 1-minute chart."
  }
];

/** Default chart timeframe for each alert role. */
export const DEFAULT_TIMEFRAME_FOR_ROLE: Record<TvAlertRole, string> = {
  PLAN_15M: "15",
  CONFIRM_5M: "5",
  QUOTE_1M: "1"
};

export const TV_TIMEFRAME_GUIDANCE =
  "This wizard choice is for setup guidance. The actual alert timeframe must also be selected on the TradingView chart.";

export const resolveDefaultTimeframeForRole = (role: TvAlertRole): string =>
  DEFAULT_TIMEFRAME_FOR_ROLE[role] ?? "15";

export const isValidTvTimeframe = (value: string | null | undefined): value is string =>
  TV_SETUP_TIMEFRAMES.some((tf) => tf.value === value);

export const mergeTimeframeOptions = (
  fromTemplate?: Array<{ value: string; label: string }> | null
): TvTimeframeOption[] => {
  if (!fromTemplate?.length) return TV_SETUP_TIMEFRAMES;
  const byValue = new Map(TV_SETUP_TIMEFRAMES.map((tf) => [tf.value, tf]));
  for (const tf of fromTemplate) {
    const existing = byValue.get(tf.value);
    if (existing) {
      byValue.set(tf.value, { ...existing, label: tf.label || existing.label });
    }
  }
  // Keep canonical order; append unknown template values at the end.
  const ordered = TV_SETUP_TIMEFRAMES.map((tf) => byValue.get(tf.value) ?? tf);
  for (const tf of fromTemplate) {
    if (!TV_SETUP_TIMEFRAMES.some((c) => c.value === tf.value)) {
      ordered.push({
        value: tf.value,
        label: tf.label,
        shortLabel: tf.label
      });
    }
  }
  return ordered;
};

export const normalizeSelectedTimeframe = (
  selected: string[] | string | null | undefined,
  role: TvAlertRole = "PLAN_15M"
): string => {
  const raw = Array.isArray(selected) ? selected[0] : selected;
  if (isValidTvTimeframe(raw)) return raw;
  return resolveDefaultTimeframeForRole(role);
};
