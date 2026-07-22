/**
 * GoldMeta V6 AutoTrade orchestration service.
 * Browser never marks intents APPROVED/ACCEPTED/OPEN/CLOSED — server only.
 * Execution input is loaded from immutable GoldMeta decision documents.
 */

import { randomUUID } from "crypto";
import { nowIso } from "../../utils/time";
import type { DecisionRecord } from "../../models/types";
import type { GoldMetaStore } from "../storage/types";
import type { AutoTradeBrokerAdapter } from "./brokerAdapter";
import { FakeIgBrokerAdapter } from "./fakeIgBrokerAdapter";
import { evaluateEligibility } from "./eligibility";
import { calculatePositionSize } from "./positionSizing";
import { redactSecrets } from "./redactSecrets";
import {
  applyEmergencyStop,
  applyLock,
  clearLock,
  remainingDailyLossCapacity,
  remainingWeeklyLossCapacity,
  refreshRiskPeriod,
  resetModeAfterRestart
} from "./riskEngine";
import type { AutoTradeStorePort } from "./autoTradeStore";
import { createExecutionOwnerId } from "./inMemoryAutoTradeStore";
import {
  AUTOTRADE_STRATEGY_VERSION,
  DEMO_ORDER_SUBMISSION_ENABLED,
  FIRST_PILOT_LIMITS,
  LIVE_EXECUTION_FEATURE_FLAG,
  buildDealReference,
  displayStatusFor,
  maskAccountId,
  type AutoTradeMode,
  type AutoTradeRiskLimits,
  type AutoTradeStatusPayload,
  type BrokerEnvironment,
  type TradeIntent,
  type TradeIntentState,
  type TradingSessionId
} from "./types";

export interface DecisionSignalInput {
  decisionId: string;
  decision: string;
  score: number | null;
  entry: number | null;
  stop: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  decisionAgeMs: number;
  session: TradingSessionId | "OTHER";
  newsBlackoutActive?: boolean;
}

export interface ExecuteResult {
  intent: TradeIntent;
  skipped: boolean;
  message: string;
}

export interface LimitUpdateOptions {
  confirmIncrease?: boolean;
  actorUserId?: string;
}

const LIVE_CONFIRMATION_PHRASE = "ENABLE LIVE AUTOTRADE";

/** Per-process restart gate shared across AutoTradeService instances. */
const autoTradeRestartUsers = new Set<string>();

const INCREASEABLE_LIMIT_KEYS: Array<keyof AutoTradeRiskLimits> = [
  "maxLossPerTrade",
  "maxMarginPerPosition",
  "maxDailyLoss",
  "maxWeeklyLoss",
  "maxOpenPositions",
  "maxTradesPerDay",
  "maxConsecutiveLosses",
  "maxSpread"
];

function mapSession(raw: string | null | undefined): TradingSessionId | "OTHER" {
  const s = (raw ?? "").toUpperCase().replace(/\s+/g, "_");
  if (s.includes("OVERLAP") || s === "LONDON_NY_OVERLAP") return "LONDON_NY_OVERLAP";
  if (s.includes("LONDON")) return "LONDON";
  if (s.includes("NEW") || s.includes("NY") || s === "NEWYORK" || s === "NEW_YORK") return "NEW_YORK";
  return "OTHER";
}

export function decisionRecordToSignal(decision: DecisionRecord): DecisionSignalInput {
  const tp = decision.takeProfits[0]?.price ?? null;
  const entry = decision.entry.price;
  const stop = decision.stopLoss.price;
  const rr =
    decision.riskReward.tp1 ??
    decision.riskReward.tp2 ??
    decision.riskReward.tp3 ??
    null;
  const generatedMs = new Date(decision.generatedAt).getTime();
  return {
    decisionId: decision.decisionId,
    decision: decision.decision,
    score: decision.setupScore,
    entry,
    stop,
    takeProfit: tp,
    riskReward: rr,
    decisionAgeMs: Number.isFinite(generatedMs) ? Math.max(0, Date.now() - generatedMs) : 0,
    session: mapSession(decision.currentSession),
    newsBlackoutActive: decision.reasonCodes.some((c) => /NEWS|BLACKOUT/i.test(c))
  };
}

export class AutoTradeService {
  private adapters = new Map<string, AutoTradeBrokerAdapter>();
  private processBootstrapped = new Set<string>();
  readonly ownerId: string;

  constructor(
    private readonly store: AutoTradeStorePort,
    private readonly adapterFactory: (env: BrokerEnvironment) => AutoTradeBrokerAdapter = (env) =>
      new FakeIgBrokerAdapter({ environment: env }),
    options: { ownerId?: string } = {}
  ) {
    this.ownerId = options.ownerId ?? createExecutionOwnerId("svc");
  }

