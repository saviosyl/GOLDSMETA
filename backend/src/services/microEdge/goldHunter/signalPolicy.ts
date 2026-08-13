/**
 * Multi-horizon GOLD_HUNTER signal → BUY / SELL / WAIT.
 * Does NOT trade merely because p > 0.5.
 */
import {
  GH_DEFAULT_ENTRY,
  GH_MAX_ACCEPTABLE_SPREAD
} from "./config";
import type { GhAction, GhForecast } from "./types";

export type EntryThresholds = {
  pUp5: number;
  pUp15: number;
  pUp30: number;
  pDown5: number;
  pDown15: number;
  pDown30: number;
  p60OpposeMax: number;
};

export const DEFAULT_ENTRY_THRESHOLDS: EntryThresholds = {
  pUp5: GH_DEFAULT_ENTRY.pUp5,
  pUp15: GH_DEFAULT_ENTRY.pUp15,
  pUp30: GH_DEFAULT_ENTRY.pUp30,
  pDown5: GH_DEFAULT_ENTRY.pDown5,
  pDown15: GH_DEFAULT_ENTRY.pDown15,
  pDown30: GH_DEFAULT_ENTRY.pDown30,
  p60OpposeMax: GH_DEFAULT_ENTRY.p60OpposeMax
};

export function isBuyCandidate(
  forecast: GhForecast,
  thresholds: EntryThresholds = DEFAULT_ENTRY_THRESHOLDS
): boolean {
  if (forecast.dataQuality !== "OK") return false;
  if (forecast.regime === "DANGER") return false;
  if (forecast.spread > GH_MAX_ACCEPTABLE_SPREAD) return false;
  const h5 = forecast.horizons[5];
  const h15 = forecast.horizons[15];
  const h30 = forecast.horizons[30];
  const h60 = forecast.horizons[60];
  if (h5.pUp < thresholds.pUp5) return false;
  if (h15.pUp < thresholds.pUp15) return false;
  if (h30.pUp < thresholds.pUp30) return false;
  if (h60.pDown > thresholds.p60OpposeMax) return false;
  const edges = [h5.expectedNetBuy, h15.expectedNetBuy, h30.expectedNetBuy];
  if (!edges.some((e) => e > 0)) return false;
  return true;
}

export function isSellCandidate(
  forecast: GhForecast,
  thresholds: EntryThresholds = DEFAULT_ENTRY_THRESHOLDS
): boolean {
  if (forecast.dataQuality !== "OK") return false;
  if (forecast.regime === "DANGER") return false;
  if (forecast.spread > GH_MAX_ACCEPTABLE_SPREAD) return false;
  const h5 = forecast.horizons[5];
  const h15 = forecast.horizons[15];
  const h30 = forecast.horizons[30];
  const h60 = forecast.horizons[60];
  if (h5.pDown < thresholds.pDown5) return false;
  if (h15.pDown < thresholds.pDown15) return false;
  if (h30.pDown < thresholds.pDown30) return false;
  if (h60.pUp > thresholds.p60OpposeMax) return false;
  const edges = [
    h5.expectedNetSell,
    h15.expectedNetSell,
    h30.expectedNetSell
  ];
  if (!edges.some((e) => e > 0)) return false;
  return true;
}

export function decideAction(
  forecast: GhForecast,
  thresholds: EntryThresholds = DEFAULT_ENTRY_THRESHOLDS
): GhAction {
  const buy = isBuyCandidate(forecast, thresholds);
  const sell = isSellCandidate(forecast, thresholds);
  if (buy && !sell) return "BUY";
  if (sell && !buy) return "SELL";
  return "WAIT";
}

export function consecutiveAgreement(
  actions: GhAction[],
  required: number = GH_DEFAULT_ENTRY.consecutiveEvals
): GhAction {
  if (actions.length < required) return "WAIT";
  const slice = actions.slice(-required);
  if (slice.every((a) => a === "BUY")) return "BUY";
  if (slice.every((a) => a === "SELL")) return "SELL";
  return "WAIT";
}
