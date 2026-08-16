/**
 * Gold Hunter Demo AutoExecution runtime — production call site for
 * attemptGoldHunterDemoExecution. Worker-driven only (not UI polling).
 */
import { loadDemoXauUsdSymbol } from "../broker/ctrader/demoPositionMutations";
import { getSharedXauusdQuote } from "../marketFeed/sharedMarketData";
import { loadOwnerAuthConfig } from "../auth/ownerAuthConfig";
import { getOwnerQueue, resetOwnerQueuesForTests } from "./boundedQueue";
import { loadGoldHunterConfig } from "./configStore";
import {
  attemptGoldHunterDemoExecution,
  type OrchestratorDeps,
  type OrchestratorResult
} from "./executionOrchestrator";
import type { GoldHunterSelectedCandidate } from "./strategySelector";
import type { BrokerSymbol } from "../broker/domain";

function isPinnedOwnerAdmin(ownerUid: string): boolean {
  const pinned = loadOwnerAuthConfig().pinnedOwnerUid;
  return Boolean(pinned && pinned === ownerUid);
}

const FEED_STALE_MS = 45_000;

export type DemoAutoExecutionEnqueueResult = {
  enqueued: boolean;
  reason:
    | "ENQUEUED"
    | "NOT_NEW_OPPORTUNITY"
    | "QUEUE_FULL"
    | "NO_OPPORTUNITY";
};

type RuntimeHooks = {
  attempt?: typeof attemptGoldHunterDemoExecution;
  loadSymbol?: (ownerUid: string) => Promise<BrokerSymbol | null>;
  isAdmin?: (ownerUid: string) => Promise<boolean>;
};

let hooks: RuntimeHooks = {};

export function setGoldHunterDemoAutoExecutionHooksForTests(
  h: RuntimeHooks
): void {
  hooks = h;
}

export function resetGoldHunterDemoAutoExecutionForTests(): void {
  hooks = {};
  resetOwnerQueuesForTests();
}

/**
 * Called from market-data hot path when selector reports newOpportunity.
 * Never blocks on broker — enqueues bounded async work.
 */
export function enqueueGoldHunterDemoAutoExecution(args: {
  ownerUid: string;
  newOpportunity: boolean;
  opportunity: GoldHunterSelectedCandidate | null;
}): DemoAutoExecutionEnqueueResult {
  if (!args.newOpportunity || !args.opportunity) {
    return {
      enqueued: false,
      reason: args.opportunity ? "NOT_NEW_OPPORTUNITY" : "NO_OPPORTUNITY"
    };
  }
  const opportunity = args.opportunity;
  const q = getOwnerQueue("gh-demo-exec", args.ownerUid, 2);
  const ok = q.enqueue(async () => {
    await runGoldHunterDemoAutoExecution(args.ownerUid, opportunity);
  });
  return {
    enqueued: ok,
    reason: ok ? "ENQUEUED" : "QUEUE_FULL"
  };
}

/**
 * Production body: load config → OFF means no order → else orchestrator.
 */
export async function runGoldHunterDemoAutoExecution(
  ownerUid: string,
  opportunity: GoldHunterSelectedCandidate,
  depsOverride?: Partial<OrchestratorDeps>
): Promise<OrchestratorResult | { ok: false; skipped: string }> {
  const config = await loadGoldHunterConfig(ownerUid);
  if (!config.demoAutoTradeEnabled) {
    return { ok: false, skipped: "WAIT — AUTOTRADE OFF" };
  }

  const attempt = hooks.attempt ?? attemptGoldHunterDemoExecution;
  const loadSymbol = hooks.loadSymbol ?? loadDemoXauUsdSymbol;
  const checkAdmin =
    hooks.isAdmin ??
    (async (uid: string) => isPinnedOwnerAdmin(uid));

  const symbol =
    depsOverride?.symbol ?? (await loadSymbol(ownerUid));
  if (!symbol) {
    return {
      ok: false,
      submitted: false,
      blockers: ["WAIT — SIZING METADATA UNAVAILABLE"],
      signalId: opportunity.signalId
    };
  }

  const quote = await getSharedXauusdQuote();
  const marketOpen = quote?.marketStatus === "OPEN";
  const ageMs =
    quote?.updatedAt != null
      ? Date.now() - Date.parse(quote.updatedAt)
      : quote?.quote?.ageMs ?? null;
  const feedFresh =
    ageMs != null && Number.isFinite(ageMs) && ageMs <= FEED_STALE_MS;

  const isAdmin =
    depsOverride?.isAdmin ?? (await checkAdmin(ownerUid));

  return attempt(ownerUid, opportunity, {
    isAdmin,
    marketOpen: depsOverride?.marketOpen ?? marketOpen,
    feedFresh: depsOverride?.feedFresh ?? feedFresh,
    symbol,
    placeOrder: depsOverride?.placeOrder,
    beforeBrokerSubmit: depsOverride?.beforeBrokerSubmit
  });
}

/** Test helper — wait for owner's execution queue to drain. */
export async function drainGoldHunterDemoAutoExecutionForTests(
  ownerUid: string
): Promise<void> {
  await getOwnerQueue("gh-demo-exec", ownerUid, 2).drainForTests();
}

export function goldHunterDemoExecQueueStats(ownerUid: string) {
  return getOwnerQueue("gh-demo-exec", ownerUid, 2).stats();
}

// Re-export for call-site discovery / grepping.
export { attemptGoldHunterDemoExecution };