  /** After process restart/deploy, mode must not restore — force OFF on first touch. */
  private async ensureRestartPolicy(userId: string): Promise<void> {
    if (autoTradeRestartUsers.has(userId)) {
      this.processBootstrapped.add(userId);
      return;
    }
    autoTradeRestartUsers.add(userId);
    this.processBootstrapped.add(userId);
    const risk = await this.store.getRiskState(userId);
    const lock = await this.store.getLock(userId);
    if (risk.mode !== "OFF" || (lock.locked && !risk.locked)) {
      const previousMode = risk.mode;
      let next = risk.mode !== "OFF" ? resetModeAfterRestart(risk) : { ...risk, mode: "OFF" as const };
      if (lock.locked) {
        next = {
          ...next,
          locked: true,
          lockReason: lock.reason,
          emergencyStopActive: lock.reason === "emergency_stop",
          updatedAt: nowIso()
        };
      }
      await this.store.saveRiskState(next);
      if (previousMode !== "OFF") {
        await this.audit(userId, "restart_reset_mode_off", { previousMode });
        await this.activity(
          userId,
          `Process restart: AutoTrade mode reset to OFF (was ${previousMode}).`,
          "warn"
        );
      }
    }
  }

  /** Test helper — clear process restart gate. */
  static resetRestartGateForTests(): void {
    autoTradeRestartUsers.clear();
  }

  async getStatus(userId: string): Promise<AutoTradeStatusPayload> {
    await this.ensureRestartPolicy(userId);
    let risk = refreshRiskPeriod(await this.store.getRiskState(userId));
    risk = await this.store.saveRiskState(risk);
    const settings = await this.store.getSettings(userId);
    const connection = await this.store.getConnection(userId);
    const activity = await this.store.listActivity(userId, 40);
    const adapter = this.adapters.get(userId);
    let positions: AutoTradeStatusPayload["positions"] = [];
    let marketFields: Partial<AutoTradeStatusPayload["connection"]> = {};

    if (adapter?.isConnected()) {
      try {
        const open = await adapter.getOpenPositions();
        const market = await adapter.discoverSpotGold();
        positions = open.map((p) => ({
          positionId: p.dealId,
          environment: adapter.environment,
          direction: p.direction,
          marketName: p.instrumentName,
          epic: p.epic,
          entry: p.level,
          size: p.size,
          stop: p.stopLevel,
          takeProfit: p.limitLevel,
          monetaryRisk: null,
          currentBid: market.bid,
          currentAsk: market.offer,
          unrealisedPnl: p.upl,
          score: null,
          decisionId: null,
          dealId: p.dealId,
          protectionStatus: p.guaranteedStop
            ? "GUARANTEED"
            : p.stopLevel != null
              ? "NORMAL"
              : "MISSING",
          openedAt: p.createdDate
        }));
        marketFields = {
          marketStatus: market.marketStatus,
          marketEpic: market.epic,
          marketName: market.instrumentName,
          bid: market.bid,
          ask: market.offer,
          spread: Number((market.offer - market.bid).toFixed(4)),
          minDealSize: market.minDealSize,
          sizeIncrement: market.dealSizeIncrement,
          valuePerPoint: market.valueOfOnePip
        };
        const hb = await adapter.heartbeat();
        connection.lastHeartbeatAt = hb;
        connection.connected = true;
        connection.environment = adapter.environment;
        await this.store.saveConnection(connection);
      } catch {
        // leave connection as stored
      }
    }

    const limits = settings.limits;
    return {
      displayStatus: displayStatusFor(risk.mode, risk.locked || risk.emergencyStopActive),
      mode: risk.mode,
      locked: risk.locked || risk.emergencyStopActive,
      lockReason: risk.lockReason,
      emergencyStopActive: risk.emergencyStopActive,
      liveExecutionFeatureEnabled: LIVE_EXECUTION_FEATURE_FLAG,
      connection: {
        connected: connection.connected,
        environment: connection.environment,
        accountIdMasked: maskAccountId(connection.accountId),
        accountName: connection.accountName,
        currency: connection.currency ?? limits.currency,
        balance: connection.balance,
        available: connection.available,
        marginUsed: connection.marginUsed,
        marketStatus: marketFields.marketStatus ?? null,
        marketEpic: marketFields.marketEpic ?? connection.marketEpic,
        marketName: marketFields.marketName ?? connection.marketName,
        bid: marketFields.bid ?? null,
        ask: marketFields.ask ?? null,
        spread: marketFields.spread ?? null,
        minDealSize: marketFields.minDealSize ?? null,
        sizeIncrement: marketFields.sizeIncrement ?? null,
        valuePerPoint: marketFields.valuePerPoint ?? null,
        lastHeartbeatAt: connection.lastHeartbeatAt
      },
      limits,
      budget: {
        dailyLossLimit: limits.maxDailyLoss,
        weeklyLossLimit: limits.maxWeeklyLoss,
        dailyRealisedPnl: risk.dailyRealisedPnl,
        dailyUnrealisedPnl: risk.dailyUnrealisedPnl,
        weeklyRealisedPnl: risk.weeklyRealisedPnl,
        weeklyUnrealisedPnl: risk.weeklyUnrealisedPnl,
        remainingDailyLossCapacity: remainingDailyLossCapacity(risk, limits),
        remainingWeeklyLossCapacity: remainingWeeklyLossCapacity(risk, limits),
        marginUsed: connection.marginUsed ?? 0,
        tradesUsed: risk.tradesUsedToday,
        tradesMax: limits.maxTradesPerDay,
        currency: limits.currency
      },
      positions,
      activity,
      strategyVersion: AUTOTRADE_STRATEGY_VERSION
    };
  }

