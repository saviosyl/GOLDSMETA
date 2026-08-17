/**
 * Frozen formal sizing snapshot — loaded once at READY, not per tick.
 */
import { createHash } from "crypto";
import {
  PEPPERSTONE_CTRADER_XAUUSD_DEMO
} from "../../broker/ctrader/brokerUnitMappings";
import type { GoldHunterAdminConfig } from "../types";
import type { GhShadowFrozenSizingSnapshot } from "./types";
import { GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS } from "./economics";

export function hashAdminSizingConfig(snap: Omit<GhShadowFrozenSizingSnapshot, "adminSizingConfigSha" | "snappedAt">): string {
  const canonical = JSON.stringify(snap, Object.keys(snap).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

export function buildFrozenSizingSnapshot(args: {
  config: GoldHunterAdminConfig;
  minLots?: number;
  maxLots?: number;
  lotStep?: number;
  ozPerLot?: number;
  valuePerPointPerLot?: number;
  quoteCurrency?: string;
  depositCurrency?: string;
  quoteToDepositRate?: number | null;
  quoteToDepositRateSource?: string | null;
  symbolMetadataProvenance?: string;
}): GhShadowFrozenSizingSnapshot {
  const base = {
    allocatedCapitalEur: args.config.allocatedCapitalEur,
    riskPerTradePct: args.config.riskPerTradePct,
    dailyLossLimitPct: args.config.dailyLossLimitPct,
    maxOpenTrades: args.config.maxOpenTrades,
    minLots: args.minLots ?? GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.minLots,
    maxLots: args.maxLots ?? GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.maxLots,
    lotStep: args.lotStep ?? GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.lotStep,
    ozPerLot: args.ozPerLot ?? PEPPERSTONE_CTRADER_XAUUSD_DEMO.ozPerLot,
    valuePerPointPerLot:
      args.valuePerPointPerLot ??
      GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.valuePerPointPerLot,
    protocolCentsPerLot: PEPPERSTONE_CTRADER_XAUUSD_DEMO.protocolCentsPerLot,
    mappingKey: PEPPERSTONE_CTRADER_XAUUSD_DEMO.key,
    quoteCurrency:
      args.quoteCurrency ?? GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.quoteCurrency,
    depositCurrency:
      args.depositCurrency ??
      GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.depositCurrency,
    quoteToDepositRate:
      args.quoteToDepositRate != null && args.quoteToDepositRate > 0
        ? args.quoteToDepositRate
        : null,
    quoteToDepositRateSource: args.quoteToDepositRateSource ?? null,
    symbolMetadataProvenance:
      args.symbolMetadataProvenance ??
      GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.provenance
  };
  return {
    ...base,
    adminSizingConfigSha: hashAdminSizingConfig(base),
    snappedAt: new Date().toISOString()
  };
}

export function sizingSnapshotChanged(
  a: GhShadowFrozenSizingSnapshot,
  b: GhShadowFrozenSizingSnapshot
): boolean {
  return a.adminSizingConfigSha !== b.adminSizingConfigSha;
}
