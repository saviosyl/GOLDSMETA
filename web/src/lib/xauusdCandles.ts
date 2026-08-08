export type ChartTimeframe = "M5" | "M15" | "H1" | "H4";

export type CandleBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
};

export type CandlesResponse = {
  symbol?: string;
  timeframe?: ChartTimeframe;
  bars?: CandleBar[];
  source?: string;
  cached?: boolean;
  environment?: string;
};

export const CHART_TIMEFRAMES: Array<{ id: ChartTimeframe; label: string }> = [
  { id: "M5", label: "5M" },
  { id: "M15", label: "15M" },
  { id: "H1", label: "1H" },
  { id: "H4", label: "4H" }
];

export function timeframeLabel(tf: ChartTimeframe): string {
  return CHART_TIMEFRAMES.find((t) => t.id === tf)?.label ?? tf;
}
