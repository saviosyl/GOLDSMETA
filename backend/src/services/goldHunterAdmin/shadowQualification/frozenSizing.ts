/**
 * Frozen formal sizing snapshot — loaded once at READY, not per tick.
 * Formal qualification requires authoritative broker symbol metadata.
 * Fallback Pepperstone defaults are for isolated unit tests only.
 */
import { createHash } from "crypto";
import {
  PEPPERSTONE_CTRADER_XAUUSD_DEMO
} from "../../broker/ctrader/brokerUnitMappings";
import { loadGoldHunterDemoXauUsdSymbol } from "../../broker/ctrader/workerSymbolMetadataCache";
import { metadataFromBrokerSymbol } from "../instrumentMetadata";
import type { GoldHunterAdminConfig } from "../types";
import type { GhShadowFrozenSizingSnapshot } from "./types";
import { GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS } from "./economics";

export function hashAdminSizingConfig(
  snap: Omit<GhShadowFrozenSizingSnapshot, "adminSizingConfigSha" | "snappedAt">
): string {
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
  symbolId?: string | null;
  metadataSource?: string | null;
  metadataLoadedAt?: string | null;
  accountMatched?: boolean;
  environment?: "DEMO" | "LIVE" | null;
  protocolCentsPerLot?: number;
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
    protocolCentsPerLot:
      args.protocolCentsPerLot ?? PEPPERSTONE_CTRADER_XAUUSD_DEMO.protocolCentsPerLot,
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
      GH_SHADOW_PEPPERSTONE_VOLUME_DEFAULTS.provenance,
    symbolId: args.symbolId ?? null,
    metadataSource: args.metadataSource ?? null,
    metadataLoadedAt: args.metadataLoadedAt ?? null,
    accountMatched: args.accountMatched ?? false,
    environment: args.environment ?? null
  };
  return {
    ...base,
    adminSizingConfigSha: hashAdminSizingConfig(base),
    snappedAt: new Date().toISOString()
  };
}

/** Unit-test-only defaults — never used for formal READY without explicit allow. */
export function buildUnitTestFrozenSizingSnapshot(args: {
  config: GoldHunterAdminConfig;
  quoteToDepositRate?: number | null;
  quoteToDepositRateSource?: string | null;
  minLots?: number;
  maxLots?: number;
  lotStep?: number;
  valuePerPointPerLot?: number;
  sizingProvenance?: string;
}): GhShadowFrozenSizingSnapshot {
  return buildFrozenSizingSnapshot({
    config: args.config,
    quoteToDepositRate: args.quoteToDepositRate ?? null,
    quoteToDepositRateSource: args.quoteToDepositRateSource ?? null,
    minLots: args.minLots,
    maxLots: args.maxLots,
    lotStep: args.lotStep,
    valuePerPointPerLot: args.valuePerPointPerLot,
    symbolMetadataProvenance:
      args.sizingProvenance ??
      "UNIT_TEST_DEFAULTS_ONLY — not formal authoritative metadata",
    symbolId: "UNIT_TEST",
    metadataSource: "UNIT_TEST_DEFAULTS",
    metadataLoadedAt: new Date().toISOString(),
    accountMatched: true,
    environment: "DEMO"
  });
}

export type GhShadowAuthoritativeSizingLoadResult =
  | { ok: true; frozen: GhShadowFrozenSizingSnapshot }
  | {
      ok: false;
      blocker: "SIZING_METADATA_UNAVAILABLE";
      detail: string;
    };

/**
 * Load + freeze authoritative Gold Hunter Demo XAUUSD symbol metadata once at READY.
 * Formal qualification MUST NOT start when this fails.
 */
export async function loadAndFreezeAuthoritativeSizing(args: {
  ownerUid: string;
  config: GoldHunterAdminConfig;
  quoteToDepositRate?: number | null;
  quoteToDepositRateSource?: string | null;
}): Promise<GhShadowAuthoritativeSizingLoadResult> {
  const loaded = await loadGoldHunterDemoXauUsdSymbol(args.ownerUid);
  const diag = loaded.diagnostics;
  if (
    !loaded.symbol ||
    !diag.available ||
    diag.accountMatched !== true ||
    diag.environment !== "DEMO"
  ) {
    return {
      ok: false,
      blocker: "SIZING_METADATA_UNAVAILABLE",
      detail: `symbol=${loaded.symbol != null} available=${diag.available} accountMatched=${diag.accountMatched} env=${diag.environment}`
    };
  }
  const meta = metadataFromBrokerSymbol(loaded.symbol);
  if (!meta.complete) {
    return {
      ok: false,
      blocker: "SIZING_METADATA_UNAVAILABLE",
      detail: `incomplete_metadata missing=${meta.missing.join(",")}`
    };
  }
  return {
    ok: true,
    frozen: buildFrozenSizingSnapshot({
      config: args.config,
      minLots: meta.minLots,
      maxLots: meta.maxLots,
      lotStep: meta.lotStep,
      ozPerLot: meta.ozPerLot,
      valuePerPointPerLot: meta.valuePerPointPerLot,
      protocolCentsPerLot: PEPPERSTONE_CTRADER_XAUUSD_DEMO.protocolCentsPerLot,
      quoteToDepositRate: args.quoteToDepositRate ?? null,
      quoteToDepositRateSource: args.quoteToDepositRateSource ?? null,
      symbolMetadataProvenance: `AUTHORITATIVE:${diag.source ?? "unknown"}`,
      symbolId: meta.symbolId,
      metadataSource: diag.source,
      metadataLoadedAt: diag.loadedAt ?? new Date().toISOString(),
      accountMatched: true,
      environment: "DEMO"
    })
  };
}

export function sizingSnapshotChanged(
  a: GhShadowFrozenSizingSnapshot,
  b: GhShadowFrozenSizingSnapshot
): boolean {
  return a.adminSizingConfigSha !== b.adminSizingConfigSha;
}
