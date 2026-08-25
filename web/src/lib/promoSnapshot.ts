/**
 * GoldMeta promotional Market Snapshot — formats, verified data model, filename.
 * Never fabricates market values; omit or mark Unavailable when missing.
 */

import { buildMarketLevelLadder, nearestLevels, type LadderInput } from "./marketLadder";
import { buildMarketStory } from "./marketStory";
import type { MarketReportContext } from "./marketReportModel";

export type SnapshotFormatId = "social" | "story" | "square" | "compact";

export type SnapshotFormat = {
  id: SnapshotFormatId;
  label: string;
  width: number;
  height: number;
};

export const SNAPSHOT_FORMATS: SnapshotFormat[] = [
  { id: "social", label: "Social Post", width: 1080, height: 1350 },
  { id: "story", label: "Instagram Story", width: 1080, height: 1920 },
  { id: "square", label: "Square", width: 1080, height: 1080 },
  { id: "compact", label: "Compact Share Card", width: 1200, height: 675 }
];

export function getSnapshotFormat(id: SnapshotFormatId): SnapshotFormat {
  return SNAPSHOT_FORMATS.find((f) => f.id === id) ?? SNAPSHOT_FORMATS[0]!;
}

export type SnapshotTheme = "light" | "dark";

export type SnapshotOptions = {
  formatId: SnapshotFormatId;
  theme: SnapshotTheme;
  showStory: boolean;
  showPlan: boolean;
  showScoreBreakdown: boolean;
};

export const DEFAULT_SNAPSHOT_OPTIONS: SnapshotOptions = {
  formatId: "social",
  theme: "dark",
  showStory: true,
  showPlan: true,
  showScoreBreakdown: false
};

export type SnapshotPlan = {
  direction: string;
  entry: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  riskReward: number | null;
  status: string;
};

export type SnapshotLevel = {
  price: number;
  classification: string;
  tone: string;
  strength: number;
  isLive: boolean;
  isNearestRes: boolean;
  isNearestSup: boolean;
};

export type PromoSnapshotModel = {
  decision: string;
  analysisLabel: string;
  scoreTotal: number | null;
  livePrice: number | null;
  sessionLabel: string;
  compactTime: string;
  timeZone: string;
  utcSecondary: string;
  story: string | null;
  levels: SnapshotLevel[];
  plan: SnapshotPlan | null;
  scoreComponents?: Array<{ label: string; score: number; max: number }>;
  /** Verified report context for the premium 1080×1350 Market Report. */
  reportContext?: MarketReportContext | null;
};

export const SNAPSHOT_DISCLAIMER =
  "Market analysis only. Not financial advice. GoldMeta Score is a rules-based quality score, not a probability of profit.";

export const SNAPSHOT_SITE = "goldmeta.metamechsolutions.com";

export function analysisLabelFor(decision: string): string {
  const d = (decision || "WAIT").toUpperCase();
  if (d === "BUY") return "GoldMeta Analysis: BUY";
  if (d === "SELL") return "GoldMeta Analysis: SELL";
  return "GoldMeta Analysis: WAIT";
}

export function decisionTone(decision: string): "buy" | "sell" | "wait" {
  const d = (decision || "WAIT").toUpperCase();
  if (d === "BUY") return "buy";
  if (d === "SELL") return "sell";
  return "wait";
}

function riskReward(
  entry: number | null,
  stop: number | null,
  tp1: number | null
): number | null {
  if (entry == null || stop == null || tp1 == null) return null;
  const risk = Math.abs(entry - stop);
  if (risk < 1e-6) return null;
  const reward = Math.abs(tp1 - entry);
  return Math.round((reward / risk) * 100) / 100;
}

export type BuildSnapshotInput = {
  decision: string;
  scoreTotal?: number | null;
  livePrice?: number | null;
  sessionLabel: string;
  compactTime: string;
  timeZone: string;
  utcSecondary: string;
  story?: string | null;
  storyInput?: Parameters<typeof buildMarketStory>[0];
  ladder: LadderInput;
  plan?: {
    direction?: string | null;
    status: string;
    levels?: {
      entryPrice?: number | null;
      stopLoss?: number | null;
      tp1?: number | null;
      tp2?: number | null;
      tp3?: number | null;
    } | null;
  } | null;
  scoreComponents?: Array<{ label: string; score: number; max: number; reason?: string }>;
  reportContext?: MarketReportContext | null;
};