  async updateLimits(
    userId: string,
    patch: Partial<AutoTradeRiskLimits>,
    opts: LimitUpdateOptions = {}
  ): Promise<AutoTradeStatusPayload> {
    const settings = await this.store.getSettings(userId);
    const current = settings.limits;
    const increases: Array<{ key: string; from: unknown; to: unknown }> = [];

    for (const key of INCREASEABLE_LIMIT_KEYS) {
      if (patch[key] === undefined) continue;
      const from = current[key];
      const to = patch[key];
      if (typeof from === "number" && typeof to === "number" && to > from) {
        increases.push({ key, from, to });
      }
      if (from == null && typeof to === "number") {
        increases.push({ key, from, to });
      }
    }

    if (increases.length > 0 && !opts.confirmIncrease) {
      throw Object.assign(
        new Error(
          "Increasing AutoTrade limits requires explicit confirmation with old and new values."
        ),
        { code: "LIMIT_INCREASE_CONFIRMATION_REQUIRED", increases }
      );
    }

    const next = {
      ...settings,
      limits: { ...settings.limits, ...patch, currency: "EUR" as const },
      updatedAt: nowIso()
    };
    await this.store.saveSettings(next);
    await this.audit(userId, increases.length ? "limits_increased" : "limits_updated", {
      patch: redactSecrets(patch),
      increases,
      actorUserId: opts.actorUserId ?? userId,
      confirmed: Boolean(opts.confirmIncrease),
      at: nowIso()
    });
    await this.activity(
      userId,
      increases.length ? "Risk limits increased (confirmed)." : "Risk limits updated.",
      "info"
    );
    return this.getStatus(userId);
  }

  async setMode(
    userId: string,
    mode: AutoTradeMode,
    opts: {
      liveConfirmationPhrase?: string;
      riskAcknowledged?: boolean;
      accountVerified?: boolean;
    } = {}
  ): Promise<AutoTradeStatusPayload> {
    await this.ensureRestartPolicy(userId);
    let risk = await this.store.getRiskState(userId);

    if (risk.locked && mode !== "OFF") {
      throw Object.assign(new Error("AutoTrade is locked. Unlock explicitly before changing mode."), {
        code: "AUTOTRADE_LOCKED"
      });
    }

    if (mode === "IG_LIVE_AUTO") {
      if (!LIVE_EXECUTION_FEATURE_FLAG) {
        throw Object.assign(
          new Error("LIVE execution is disabled by server feature flag for this release."),
          { code: "LIVE_FEATURE_DISABLED" }
        );
      }
      if (opts.liveConfirmationPhrase !== LIVE_CONFIRMATION_PHRASE) {
        throw Object.assign(
          new Error(`Type exactly: ${LIVE_CONFIRMATION_PHRASE}`),
          { code: "LIVE_CONFIRMATION_REQUIRED" }
        );
      }
      if (!opts.riskAcknowledged || !opts.accountVerified) {
        throw Object.assign(new Error("Risk limits and account verification required."), {
          code: "LIVE_ACTIVATION_INCOMPLETE"
        });
      }
    }

    risk = { ...risk, mode, updatedAt: nowIso() };
    await this.store.saveRiskState(risk);
    await this.audit(userId, "mode_set", { mode });
    await this.activity(
      userId,
      `Mode set to ${mode}.`,
      mode === "OFF" ? "warn" : "success"
    );

    if (mode === "IG_DEMO_AUTO" || mode === "IG_LIVE_AUTO") {
      await this.connectBroker(userId, mode === "IG_LIVE_AUTO" ? "LIVE" : "DEMO");
    }
    if (mode === "OFF" || mode === "SHADOW") {
      const adapter = this.adapters.get(userId);
      if (adapter) {
        await adapter.disconnect();
        this.adapters.delete(userId);
      }
    }

    return this.getStatus(userId);
  }

