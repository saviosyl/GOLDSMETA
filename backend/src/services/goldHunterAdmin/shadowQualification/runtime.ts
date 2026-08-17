/**
 * Gold Hunter Clean Shadow Qualification V1 — runtime.
 *
 * Mirrors live A/B/C opportunity + openTrade/evaluateOpenExit without broker mutation.
 * Gated by GOLD_HUNTER_SHADOW_QUALIFICATION_ENABLED (default OFF).
 *
 * Independent of Demo AutoTrade gates (pause / emergency / demoAutoTradeEnabled).
 * NEVER places ProtoOANewOrderReq.
 */

import { getOwnerQueue } from "../boundedQueue";
import { loadGoldHunterConfig } from "../configStore";
import { getFrozenGhFastIdentity } from "../abc/frozenConfig";
import { getGoldHunterStrategySelector } from "../strategySelector";
import type { GoldHunterSelectedCandidate } from "../strategySelector";
import type { GoldHunterSelectorTickResult } from "../strategySelector";
import {
  getGhShadowBrokerMutationProof,
  refuseGhShadowBrokerMutation
} from "./brokerMutationGuard";
import {
  computeGhShadowPerformanceReport,
  type GhShadowPerformanceReport
} from "./performance";
import {
  getGhShadowOpenTradeId,
  resetGhShadowPositionManagerForTests,
  tickGhShadowPosition,
  tryOpenGhShadowFromOpportunity
} from "./positionManager";
import {
  GH_SHADOW_QUALIFICATION_STORAGE_PATH,
  listGhShadowTrades,
  loadGhShadowEpoch,
  resetGhShadowQualificationMemoryForTests,
  saveGhShadowEpoch
} from "./store";
import type { GhShadowQualificationEpoch } from "./types";
import { GH_SHADOW_QUALIFICATION_VERSION } from "./types";

export function isGhShadowQualificationEnabled(): boolean {
  return (
    String(process.env.GOLD_HUNTER_SHADOW_QUALIFICATION_ENABLED || "")
      .trim()
      .toLowerCase() === "true"
  );
}

export function getGhShadowStrategyConfigIdentity(): {
  strategySha: string;
  configSha: string;
  strategyVersion: string;
  engineVersion: string;
  soakLabel: string;
  hardStop: number;
  profitLockActivateMfe: number;
  profitLockFraction: number;
  trailDistance: number;
  friction: number;
} {
  const id = getFrozenGhFastIdentity();
  const c = id.config;
  return {
    strategySha: id.configSha256,
    configSha: id.configSha256,
    strategyVersion: id.strategyVersion,
    engineVersion: id.engineVersion,
    soakLabel: id.soakLabel,
    hardStop: c.hardStop,
    profitLockActivateMfe: c.profitLockActivateMfe,
    profitLockFraction: c.profitLockFraction,
    trailDistance: c.trailDistance,
    friction: c.friction
  };
}

async function runShadowTick(args: {
  ownerUid: string;
  tick: GoldHunterSelectorTickResult;
}): Promise<void> {
  if (!isGhShadowQualificationEnabled()) return;

  // Hard surface: shadow must never reach order submission.
  // If a future caller wires submitDemoMarketOrder here, refuse.
  const forbidden = (globalThis as { __ghShadowBrokerSubmitHook?: unknown })
    .__ghShadowBrokerSubmitHook;
  if (typeof forbidden === "function") {
    refuseGhShadowBrokerMutation("shadow_runtime_broker_submit_hook");
  }

  const sel = getGoldHunterStrategySelector(args.ownerUid);
  const snap = sel.getLastSnapshot();
  const bid = snap?.bestBid ?? snap?.lastSpotBid;
  const ask = snap?.bestAsk ?? snap?.lastSpotAsk;
  if (bid == null || ask == null) return;

  const dataOk =
    snap != null &&
    !snap.crossed &&
    !snap.derivedDataContaminated &&
    snap.depthValidity === "DEPTH_VALID";

  // Always tick open shadow first (mirror Demo position manager cadence).
  if (getGhShadowOpenTradeId(args.ownerUid)) {
    await tickGhShadowPosition({
      ownerUid: args.ownerUid,
      bid,
      ask,
      features: snap?.features ?? null,
      dataOk,
      receiveSeq:
        args.tick.opportunity?.latestReceiveSeq ??
        args.tick.candidate?.latestReceiveSeq ??
        0
    });
  }

  // Open only on NEW executable opportunity — same signal Demo would see.
  if (args.tick.newOpportunity && args.tick.opportunity) {
    const config = await loadGoldHunterConfig(args.ownerUid);
    await tryOpenGhShadowFromOpportunity({
      ownerUid: args.ownerUid,
      opportunity: args.tick.opportunity,
      config,
      marketFresh: dataOk && snap?.features != null
    });
  }
}