/** Build snapshot model from verified dashboard fields only. */
export function buildPromoSnapshotModel(input: BuildSnapshotInput): PromoSnapshotModel {
  const decision = (input.decision || "WAIT").toUpperCase();
  let story = input.story ?? null;
  if (story == null && input.storyInput) {
    const built = buildMarketStory(input.storyInput);
    story = built.insufficient ? null : built.story;
  }

  const rows = buildMarketLevelLadder(input.ladder);
  const { resistance, support } = nearestLevels(rows);
  const maxAbs = Math.max(
    1,
    ...rows.filter((r) => r.kind !== "live").map((r) => Math.abs(r.distance ?? 0))
  );

  // Prefer a compact promotional ladder — verified structure levels first
  const preferred = rows.filter((r) =>
    ["live", "poc", "vah", "val", "bar-high", "bar-low"].includes(r.kind)
  );
  const levels: SnapshotLevel[] = preferred.map((r) => ({
    price: r.price,
    classification:
      resistance?.id === r.id
        ? `Nearest Resistance · ${r.classification}`
        : support?.id === r.id
          ? `Nearest Support · ${r.classification}`
          : r.classification,
    tone: r.tone,
    strength: r.kind === "live" ? 100 : Math.round((Math.abs(r.distance ?? 0) / maxAbs) * 100),
    isLive: r.kind === "live",
    isNearestRes: resistance?.id === r.id,
    isNearestSup: support?.id === r.id
  }));

  let plan: SnapshotPlan | null = null;
  const p = input.plan;
  if (
    p &&
    (p.levels?.entryPrice != null || p.levels?.stopLoss != null || p.levels?.tp1 != null)
  ) {
    const entry = p.levels?.entryPrice ?? null;
    const stop = p.levels?.stopLoss ?? null;
    const tp1 = p.levels?.tp1 ?? null;
    plan = {
      direction: (p.direction ?? "—").toString(),
      entry,
      stopLoss: stop,
      tp1,
      tp2: p.levels?.tp2 ?? null,
      tp3: p.levels?.tp3 ?? null,
      riskReward: riskReward(entry, stop, tp1),
      status: String(p.status).replace(/_/g, " ")
    };
  }

  return {
    decision,
    analysisLabel: analysisLabelFor(decision),
    scoreTotal: input.scoreTotal ?? null,
    livePrice: input.livePrice ?? null,
    sessionLabel: input.sessionLabel,
    compactTime: input.compactTime,
    timeZone: input.timeZone,
    utcSecondary: input.utcSecondary,
    story,
    levels,
    plan,
    scoreComponents: input.scoreComponents?.map((c) => ({
      label: c.label,
      score: c.score,
      max: c.max
    })),
    reportContext: input.reportContext ?? null
  };
}

/** Safe PNG filename: GoldMeta-XAUUSD-WAIT-2026-07-22-0715.png */
export function buildSnapshotFilename(
  decision: string,
  isoOrCompact: string,
  now = new Date()
): string {
  const d = (decision || "WAIT").toUpperCase().replace(/[^A-Z0-9]/g, "") || "WAIT";
  const date = now.toISOString().slice(0, 10);
  const timeMatch = isoOrCompact.match(/(\d{1,2}):(\d{2})/);
  const hhmm = timeMatch
    ? `${timeMatch[1]!.padStart(2, "0")}${timeMatch[2]}`
    : `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  return `GoldMeta-XAUUSD-${d}-${date}-${hhmm}.png`;
}

export const LIGHT_PALETTE = {
  bg: "#F7F8FA",
  surface: "#FFFFFF",
  navy: "#11284A",
  navy2: "#1D3557",
  gold: "#D8A33D",
  text: "#1B2430",
  muted: "#667085",
  border: "#E5E8EE",
  buy: "#16A34A",
  sell: "#DC2626",
  wait: "#D97706",
  research: "#7C3AED",
  liquidity: "#0891B2",
  support: "#16A34A",
  keySupport: "#047857",
  resistance: "#E11D48",
  live: "#11284A",
  grid: "rgba(17,40,74,0.05)",
  watermark: "rgba(17,40,74,0.06)"
};

export const DARK_PALETTE = {
  ...LIGHT_PALETTE,
  bg: "#0F1724",
  surface: "#162033",
  text: "#F3F5F7",
  muted: "#98A2B3",
  border: "#2A364A",
  grid: "rgba(216,163,61,0.06)",
  watermark: "rgba(255,255,255,0.05)",
  live: "#F7F8FA"
};

export function toneColor(
  tone: string,
  palette: typeof LIGHT_PALETTE
): string {
  switch (tone) {
    case "buy":
    case "support":
      return palette.support;
    case "sell":
    case "resistance":
      return palette.resistance;
    case "wait":
      return palette.wait;
    case "poc":
      return palette.gold;
    case "vah-val":
      return palette.research;
    case "live":
      return palette.live;
    case "plan":
      return palette.research;
    default:
      return palette.muted;
  }
}