  async connectBroker(
    userId: string,
    environment: BrokerEnvironment,
    credentialsRef = `server:${environment.toLowerCase()}`
  ): Promise<AutoTradeStatusPayload> {
    if (environment === "LIVE") {
      throw Object.assign(new Error("LIVE broker connection is blocked for this release."), {
        code: "LIVE_ADAPTER_BLOCKED"
      });
    }

    const previous = await this.store.getConnection(userId);
    const adapter = this.adapterFactory(environment);
    try {
      await adapter.connect(credentialsRef);
      const accounts = await adapter.listAccounts();
      const account = accounts[0];
      if (!account) throw new Error("No IG accounts found");
      await adapter.selectAccount(account.accountId);
      const market = await adapter.discoverSpotGold();
      this.adapters.set(userId, adapter);

      if (
        previous.pinnedAccountId &&
        previous.pinnedAccountId !== account.accountId
      ) {
        await this.lock(userId, "account_change");
      }
      if (
        previous.pinnedMarketEpic &&
        previous.pinnedMarketEpic !== market.epic
      ) {
        await this.lock(userId, "market_epic_change");
      }

      await this.store.saveConnection({
        userId,
        environment,
        connected: true,
        accountId: account.accountId,
        accountName: account.accountName,
        currency: account.currency,
        balance: account.balance,
        available: account.available,
        marginUsed: account.marginUsed,
        marketEpic: market.epic,
        marketName: market.instrumentName,
        lastHeartbeatAt: await adapter.heartbeat(),
        credentialsRef,
        pinnedAccountId: previous.pinnedAccountId ?? account.accountId,
        pinnedMarketEpic: previous.pinnedMarketEpic ?? market.epic,
        updatedAt: nowIso()
      });
      await this.audit(userId, "broker_connected", {
        environment,
        accountIdMasked: maskAccountId(account.accountId)
      });
      await this.activity(
        userId,
        `Connected to IG ${environment} (${maskAccountId(account.accountId)}) — read-only diagnostics.`,
        "success"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "IG session failed";
      if (message === "IG_DEMO_CREDENTIALS_NOT_CONFIGURED" || message === "IG_CREDENTIALS_NOT_CONFIGURED") {
        await this.activity(userId, "IG Demo secrets are not configured (fail closed).", "error");
        throw Object.assign(new Error(message), { code: "IG_CREDENTIALS_MISSING" });
      }
      await this.lock(userId, "ig_session_failed");
      await this.activity(userId, message, "error");
      throw error;
    }
    return this.getStatus(userId);
  }

  /** Read-only DEMO diagnostics refresh (no order submission). */
  async refreshDemoDiagnostics(userId: string): Promise<AutoTradeStatusPayload> {
    await this.ensureRestartPolicy(userId);
    let adapter = this.adapters.get(userId);
    if (!adapter?.isConnected() || adapter.environment !== "DEMO") {
      await this.connectBroker(userId, "DEMO");
      adapter = this.adapters.get(userId);
    }
    if (!adapter) throw new Error("NOT_CONNECTED");
    try {
      await adapter.heartbeat();
      const accounts = await adapter.listAccounts();
      const account = accounts[0];
      const market = await adapter.discoverSpotGold();
      const connection = await this.store.getConnection(userId);

      if (connection.pinnedAccountId && account && connection.pinnedAccountId !== account.accountId) {
        await this.lock(userId, "account_change");
      }
      if (connection.pinnedMarketEpic && connection.pinnedMarketEpic !== market.epic) {
        await this.lock(userId, "market_epic_change");
      }

      await this.store.saveConnection({
        ...connection,
        connected: true,
        environment: "DEMO",
        accountId: account?.accountId ?? connection.accountId,
        accountName: account?.accountName ?? connection.accountName,
        currency: account?.currency ?? connection.currency,
        balance: account?.balance ?? null,
        available: account?.available ?? null,
        marginUsed: account?.marginUsed ?? null,
        marketEpic: market.epic,
        marketName: market.instrumentName,
        lastHeartbeatAt: nowIso(),
        updatedAt: nowIso()
      });
      await this.store.appendBrokerEvent({
        id: randomUUID(),
        userId,
        at: nowIso(),
        type: "demo_diagnostics_refresh",
        detail: redactSecrets({
          marketStatus: market.marketStatus,
          spread: market.offer - market.bid,
          minDealSize: market.minDealSize,
          guaranteedStopAvailable: market.guaranteedStopAvailable
        })
      });
    } catch (error) {
      await this.lock(userId, "ig_session_failed");
      throw error;
    }
    return this.getStatus(userId);
  }

  async emergencyStop(userId: string): Promise<AutoTradeStatusPayload> {
    let risk = await this.store.getRiskState(userId);
    risk = applyEmergencyStop(risk);
    await this.store.saveRiskState(risk);
    await this.store.saveLock({
      userId,
      locked: true,
      reason: "emergency_stop",
      lockedAt: nowIso(),
      unlockedAt: null
    });
    const adapter = this.adapters.get(userId);
    if (adapter) {
      try {
        await adapter.disconnect();
      } catch {
        /* ignore */
      }
      this.adapters.delete(userId);
    }
    await this.audit(userId, "emergency_stop", {});
    await this.activity(userId, "EMERGENCY STOP — AutoTrade locked and set to OFF.", "error");
    return this.getStatus(userId);
  }

  async unlock(userId: string): Promise<AutoTradeStatusPayload> {
    let risk = await this.store.getRiskState(userId);
    risk = { ...clearLock(risk), mode: "OFF" };
    await this.store.saveRiskState(risk);
    await this.store.saveLock({
      userId,
      locked: false,
      reason: null,
      lockedAt: null,
      unlockedAt: nowIso()
    });
    await this.audit(userId, "unlocked", {});
    await this.activity(userId, "AutoTrade unlocked. Mode remains OFF until you enable it.", "info");
    return this.getStatus(userId);
  }

  async lock(userId: string, reason: string): Promise<void> {
    let risk = await this.store.getRiskState(userId);
    risk = applyLock(risk, reason);
    await this.store.saveRiskState(risk);
    await this.store.saveLock({
      userId,
      locked: true,
      reason,
      lockedAt: nowIso(),
      unlockedAt: null
    });
    await this.audit(userId, "locked", { reason });
    await this.activity(userId, `AutoTrade locked: ${reason}`, "warn");
  }

  /**
   * Trusted path: load immutable decision from GoldMeta store, then evaluate.
   * Browser must never supply decision/score/entry/stop/TP payloads.
   */
  async evaluateFromStoredDecision(
    userId: string,
    decisionId: string,
    goldMetaStore: GoldMetaStore
  ): Promise<ExecuteResult> {
    const decision = await goldMetaStore.getDecision(userId, decisionId);
    if (!decision) {
      throw Object.assign(new Error("Decision not found"), { code: "DECISION_NOT_FOUND" });
    }
    if (decision.userId && decision.userId !== userId) {
      throw Object.assign(new Error("Decision ownership mismatch"), { code: "DECISION_FORBIDDEN" });
    }
    const signal = decisionRecordToSignal(decision);
    return this.evaluateAndMaybeExecute(userId, signal);
  }

  /**
   * Evaluate + optionally execute a server-loaded decision signal.
   * Uses Firestore/in-memory transactional lease claiming — not a process mutex.
   * SHADOW never submits. DEMO order submission gated off this release.
   * LIVE blocked by feature flag.
   */
  async evaluateAndMaybeExecute(
    userId: string,
    signal: DecisionSignalInput
  ): Promise<ExecuteResult> {
    await this.ensureRestartPolicy(userId);
    const settings = await this.store.getSettings(userId);
    let risk = refreshRiskPeriod(await this.store.getRiskState(userId));
    risk = await this.store.saveRiskState(risk);
    const connection = await this.store.getConnection(userId);
    const environment: BrokerEnvironment =
      risk.mode === "IG_LIVE_AUTO" ? "LIVE" : "DEMO";

    const dealReference = buildDealReference({
      decisionId: signal.decisionId,
      accountId: connection.accountId ?? "NO_ACCOUNT",
      strategyVersion: AUTOTRADE_STRATEGY_VERSION,
      environment
    });

    const claim = await this.store.claimIntent({
      userId,
      dealReference,
      ownerId: this.ownerId,
      create: () =>
        this.newIntent(userId, signal, dealReference, environment, risk.mode, settings.limits)
    });

    if (claim.status === "duplicate") {
      await this.activity(userId, "Duplicate decision suppressed (idempotency).", "warn", {
        dealReference,
        intentId: claim.intent.intentId
      });
      return {
        intent: claim.intent,
        skipped: true,
        message: "Duplicate decision — existing intent reused."
      };
    }

    if (claim.status === "lease_held") {
      await this.activity(userId, "Execution lease held by another instance.", "warn", {
        dealReference,
        leaseOwnerId: claim.intent.leaseOwnerId
      });
      return {
        intent: claim.intent,
        skipped: true,
        message: "Another instance holds the execution lease."
      };
    }

    let intent = claim.intent;
    try {
      return await this.evaluateClaimedIntent(userId, signal, intent, settings.limits);
    } finally {
      await this.store.releaseIntentLease(userId, intent.intentId, this.ownerId);
    }
  }

  private async evaluateClaimedIntent(
    userId: string,
    signal: DecisionSignalInput,
    claimedIntent: TradeIntent,
    limits: AutoTradeRiskLimits
  ): Promise<ExecuteResult> {
    let risk = await this.store.getRiskState(userId);
    const connection = await this.store.getConnection(userId);
    let intent = await this.transition(claimedIntent, "ELIGIBILITY_CHECK", "Starting eligibility");
    await this.store.heartbeatIntentLease(userId, intent.intentId, this.ownerId);

    const adapter = this.adapters.get(userId);
    let marketStatus: "OPEN" | "CLOSED" | "TRADEABLE" | "UNKNOWN" = "UNKNOWN";
    let quoteAgeMs = 0;
    let spread: number | null = null;
    let brokerHealthy = Boolean(adapter?.isConnected());
    let market = null as Awaited<ReturnType<AutoTradeBrokerAdapter["discoverSpotGold"]>> | null;
    let openCount = 0;

    if (adapter?.isConnected()) {
      try {
        market = await adapter.discoverSpotGold();
        marketStatus = market.marketStatus;
        quoteAgeMs = Date.now() - new Date(market.updateTime).getTime();
        spread = market.offer - market.bid;
        openCount = (await adapter.getOpenPositions()).length;

        if (connection.pinnedAccountId && connection.accountId && connection.pinnedAccountId !== connection.accountId) {
          await this.lock(userId, "account_change");
        }
        if (connection.pinnedMarketEpic && market.epic !== connection.pinnedMarketEpic) {
          await this.lock(userId, "market_epic_change");
        }

        if (marketStatus === "CLOSED") {
          await this.lock(userId, "market_closed");
        }
        if (quoteAgeMs > 60_000) {
          await this.lock(userId, "quote_stale");
        }
        if (limits.maxSpread != null && spread > limits.maxSpread) {
          await this.lock(userId, "spread_exceeds_limit");
        }
        risk = await this.store.getRiskState(userId);
      } catch {
        brokerHealthy = false;
        await this.lock(userId, "ig_session_failed");
        risk = await this.store.getRiskState(userId);
      }
    }

    const eligibility = evaluateEligibility({
      decision: signal.decision,
      score: signal.score,
      hasValidatedPlan: signal.entry != null && signal.stop != null && signal.takeProfit != null,
      stop: signal.stop,
      takeProfit: signal.takeProfit,
      entry: signal.entry,
      riskReward: signal.riskReward,
      decisionAgeMs: signal.decisionAgeMs,
      marketStatus,
      quoteAgeMs,
      spread,
      newsBlackoutActive: signal.newsBlackoutActive ?? false,
      openGoldMetaPositions: openCount,
      conflictingPosition: false,
      brokerHealthy: risk.mode === "SHADOW" ? true : brokerHealthy,
      session: signal.session,
      riskState: risk,
      limits
    });

    if (!eligibility.ok) {
      intent = {
        ...intent,
        rejectionReason: eligibility.reason,
        direction: signal.decision === "BUY" || signal.decision === "SELL" ? signal.decision : null
      };
      intent = await this.transition(intent, "BLOCKED", eligibility.reason);
      await this.activity(userId, eligibility.reason, "warn");
      return { intent, skipped: true, message: eligibility.reason };
    }

    intent = await this.transition(intent, "RISK_CHECK", "Sizing");

    if (!market || signal.entry == null || signal.stop == null || signal.takeProfit == null) {
      const reason = "Market quote or plan prices unavailable.";
      intent = { ...intent, rejectionReason: reason };
      intent = await this.transition(intent, "BLOCKED", reason);
      return { intent, skipped: true, message: reason };
    }

    const entry = signal.decision === "BUY" ? market.offer : market.bid;
    const sizing = calculatePositionSize({
      direction: signal.decision as "BUY" | "SELL",
      entryPrice: entry,
      stopPrice: signal.stop,
      takeProfitPrice: signal.takeProfit,
      maxLossPerTrade: limits.maxLossPerTrade,
      remainingDailyLossCapacity: remainingDailyLossCapacity(risk, limits),
      remainingWeeklyLossCapacity: remainingWeeklyLossCapacity(risk, limits),
      maxMarginPerPosition: limits.maxMarginPerPosition,
      availableFunds: connection.available ?? 0,
      valuePerPoint: market.valueOfOnePip,
      minDealSize: market.minDealSize,
      sizeIncrement: market.dealSizeIncrement,
      marginPerUnit: null,
      costAllowance: spread ?? 0
    });

    if (!sizing.ok) {
      intent = { ...intent, rejectionReason: sizing.reason };
      intent = await this.transition(intent, "BLOCKED", sizing.reason);
      await this.activity(userId, sizing.reason, "warn");
      return { intent, skipped: true, message: sizing.reason };
    }

    intent = {
      ...intent,
      direction: signal.decision as "BUY" | "SELL",
      size: sizing.size,
      entry,
      stop: signal.stop,
      takeProfit: signal.takeProfit,
      monetaryRisk: sizing.monetaryRisk,
      score: signal.score
    };
    intent = await this.transition(intent, "APPROVED", "Risk approved");

    if (risk.mode === "SHADOW" || risk.mode === "OFF") {
      await this.activity(
        userId,
        `SHADOW: would trade ${intent.direction} size ${sizing.size} (risk €${sizing.monetaryRisk}).`,
        "info"
      );
      return {
        intent,
        skipped: true,
        message: "Shadow mode — order not submitted."
      };
    }

    if (risk.mode === "IG_LIVE_AUTO" && !LIVE_EXECUTION_FEATURE_FLAG) {
      const reason = "LIVE execution feature flag is disabled.";
      intent = { ...intent, rejectionReason: reason };
      intent = await this.transition(intent, "BLOCKED", reason);
      return { intent, skipped: true, message: reason };
    }

    if (
      risk.mode === "IG_DEMO_AUTO" &&
      !DEMO_ORDER_SUBMISSION_ENABLED &&
      adapter &&
      adapter.name !== "fake-ig"
    ) {
      const reason =
        "IG Demo connected read-only — order submission disabled for this hardening release.";
      intent = { ...intent, rejectionReason: reason };
      intent = await this.transition(intent, "BLOCKED", reason);
      await this.activity(userId, reason, "info");
      return { intent, skipped: true, message: reason };
    }

    if (!adapter?.isConnected()) {
      const reason = "Broker not connected.";
      intent = { ...intent, rejectionReason: reason };
      intent = await this.transition(intent, "BLOCKED", reason);
      await this.lock(userId, "ig_session_failed");
      return { intent, skipped: true, message: reason };
    }

    if (
      limits.stopProtection === "GUARANTEED_REQUIRED" &&
      !adapter.supportsStopProtection("GUARANTEED_REQUIRED")
    ) {
      const reason = "Guaranteed stop required but unavailable.";
      intent = { ...intent, rejectionReason: reason };
      intent = await this.transition(intent, "BLOCKED", reason);
      await this.lock(userId, "stop_protection_failed");
      return { intent, skipped: true, message: reason };
    }

    // Remaining order-submit path kept for future DEMO_ORDER_SUBMISSION_ENABLED=true.
    // Unreachable while DEMO_ORDER_SUBMISSION_ENABLED is false.
    intent = await this.transition(intent, "SUBMITTING", "Submitting to broker");
    await this.store.heartbeatIntentLease(userId, intent.intentId, this.ownerId);

    const dealReference = intent.dealReference!;
    const orderRequest = {
      dealReference,
      epic: market.epic,
      direction: intent.direction!,
      size: sizing.size,
      orderType: "MARKET" as const,
      stopLevel: signal.stop,
      limitLevel: signal.takeProfit,
      guaranteedStop: limits.stopProtection !== "NORMAL_ALLOWED",
      forceOpen: true as const,
      currencyCode: market.currencyCode
    };

    let orderResult;
    try {
      orderResult = await adapter.placeMarketOrder(orderRequest);
    } catch (error) {
      const message = error instanceof Error ? error.message : "UNKNOWN_BROKER_ERROR";
      intent = await this.transition(intent, "RECONCILIATION_REQUIRED", message);
      await this.lock(userId, "unexpected_broker_response");
      await this.activity(
        userId,
        `Broker uncertainty (${message}). AutoTrade locked for reconciliation.`,
        "error"
      );
      try {
        const conf = await adapter.confirmDeal(dealReference);
        const positions = await adapter.getOpenPositions();
        const match = positions.find((p) => p.dealReference === dealReference);
        if (conf.status === "ACCEPTED" || match) {
          intent = {
            ...intent,
            dealId: conf.dealId ?? match?.dealId ?? null,
            dealReference
          };
          intent = await this.transition(intent, "ACCEPTED", "Recovered via reconciliation");
          intent = await this.transition(intent, "OPEN", "Position verified");
          await this.bumpTradesUsed(userId);
        }
      } catch {
        /* keep RECONCILIATION_REQUIRED */
      }
      return {
        intent,
        skipped: false,
        message: "Broker response uncertain — locked for reconciliation."
      };
    }

    await this.store.saveExecution({
      executionId: randomUUID(),
      intentId: intent.intentId,
      userId,
      dealReference: orderResult.dealReference,
      dealId: orderResult.dealId,
      accepted: orderResult.accepted,
      status: orderResult.status,
      reason: orderResult.reason,
      requestRedacted: redactSecrets({ ...orderRequest, password: "x", apiKey: "x" }),
      responseRedacted: redactSecrets(orderResult.rawRedacted),
      createdAt: nowIso()
    });

    intent = { ...intent, dealReference: orderResult.dealReference, dealId: orderResult.dealId };
    intent = await this.transition(intent, "CONFIRMING", "Confirming deal");

    if (orderResult.status === "UNKNOWN") {
      intent = await this.transition(intent, "RECONCILIATION_REQUIRED", "Unknown broker status");
      await this.lock(userId, "unexpected_broker_response");
      return { intent, skipped: false, message: "Unknown broker status — reconciliation required." };
    }

    if (!orderResult.accepted || orderResult.status === "REJECTED") {
      const reason = orderResult.reason ?? "Order rejected";
      intent = { ...intent, rejectionReason: reason };
      intent = await this.transition(intent, "REJECTED", reason);
      if (/stop/i.test(reason)) await this.lock(userId, "stop_protection_failed");
      await this.activity(userId, reason, "error");
      return { intent, skipped: false, message: reason };
    }

    const confirmation = await adapter.confirmDeal(orderResult.dealReference);
    if (confirmation.status !== "ACCEPTED") {
      intent = {
        ...intent,
        rejectionReason: confirmation.reason ?? "Confirmation not accepted"
      };
      intent = await this.transition(
        intent,
        confirmation.status === "REJECTED" ? "REJECTED" : "RECONCILIATION_REQUIRED",
        confirmation.reason ?? confirmation.status
      );
      if (confirmation.status !== "REJECTED") {
        await this.lock(userId, "unexpected_broker_response");
      }
      return {
        intent,
        skipped: false,
        message: confirmation.reason ?? "Deal not confirmed"
      };
    }

    intent = {
      ...intent,
      dealId: confirmation.dealId,
      entry: confirmation.level ?? intent.entry,
      size: confirmation.size ?? intent.size,
      stop: confirmation.stopLevel ?? intent.stop,
      takeProfit: confirmation.limitLevel ?? intent.takeProfit
    };
    intent = await this.transition(intent, "ACCEPTED", "Deal accepted");

    const positions = await adapter.getOpenPositions();
    const opened = positions.find(
      (p) => p.dealId === confirmation.dealId || p.dealReference === dealReference
    );
    if (!opened) {
      intent = await this.transition(intent, "RECONCILIATION_REQUIRED", "Position missing after accept");
      await this.lock(userId, "broker_firestore_disagree");
      return { intent, skipped: false, message: "Reconciliation required — position missing." };
    }

    if (opened.stopLevel == null) {
      intent = await this.transition(intent, "RECONCILIATION_REQUIRED", "Stop missing");
      await this.lock(userId, "stop_protection_failed");
      return { intent, skipped: false, message: "Stop protection failed after fill." };
    }

    intent = await this.transition(intent, "OPEN", "Position open and protected");
    await this.bumpTradesUsed(userId);
    await this.store.savePosition(userId, {
      positionId: opened.dealId,
      environment: adapter.environment,
      direction: opened.direction,
      marketName: opened.instrumentName,
      epic: opened.epic,
      entry: opened.level,
      size: opened.size,
      stop: opened.stopLevel,
      takeProfit: opened.limitLevel,
      monetaryRisk: intent.monetaryRisk,
      currentBid: market.bid,
      currentAsk: market.offer,
      unrealisedPnl: opened.upl,
      score: intent.score,
      decisionId: signal.decisionId,
      dealId: opened.dealId,
      protectionStatus: opened.guaranteedStop ? "GUARANTEED" : "NORMAL",
      openedAt: opened.createdDate
    });
    await this.activity(
      userId,
      `Opened ${opened.direction} ${opened.size} @ ${opened.level} (demo/auto).`,
      "success"
    );
    return { intent, skipped: false, message: "Order accepted and position open." };
  }

  private async bumpTradesUsed(userId: string): Promise<void> {
    const risk = await this.store.getRiskState(userId);
    await this.store.saveRiskState({
      ...risk,
      tradesUsedToday: risk.tradesUsedToday + 1,
      updatedAt: nowIso()
    });
  }

  private newIntent(
    userId: string,
    signal: DecisionSignalInput,
    dealReference: string,
    environment: BrokerEnvironment,
    mode: AutoTradeMode,
    limits: AutoTradeRiskLimits
  ): TradeIntent {
    const at = nowIso();
    return {
      intentId: randomUUID(),
      userId,
      decisionId: signal.decisionId,
      accountId: "pending",
      environment,
      mode,
      strategyVersion: AUTOTRADE_STRATEGY_VERSION,
      state: "CREATED",
      direction: null,
      size: null,
      entry: null,
      stop: null,
      takeProfit: null,
      monetaryRisk: null,
      score: signal.score,
      rejectionReason: null,
      dealReference,
      dealId: null,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      leaseHeartbeatAt: null,
      limitsSnapshot: { ...limits },
      createdAt: at,
      updatedAt: at,
      history: [{ state: "CREATED", at, reason: "created" }]
    };
  }

  private async transition(
    intent: TradeIntent,
    state: TradeIntentState,
    reason: string
  ): Promise<TradeIntent> {
    const at = nowIso();
    const next: TradeIntent = {
      ...intent,
      state,
      updatedAt: at,
      history: [...intent.history, { state, at, reason }]
    };
    await this.store.saveIntent(next);
    return next;
  }

  private async activity(
    userId: string,
    message: string,
    level: "info" | "warn" | "error" | "success",
    technical?: Record<string, unknown>
  ): Promise<void> {
    await this.store.appendActivity(userId, {
      id: randomUUID(),
      at: nowIso(),
      message,
      level,
      technical: technical ? redactSecrets(technical) : undefined
    });
  }

  private async audit(
    userId: string,
    action: string,
    detail: Record<string, unknown>
  ): Promise<void> {
    await this.store.appendAudit({
      id: randomUUID(),
      userId,
      at: nowIso(),
      action,
      detail: redactSecrets(detail)
    });
  }
}

export { LIVE_CONFIRMATION_PHRASE };