/**
 * Enqueue shadow work off the quote hot path. Never blocks Spot/Depth ingestion.
 * Never calls Demo execution / broker mutation paths.
 */
export function enqueueGhShadowQualificationTick(args: {
  ownerUid: string;
  tick: GoldHunterSelectorTickResult;
}): boolean {
  if (!isGhShadowQualificationEnabled()) return false;
  if (args.ownerUid.trim() === "") return false;
  const q = getOwnerQueue("gh-shadow-qual", args.ownerUid, 2);
  const oppId =
    args.tick.opportunity?.opportunityId ??
    args.tick.candidate?.opportunityId ??
    null;
  return q.enqueue(
    async () => {
      await runShadowTick(args);
    },
    { opportunityId: oppId }
  );
}

export async function drainGhShadowQualificationForTests(
  ownerUid: string
): Promise<void> {
  await getOwnerQueue("gh-shadow-qual", ownerUid, 2).drainForTests();
}

export async function buildGhShadowQualificationStatus(
  ownerUid: string
): Promise<{
  enabled: boolean;
  version: typeof GH_SHADOW_QUALIFICATION_VERSION;
  storagePath: typeof GH_SHADOW_QUALIFICATION_STORAGE_PATH;
  identity: ReturnType<typeof getGhShadowStrategyConfigIdentity>;
  epoch: GhShadowQualificationEpoch | null;
  performance: GhShadowPerformanceReport;
  brokerMutationProof: ReturnType<typeof getGhShadowBrokerMutationProof>;
  openShadowTradeId: string | null;
  demoAutoTradeNote: string;
}> {
  const identity = getGhShadowStrategyConfigIdentity();
  const epoch = await loadGhShadowEpoch(ownerUid);
  const trades = await listGhShadowTrades(ownerUid, {
    formalOnly: false,
    limit: 2000
  });
  const performance = computeGhShadowPerformanceReport(trades);
  return {
    enabled: isGhShadowQualificationEnabled(),
    version: GH_SHADOW_QUALIFICATION_VERSION,
    storagePath: GH_SHADOW_QUALIFICATION_STORAGE_PATH,
    identity,
    epoch,
    performance,
    brokerMutationProof: getGhShadowBrokerMutationProof(),
    openShadowTradeId: getGhShadowOpenTradeId(ownerUid),
    demoAutoTradeNote:
      "Shadow qualification is independent of Demo AutoTrade. " +
      "demoAutoTradeEnabled / pauseNewEntries / emergencyStopActive are NOT " +
      "modified by this research path. Broker NewOrder count remains 0."
  };
}

export async function updateGhShadowReplayStatus(
  ownerUid: string,
  status: "LIVE_REPLAY_OK" | "LIVE_REPLAY_DIVERGENCE"
): Promise<void> {
  const epoch = await loadGhShadowEpoch(ownerUid);
  if (!epoch) return;
  epoch.lastReplayStatus = status;
  epoch.updatedAt = new Date().toISOString();
  await saveGhShadowEpoch(ownerUid, epoch);
}

/** Test helpers */
export function resetGhShadowQualificationRuntimeForTests(): void {
  resetGhShadowPositionManagerForTests();
  resetGhShadowQualificationMemoryForTests();
}

export type { GoldHunterSelectedCandidate };
