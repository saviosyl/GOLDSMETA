/**
 * Build immutable multi-horizon GOLD_HUNTER forecast each second.
 */
import {
  GH_HORIZONS_SEC,
  GH_SHADOW_ONLY,
  GH_BROKER_EXECUTION_ENABLED,
  GH_MUTATION_SURFACE,
  GOLD_HUNTER_MODEL_VERSION,
  GOLD_HUNTER_STRATEGY_VERSION
} from "./config";
import { predictHorizon, type HorizonModelBundle } from "./model";
import { decideAction, type EntryThresholds } from "./signalPolicy";
import type { GhFeatureVector, GhForecast, GhHorizonProb, GhQuoteBook } from "./types";

export function emptyHorizonProb(horizonSec: GhForecast["horizons"][5]["horizonSec"]): GhHorizonProb {
  return {
    horizonSec,
    pUp: 1 / 3,
    pDown: 1 / 3,
    pNoEdge: 1 / 3,
    expectedNetBuy: 0,
    expectedNetSell: 0
  };
}

export function buildForecast(args: {
  book: GhQuoteBook;
  features: GhFeatureVector | null;
  bundles: HorizonModelBundle[] | null;
  dataQuality: GhForecast["dataQuality"];
  modelVersion?: string;
  strategyVersion?: string;
  thresholds?: EntryThresholds;
  researchModel?: boolean;
}): GhForecast {
  const horizons = {} as GhForecast["horizons"];
  for (const h of GH_HORIZONS_SEC) {
    const bundle = args.bundles?.find((b) => b.horizonSec === h);
    if (bundle && args.features && args.dataQuality === "OK") {
      horizons[h] = predictHorizon(bundle, args.features);
    } else {
      horizons[h] = emptyHorizonProb(h);
    }
  }

  const forecast: GhForecast = {
    timestampMs: args.book.timestampMs,
    bid: args.book.bid,
    ask: args.book.ask,
    mid: args.book.mid,
    spread: args.book.spread,
    quoteAgeMs: args.book.quoteAgeMs,
    session: args.features?.session ?? "OFF_HOURS",
    regime: args.features?.regime ?? "RANGE",
    dataQuality: args.dataQuality,
    modelVersion: args.modelVersion ?? GOLD_HUNTER_MODEL_VERSION,
    strategyVersion: args.strategyVersion ?? GOLD_HUNTER_STRATEGY_VERSION,
    horizons,
    action: "WAIT",
    huntState: args.dataQuality === "OK" ? "HUNTING" : "DATA_STALE",
    shadowOnly: GH_SHADOW_ONLY,
    brokerExecutionEnabled: GH_BROKER_EXECUTION_ENABLED,
    mutationSurface: GH_MUTATION_SURFACE
  };

  if (args.dataQuality === "OK" && args.bundles && !args.researchModel) {
    forecast.action = decideAction(forecast, args.thresholds);
  } else if (args.dataQuality === "OK" && args.bundles) {
    // RESEARCH MODEL still produces directional action for shadow research
    forecast.action = decideAction(forecast, args.thresholds);
  }

  return forecast;
}
