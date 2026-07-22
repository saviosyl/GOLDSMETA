/**
 * GoldMeta V6 AutoTrade orchestration service.
 * Browser never marks intents APPROVED/ACCEPTED/OPEN/CLOSED — server only.
 */

import { randomUUID } from "crypto";
import { nowIso } from "../../utils/time";
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
import {
  AUTOTRADE_STRATEGY_VERSION,
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

const LIVE_CONFIRMATION_PHRASE = "ENABLE LIVE AUTOTRADE";

export class AutoTradeService {
  private adapters = new Map<string, AutoTradeBrokerAdapter>();
  private processBootstrapped = new Set<string>();

  constructor(
    private readonly store: AutoTradeStorePort,
    private readonly adapterFactory: (env: BrokerEnvironment) => AutoTradeBrokerAdapter = (env) =>
      new FakeIgBrokerAdapter({ environment: env })
  ) {}

  /** Ensure mode resets to OFF after process restart (in-memory bootstrap). */
  private async ensureRestartPolicy(userId: string): Promise<void> {
    if (this.processBootstrapped.has(userId)) return;
    this.processBootstrapped.add(userId);
    // First touch in this process: do not restore LIVE. Mode defaults OFF in store.
    const risk = await this.store.getRiskState(userId);
    if (risk.mode === "IG_LIVE_AUTO") {
      await this.store.saveRiskState(resetModeAfterRestart(risk));
      await this.audit(userId, "restart_cleared_live_mode", {});
    }
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
    patch: Partial<AutoTradeRiskLimits>
  ): Promise<AutoTradeStatusPayload> {
    const settings = await this.store.getSettings(userId);
    const next = {
      ...settings,
      limits: { ...settings.limits, ...patch, currency: "EUR" as const },
      updatedAt: nowIso()
    };
    // Forbidden behaviours stay enforced regardless of client patch
    await this.store.saveSettings(next);
    await this.audit(userId, "limits_updated", { patch: redactSecrets(patch) });
    await this.activity(userId, "Risk limits updated.", "info");
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
    if (environment === "LIVE" && !LIVE_EXECUTION_FEATURE_FLAG) {
      // Allow scaffolding connection UI but adapter must not place LIVE orders.
      await this.activity(
        userId,
        "LIVE connection scaffolding only — execution feature flag is OFF.",
        "warn"
      );
    }

    const adapter = this.adapterFactory(environment);
    try {
      await adapter.connect(credentialsRef);
      const accounts = await adapter.listAccounts();
      const account = accounts[0];
      if (!account) throw new Error("No IG accounts found");
      await adapter.selectAccount(account.accountId);
      const market = await adapter.discoverSpotGold();
      this.adapters.set(userId, adapter);
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
        updatedAt: nowIso()
      });
      await this.audit(userId, "broker_connected", {
        environment,
        accountIdMasked: maskAccountId(account.accountId)
      });
      await this.activity(
        userId,
        `Connected to IG ${environment} (${maskAccountId(account.accountId)}).`,
        "success"
      );
    } catch (error) {
      await this.lock(userId, "ig_session_failed");
      await this.activity(
        userId,
        error instanceof Error ? error.message : "IG session failed",
        "error"
      );
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
   * Evaluate + optionally execute a decision.
   * SHADOW never submits. DEMO uses adapter. LIVE blocked by feature flag.
   */
  async evaluateAndMaybeExecute(
    userId: string,
    signal: DecisionSignalInput
  ): Promise<ExecuteResult> {
    return this.store.withUserLock(userId, () => this.evaluateAndMaybeExecuteLocked(userId, signal));
  }

  private async evaluateAndMaybeExecuteLocked(
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

    const existing = await this.store.getIntentByDealReference(userId, dealReference);
    if (existing) {
      await this.activity(userId, "Duplicate decision suppressed (idempotency).", "warn", {
        dealReference,
        intentId: existing.intentId
      });
      return {
        intent: existing,
        skipped: true,
        message: "Duplicate decision — existing intent reused."
      };
    }

    let intent = this.newIntent(userId, signal, dealReference, environment, risk.mode, settings.limits);
    intent = await this.transition(intent, "ELIGIBILITY_CHECK", "Starting eligibility");

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
        if (marketStatus === "CLOSED") {
          await this.lock(userId, "market_closed");
        }
        if (quoteAgeMs > 60_000) {
          await this.lock(userId, "quote_stale");
        }
        if (
          settings.limits.maxSpread != null &&
          spread > settings.limits.maxSpread
        ) {
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
      limits: settings.limits
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

    const entry =
      signal.decision === "BUY" ? market.offer : market.bid;
    const sizing = calculatePositionSize({
      direction: signal.decision as "BUY" | "SELL",
      entryPrice: entry,
      stopPrice: signal.stop,
      takeProfitPrice: signal.takeProfit,
      maxLossPerTrade: settings.limits.maxLossPerTrade,
      remainingDailyLossCapacity: remainingDailyLossCapacity(risk, settings.limits),
      remainingWeeklyLossCapacity: remainingWeeklyLossCapacity(risk, settings.limits),
      maxMarginPerPosition: settings.limits.maxMarginPerPosition,
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

    if (!adapter?.isConnected()) {
      const reason = "Broker not connected.";
      intent = { ...intent, rejectionReason: reason };
      intent = await this.transition(intent, "BLOCKED", reason);
      await this.lock(userId, "ig_session_failed");
      return { intent, skipped: true, message: reason };
    }

    if (
      settings.limits.stopProtection === "GUARANTEED_REQUIRED" &&
      !adapter.supportsStopProtection("GUARANTEED_REQUIRED")
    ) {
      const reason = "Guaranteed stop required but unavailable.";
      intent = { ...intent, rejectionReason: reason };
      intent = await this.transition(intent, "BLOCKED", reason);
      await this.lock(userId, "stop_protection_failed");
      return { intent, skipped: true, message: reason };
    }

    intent = await this.transition(intent, "SUBMITTING", "Submitting to broker");

    const orderRequest = {
      dealReference,
      epic: market.epic,
      direction: intent.direction!,
      size: sizing.size,
      orderType: "MARKET" as const,
      stopLevel: signal.stop,
      limitLevel: signal.takeProfit,
      guaranteedStop: settings.limits.stopProtection !== "NORMAL_ALLOWED",
      forceOpen: true as const,
      currencyCode: market.currencyCode
    };

    let orderResult;
    try {
      orderResult = await adapter.placeMarketOrder(orderRequest);
    } catch (error) {
      const message = error instanceof Error ? error.message : "UNKNOWN_BROKER_ERROR";
      // Never blindly retry — reconcile
      intent = await this.transition(intent, "RECONCILIATION_REQUIRED", message);
      await this.lock(userId, "unexpected_broker_response");
      await this.activity(
        userId,
        `Broker uncertainty (${message}). AutoTrade locked for reconciliation.`,
        "error"
      );
      // Attempt confirm + positions
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
