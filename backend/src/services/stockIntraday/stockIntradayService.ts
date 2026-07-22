/**
 * Stocks Intraday AutoTrade orchestration service.
 * Separate from IG Gold CFD AutoTrade. Long-only Invest. No per-trade approval.
 */

import { randomUUID } from "crypto";
import { nowIso } from "../../utils/time";
import {
  DEFAULT_STOCK_INTRADAY_LIMITS,
  STOCK_INTRADAY_STRATEGY_VERSION,
  T212_LIVE_EXECUTION_FEATURE_FLAG,
  T212_PAPER_ORDER_SUBMISSION_ENABLED,
  displayStatusForStockMode,
  type StockIntradayMode,
  type StockStrategyProfile
} from "./featureFlags";
import {
  SAFETY_STATEMENT,
  type RankedIntradayOpportunity,
  type StockIntradayStatusPayload,
  type StockManagedPosition,
  type StockTradeIntent,
  type StockTradingViewSignal
} from "./types";
import type { MarketDataProvider } from "./marketData/marketDataProvider";
import { UnconfiguredMarketDataProvider } from "./marketData/marketDataProvider";
import type { T212BrokerAdapter } from "./broker/t212BrokerAdapter";
import { FakeT212BrokerAdapter } from "./broker/fakeT212BrokerAdapter";
import {
  rankIntradayOpportunity,
  selectTopQualifyingOpportunity
} from "./ranking/rankingEngine";
import { calculateStockPositionSize } from "./risk/positionSizing";
import {
  applyKillSwitch,
  applyLock,
  canActivateMode,
  clearLock,
  createDefaultRiskState,
  dayKeyUtc,
  evaluateEntryGates,
  refreshRiskPeriod,
  resetModeAfterRestart,
  validateRiskLimits
} from "./risk/riskEngine";
import {
  assertTransition,
  buildIntentIdempotencyKey,
  requiresReconciliation
} from "./stateMachine";
import {
  isStaleSignal,
  isUnsupportedStrategy,
  parseStockTradingViewSignal,
  type StockSignalRecord
} from "./signalIngestion";
import { redactSecrets } from "./redact";
import type { StockIntradayStorePort } from "./stockIntradayStore";

const restartUsers = new Set<string>();

export class StockIntradayService {
  private adapters = new Map<string, T212BrokerAdapter>();
  private lastSignal = new Map<string, StockTradingViewSignal | null>();
  private lastMarketDataAt = new Map<string, string | null>();
  private lastRanked = new Map<string, RankedIntradayOpportunity[]>();
  private lastRejected = new Map<string, Array<{ symbol: string; reason: string; at: string }>>();
  private marketDataReady: boolean;

  constructor(
    private readonly store: StockIntradayStorePort,
    private readonly marketData: MarketDataProvider = new UnconfiguredMarketDataProvider(),
    private readonly adapterFactory: () => T212BrokerAdapter = () =>
      new FakeT212BrokerAdapter({ environment: "PAPER" })
  ) {
    this.marketDataReady = marketData.capabilities.isMock
      ? true
      : marketData.capabilities.providerId !== "unconfigured";
  }

  static resetRestartGateForTests(): void {
    restartUsers.clear();
  }

  private async ensureRestartPolicy(userId: string): Promise<void> {
    if (restartUsers.has(userId)) return;
    restartUsers.add(userId);
    let risk = await this.store.getRiskState(userId);
    if (risk.mode !== "OFF") {
      const previous = risk.mode;
      risk = resetModeAfterRestart(risk);
      await this.store.saveRiskState(risk);
      await this.activity(userId, `Restart: mode reset to OFF (was ${previous}). New entries paused.`, "warn");
    }
  }

  async getStatus(userId: string): Promise<StockIntradayStatusPayload> {
    await this.ensureRestartPolicy(userId);
    let risk = refreshRiskPeriod(await this.store.getRiskState(userId));
    risk = await this.store.saveRiskState(risk);
    const settings = await this.store.getSettings(userId);
    const positions = await this.store.listPositions(userId);
    const activity = await this.store.listActivity(userId, 40);
    const shadowTrades = await this.store.listShadowTrades(userId);
    const adapter = this.adapters.get(userId);

    let cash: number | null = null;
    let available: number | null = null;
    let total: number | null = null;
    let pendingOrders: StockIntradayStatusPayload["pendingOrders"] = [];
    let heartbeat: string | null = null;
    let connected = false;

    if (adapter?.isConnected()) {
      try {
        const summary = await adapter.getAccountSummary();
        cash = summary.cash;
        available = summary.availableToTrade;
        total = summary.totalValue;
        pendingOrders = (await adapter.getPendingOrders()).map((o) => ({
          orderId: o.id,
          symbol: o.ticker,
          side: o.side,
          quantity: Math.abs(o.quantity),
          type: o.type,
          status: o.status
        }));
        heartbeat = await adapter.heartbeat();
        connected = true;
      } catch {
        connected = false;
      }
    }

    const limits = settings.limits;
    return {
      displayStatus: displayStatusForStockMode(risk.mode, risk.locked, risk.paused),
      mode: risk.mode,
      locked: risk.locked,
      lockReason: risk.lockReason,
      paused: risk.paused,
      emergencyStopActive: risk.emergencyStopActive,
      killSwitchActive: risk.killSwitchActive,
      paperOrderSubmissionEnabled: T212_PAPER_ORDER_SUBMISSION_ENABLED,
      liveExecutionFeatureEnabled: T212_LIVE_EXECUTION_FEATURE_FLAG,
      marketDataProviderReady: this.marketDataReady && !this.marketData.capabilities.isMock
        ? this.marketData.capabilities.providerId !== "unconfigured"
        : this.marketData.capabilities.isMock,
      engineRunning: risk.mode !== "OFF" && !risk.paused && !risk.locked,
      marketSession: "UNKNOWN",
      connection: {
        connected,
        environment: adapter?.environment ?? null,
        environmentLabel:
          adapter?.environment === "LIVE" ? "T212 LIVE — BLOCKED" : "T212 PAPER — ORDERS DISABLED",
        cash,
        availableToTrade: available,
        totalValue: total,
        lastHeartbeatAt: heartbeat,
        connectionState: connected ? "Connected" : "Disconnected"
      },
      limits,
      universe: settings.universe,
      budget: {
        dailyCapitalAllocation: limits.dailyCapitalAllocation,
        dailyCapitalRemaining: Math.max(0, limits.dailyCapitalAllocation - risk.dailyAllocationUsed),
        dailyRealisedPnl: risk.dailyRealisedPnl,
        dailyUnrealisedPnl: risk.dailyUnrealisedPnl,
        dailyLossRemaining: Math.max(0, limits.maxDailyLoss + Math.min(0, risk.dailyRealisedPnl)),
        tradesUsed: risk.tradesUsedToday,
        tradesMax: limits.maxTradesPerDay,
        cash,
        currency: limits.currency
      },
      rankedOpportunities: this.lastRanked.get(userId) ?? [],
      positions,
      pendingOrders,
      rejectedRecently: this.lastRejected.get(userId) ?? [],
      shadowTrades,
      activity,
      lastTradingViewAlert: this.lastSignal.get(userId) ?? null,
      lastMarketDataAt: this.lastMarketDataAt.get(userId) ?? null,
      strategyVersion: STOCK_INTRADAY_STRATEGY_VERSION,
      safetyStatement: SAFETY_STATEMENT
    };
  }

  async updateLimits(
    userId: string,
    patch: Partial<typeof DEFAULT_STOCK_INTRADAY_LIMITS>
  ): Promise<StockIntradayStatusPayload> {
    const settings = await this.store.getSettings(userId);
    const nextLimits = { ...settings.limits, ...patch, currency: "EUR" as const };
    const errors = validateRiskLimits(nextLimits);
    if (errors.length) {
      throw Object.assign(new Error(`Invalid risk settings: ${errors.join(", ")}`), {
        code: "INVALID_LIMITS"
      });
    }
    await this.store.saveSettings({
      ...settings,
      limits: nextLimits,
      updatedAt: nowIso()
    });
    await this.audit(userId, "limits_updated", redactSecrets(patch));
    await this.activity(userId, "Stock Intraday risk limits updated.", "info");
    return this.getStatus(userId);
  }

  async setMode(userId: string, mode: StockIntradayMode): Promise<StockIntradayStatusPayload> {
    await this.ensureRestartPolicy(userId);
    let risk = await this.store.getRiskState(userId);
    if (risk.locked && mode !== "OFF") {
      throw Object.assign(new Error("Locked — unlock before changing mode."), {
        code: "STOCK_AUTOTRADE_LOCKED"
      });
    }

    const settings = await this.store.getSettings(userId);

    if (mode === "T212_LIVE_AUTO") {
      throw Object.assign(new Error("LIVE Stock AutoTrade is hard-blocked for this release."), {
        code: "LIVE_FEATURE_DISABLED"
      });
    }

    if (mode === "T212_PAPER_AUTO" && !T212_PAPER_ORDER_SUBMISSION_ENABLED) {
      const limitErrors = validateRiskLimits(settings.limits);
      if (limitErrors.length) {
        throw Object.assign(new Error(`Invalid risk settings: ${limitErrors.join(", ")}`), {
          code: "INVALID_LIMITS"
        });
      }
      // Architecture-only: allow selecting mode for UI preview but keep paused + no orders.
      risk = {
        ...risk,
        mode,
        paused: true,
        updatedAt: nowIso()
      };
      await this.store.saveRiskState(risk);
      await this.activity(
        userId,
        "T212_PAPER_AUTO selected — order submission disabled by feature flag. Engine remains paused.",
        "warn"
      );
      await this.audit(userId, "mode_set_paper_disabled", { mode });
      return this.getStatus(userId);
    }

    const gate = canActivateMode(mode, settings.limits, {
      paperSubmissionEnabled: T212_PAPER_ORDER_SUBMISSION_ENABLED,
      liveExecutionEnabled: T212_LIVE_EXECUTION_FEATURE_FLAG,
      marketDataReady: mode === "SHADOW" || mode === "OFF" ? true : this.marketDataReady
    });
    if (!gate.ok) {
      throw Object.assign(new Error(gate.reason ?? "Mode activation blocked"), {
        code: "MODE_ACTIVATION_BLOCKED"
      });
    }

    if (mode !== "OFF" && mode !== "SHADOW") {
      const limitErrors = validateRiskLimits(settings.limits);
      if (limitErrors.length) {
        throw Object.assign(new Error("Mandatory risk settings invalid"), {
          code: "INVALID_LIMITS"
        });
      }
    }

    risk = { ...risk, mode, paused: mode === "OFF", updatedAt: nowIso() };
    await this.store.saveRiskState(risk);
    await this.audit(userId, "mode_set", { mode });
    await this.activity(userId, `Stocks Intraday mode set to ${mode}.`, mode === "OFF" ? "warn" : "success");
    return this.getStatus(userId);
  }

  async connectPaper(userId: string): Promise<StockIntradayStatusPayload> {
    let adapter: T212BrokerAdapter;
    try {
      adapter = this.adapterFactory();
      if (adapter.environment !== "PAPER") {
        throw Object.assign(new Error("Adapter environment mismatch"), { code: "ENV_MISMATCH" });
      }
      await adapter.connect("server:t212-paper");
      this.adapters.set(userId, adapter);
      await this.activity(userId, "Connected to Trading 212 Paper (read-only / orders disabled).", "success");
      await this.audit(userId, "t212_paper_connected", {});
    } catch (error) {
      const message = error instanceof Error ? error.message : "CONNECT_FAILED";
      const code = (error as { code?: string }).code;
      await this.activity(userId, message, "error");
      if (code === "ENV_MISMATCH") throw error;
      if (message === "T212_CREDENTIALS_NOT_CONFIGURED" || message.includes("CREDENTIALS")) {
        throw Object.assign(new Error(message), { code: "T212_CREDENTIALS_MISSING" });
      }
      throw Object.assign(new Error(message), { code: code ?? "CONNECT_FAILED" });
    }
    return this.getStatus(userId);
  }

  async disconnect(userId: string): Promise<StockIntradayStatusPayload> {
    const adapter = this.adapters.get(userId);
    if (adapter) {
      await adapter.disconnect();
      this.adapters.delete(userId);
    }
    await this.activity(userId, "Disconnected from Trading 212.", "info");
    return this.getStatus(userId);
  }

  async emergencyStop(userId: string): Promise<StockIntradayStatusPayload> {
    let risk = await this.store.getRiskState(userId);
    risk = applyKillSwitch(risk);
    await this.store.saveRiskState(risk);
    await this.audit(userId, "kill_switch", {});
    await this.activity(
      userId,
      "EMERGENCY STOP — new entries halted. GoldMeta positions remain visible; personal holdings untouched.",
      "error"
    );
    return this.getStatus(userId);
  }

  async unlock(userId: string): Promise<StockIntradayStatusPayload> {
    let risk = await this.store.getRiskState(userId);
    risk = { ...clearLock(risk), mode: "OFF" };
    await this.store.saveRiskState(risk);
    await this.activity(userId, "Unlocked. Mode OFF until explicitly enabled.", "info");
    return this.getStatus(userId);
  }

  /**
   * Fast webhook acknowledgement path — validates + queues, does not run full analysis.
   */
  async acknowledgeStockSignal(
    userId: string,
    body: unknown
  ): Promise<{ accepted: boolean; code: string; signalId?: string }> {
    const parsed = parseStockTradingViewSignal(body);
    if (!parsed.ok) {
      return { accepted: false, code: parsed.code };
    }
    const signal = parsed.signal;
    if (await this.store.hasAlertId(userId, signal.alertId)) {
      return { accepted: false, code: "DUPLICATE_ALERT" };
    }
    if (isStaleSignal(signal, 5 * 60_000)) {
      const record = this.signalRecord(userId, signal, "REJECTED", "STALE", "IGNORED");
      await this.store.saveSignal(record);
      return { accepted: false, code: "STALE_ALERT" };
    }
    const settings = await this.store.getSettings(userId);
    if (isUnsupportedStrategy(signal.strategyId, settings.allowedStrategyIds)) {
      const record = this.signalRecord(userId, signal, "REJECTED", "UNSUPPORTED", "IGNORED");
      await this.store.saveSignal(record);
      return { accepted: false, code: "UNSUPPORTED_STRATEGY" };
    }

    const record = this.signalRecord(userId, signal, "QUEUED", "PENDING", "PENDING");
    await this.store.saveSignal(record);
    this.lastSignal.set(userId, signal);
    // Async processing (same tick for tests; production would enqueue a job)
    void this.processQueuedSignal(userId, record.id, signal).catch(async (err) => {
      await this.activity(
        userId,
        `Signal processing failed: ${err instanceof Error ? err.message : "error"}`,
        "error"
      );
    });
    return { accepted: true, code: "QUEUED", signalId: record.id };
  }

  async processQueuedSignal(
    userId: string,
    signalId: string,
    signal: StockTradingViewSignal
  ): Promise<StockIntradayStatusPayload> {
    const existing = await this.store.getSignalByAlertId(userId, signal.alertId);
    if (existing) {
      existing.processingStatus = "PROCESSING";
      existing.updatedAt = nowIso();
      await this.store.saveSignal(existing);
    }

    if (signal.action === "EXIT_LONG") {
      await this.handleExitSignal(userId, signal);
      if (existing) {
        existing.processingStatus = "PROCESSED";
        existing.decisionStatus = "EXIT";
        existing.updatedAt = nowIso();
        await this.store.saveSignal(existing);
      }
      return this.getStatus(userId);
    }

    if (signal.action !== "ENTRY_LONG") {
      if (existing) {
        existing.processingStatus = "PROCESSED";
        existing.decisionStatus = "IGNORED";
        existing.updatedAt = nowIso();
        await this.store.saveSignal(existing);
      }
      return this.getStatus(userId);
    }

    const result = await this.evaluateEntryFromSignal(userId, signal);
    if (existing) {
      existing.processingStatus = "PROCESSED";
      existing.decisionStatus =
        result.outcome === "BUY" ? "BUY" : result.outcome === "WAIT" ? "WAIT" : "BLOCKED";
      existing.updatedAt = nowIso();
      await this.store.saveSignal(existing);
    }
    void signalId;
    return this.getStatus(userId);
  }

  async evaluateEntryFromSignal(
    userId: string,
    signal: StockTradingViewSignal
  ): Promise<{ outcome: "BUY" | "WAIT" | "BLOCKED"; message: string; intentId?: string }> {
    await this.ensureRestartPolicy(userId);
    let risk = refreshRiskPeriod(await this.store.getRiskState(userId));
    const settings = await this.store.getSettings(userId);
    const positions = await this.store.listPositions(userId);

    if (risk.mode === "OFF") {
      return { outcome: "BLOCKED", message: "BLOCKED — mode OFF" };
    }

    let quote;
    let indicators;
    try {
      quote = await this.marketData.getQuote(signal.symbol);
      indicators = await this.marketData.getIndicators(signal.symbol);
      this.lastMarketDataAt.set(userId, quote.asOf);
    } catch (error) {
      const message = error instanceof Error ? error.message : "MARKET_DATA_FAILURE";
      await this.lock(userId, "market_data_failure");
      return { outcome: "BLOCKED", message: `BLOCKED — ${message}` };
    }

    if (!this.marketData.isFresh(quote.asOf, 60_000)) {
      this.pushRejected(userId, signal.symbol, "BLOCKED — stale data");
      return { outcome: "BLOCKED", message: "BLOCKED — stale data" };
    }

    const adapter = this.adapters.get(userId);
    let instrumentType: "STOCK" | "ETF" | "OTHER" = "STOCK";
    if (adapter?.isConnected()) {
      const instruments = await adapter.listInstruments(signal.symbol);
      const match = instruments.find((i) => i.ticker.toUpperCase() === signal.symbol.toUpperCase());
      if (!match) {
        return { outcome: "BLOCKED", message: "BLOCKED — instrument unavailable on Trading 212" };
      }
      if (match.type === "OTHER" || match.suspended || !match.tradable) {
        return { outcome: "BLOCKED", message: "BLOCKED — instrument not an eligible stock/ETF" };
      }
      instrumentType = match.type;
    }

    const strategy = mapStrategy(signal.strategyId);
    const ranked = rankIntradayOpportunity({
      symbol: signal.symbol,
      instrumentKind: instrumentType === "ETF" ? "ETF" : "STOCK",
      strategy,
      quote,
      indicators,
      signal,
      limits: settings.limits
    });
    this.lastRanked.set(userId, [ranked]);
    const top = selectTopQualifyingOpportunity([ranked]);

    const cooldownUntil = await this.store.getSymbolCooldown(userId, signal.symbol);
    const symbolCooldownActive = Boolean(cooldownUntil && Date.parse(cooldownUntil) > Date.now());

    const gate = evaluateEntryGates({
      mode: risk.mode,
      risk,
      limits: settings.limits,
      universe: settings.universe,
      opportunity: top,
      quote,
      indicators,
      openPositionCount: positions.length,
      hasSymbolPosition: positions.some((p) => p.symbol === signal.symbol),
      symbolCooldownActive,
      minutesToClose: 120,
      estimatedSlippageBps: 5,
      instrumentType
    });

    if (!gate.allow) {
      this.pushRejected(userId, signal.symbol, gate.message ?? "BLOCKED");
      await this.activity(userId, gate.message ?? "Blocked", "warn");
      return {
        outcome: gate.code === "DOES_NOT_QUALIFY" ? "WAIT" : "BLOCKED",
        message: gate.message ?? "BLOCKED"
      };
    }

    const opportunity = top!;
    const cash = (await adapter?.getAccountSummary())?.availableToTrade ?? 2000;
    const sizing = calculateStockPositionSize({
      estimatedEntry: opportunity.estimatedEntry,
      stop: opportunity.stop,
      limits: settings.limits,
      availableCash: cash,
      dailyAllocationRemaining: Math.max(
        0,
        settings.limits.dailyCapitalAllocation - risk.dailyAllocationUsed
      ),
      portfolioExposureUsed: positions.reduce((s, p) => s + p.quantity * p.entryPrice, 0),
      symbolExposureUsed: 0,
      minTradeQuantity: 0.001
    });

    if (!sizing.ok) {
      this.pushRejected(userId, signal.symbol, sizing.reason ?? "Sizing failed");
      return { outcome: "WAIT", message: `WAIT — ${sizing.reason}` };
    }

    const intent = this.buildIntent(userId, signal, opportunity, sizing.quantity, sizing.estimatedCost);
    const idempotencyKey = buildIntentIdempotencyKey({
      userId,
      symbol: signal.symbol,
      strategy: opportunity.strategy,
      signalOrBarTimestamp: signal.barTime ?? signal.timestamp,
      side: "BUY",
      tradingDate: dayKeyUtc()
    });

    const reserved = await this.store.reserveIntent(intent, idempotencyKey);
    if (!reserved) {
      return { outcome: "BLOCKED", message: "BLOCKED — duplicate signal / intent" };
    }

    assertTransition("CANDIDATE", "VALIDATING");
    intent.state = "VALIDATING";
    assertTransition("VALIDATING", "APPROVED");
    intent.state = "APPROVED";
    assertTransition("APPROVED", "ENTRY_RESERVED");
    intent.state = "ENTRY_RESERVED";
    intent.updatedAt = nowIso();
    await this.store.saveIntent(intent);

    if (risk.mode === "SHADOW") {
      await this.store.appendShadowTrade(userId, {
        symbol: signal.symbol,
        side: "BUY",
        quantity: sizing.quantity,
        note: "SHADOW hypothetical entry — no broker order"
      });
      intent.state = "CLOSED";
      intent.outcome = "BUY";
      intent.updatedAt = nowIso();
      await this.store.saveIntent(intent);
      await this.activity(
        userId,
        `SHADOW BUY ${sizing.quantity} ${signal.symbol} @ ~${opportunity.estimatedEntry}`,
        "success"
      );
      return { outcome: "BUY", message: "SHADOW BUY recorded", intentId: intent.intentId };
    }

    // PAPER / LIVE — submission flags false: do not place orders
    if (risk.mode === "T212_PAPER_AUTO") {
      if (!T212_PAPER_ORDER_SUBMISSION_ENABLED) {
        intent.state = "CANCELLED";
        intent.blockReason = "T212_PAPER_ORDER_SUBMISSION_DISABLED";
        intent.updatedAt = nowIso();
        await this.store.saveIntent(intent);
        await this.activity(
          userId,
          "Paper Auto intent reserved then cancelled — submission flag is false.",
          "warn"
        );
        return {
          outcome: "BLOCKED",
          message: "BLOCKED — Paper order submission disabled",
          intentId: intent.intentId
        };
      }
    }

    if (risk.mode === "T212_LIVE_AUTO") {
      intent.state = "LOCKED";
      intent.blockReason = "T212_LIVE_EXECUTION_DISABLED";
      await this.store.saveIntent(intent);
      return { outcome: "BLOCKED", message: "BLOCKED — Live execution disabled" };
    }

    return { outcome: "WAIT", message: "WAIT — no execution path" };
  }

  /**
   * Exit only GoldMeta-managed positions — never personal holdings.
   */
  async handleExitSignal(userId: string, signal: StockTradingViewSignal): Promise<void> {
    const positions = await this.store.listPositions(userId);
    const managed = positions.filter(
      (p) => p.symbol === signal.symbol && p.goldMetaManaged === true
    );
    if (!managed.length) {
      await this.activity(
        userId,
        `EXIT_LONG ignored for ${signal.symbol} — no GoldMeta-managed position.`,
        "info"
      );
      return;
    }
    for (const position of managed) {
      await this.requestExit(userId, position, "TV_EXIT_LONG");
    }
  }

  async requestExit(
    userId: string,
    position: StockManagedPosition,
    reason: StockTradeIntent["exitReason"]
  ): Promise<void> {
    if (!position.goldMetaManaged) {
      throw Object.assign(new Error("Refusing to manage non-GoldMeta position"), {
        code: "NOT_GOLDMETA_POSITION"
      });
    }
    const risk = await this.store.getRiskState(userId);
    if (risk.mode === "SHADOW") {
      await this.store.appendShadowTrade(userId, {
        symbol: position.symbol,
        side: "SELL",
        quantity: position.quantity,
        note: `SHADOW exit: ${reason}`
      });
      await this.store.deletePosition(userId, position.positionId);
      await this.activity(userId, `SHADOW SELL ${position.quantity} ${position.symbol} (${reason})`, "success");
      return;
    }

    if (!T212_PAPER_ORDER_SUBMISSION_ENABLED && !T212_LIVE_EXECUTION_FEATURE_FLAG) {
      await this.activity(
        userId,
        `Exit requested for ${position.symbol} (${reason}) — order submission disabled; position kept visible.`,
        "warn"
      );
      return;
    }
  }

  /**
   * Startup reconciliation — new entries stay paused until complete.
   */
  async reconcileOnStartup(userId: string): Promise<StockIntradayStatusPayload> {
    let risk = await this.store.getRiskState(userId);
    risk = { ...risk, paused: true, updatedAt: nowIso() };
    await this.store.saveRiskState(risk);

    const adapter = this.adapters.get(userId);
    const openIntents = await this.store.listOpenIntents(userId);
    const ambiguous: string[] = [];

    if (adapter?.isConnected()) {
      const [brokerOrders, brokerPositions] = await Promise.all([
        adapter.getPendingOrders(),
        adapter.getPositions()
      ]);
      for (const intent of openIntents) {
        if (requiresReconciliation(intent.state) || intent.state === "ENTRY_UNKNOWN") {
          const matchOrder = brokerOrders.find((o) => o.id === intent.brokerOrderId);
          const matchPos = brokerPositions.find((p) => p.ticker === intent.symbol);
          if (!matchOrder && !matchPos && intent.state === "ENTRY_UNKNOWN") {
            ambiguous.push(intent.symbol);
            intent.state = "LOCKED";
            await this.store.saveIntent(intent);
          }
        }
      }
    }

    for (const symbol of ambiguous) {
      await this.lock(userId, `reconciliation:${symbol}`);
    }

    await this.activity(
      userId,
      ambiguous.length
        ? `Reconciliation locked symbols: ${ambiguous.join(", ")}`
        : "Reconciliation complete — new entries remain paused until you resume.",
      ambiguous.length ? "warn" : "info"
    );
    return this.getStatus(userId);
  }

  async runShadowScan(
    userId: string,
    symbols: string[],
    strategy: StockStrategyProfile = "MOMENTUM_BREAKOUT"
  ): Promise<StockIntradayStatusPayload> {
    const settings = await this.store.getSettings(userId);
    const ranked: RankedIntradayOpportunity[] = [];
    for (const symbol of symbols.slice(0, settings.universe.maxScannedCandidates)) {
      try {
        const quote = await this.marketData.getQuote(symbol);
        const indicators = await this.marketData.getIndicators(symbol);
        this.lastMarketDataAt.set(userId, quote.asOf);
        ranked.push(
          rankIntradayOpportunity({
            symbol,
            instrumentKind: "STOCK",
            strategy,
            quote,
            indicators,
            signal: null,
            limits: settings.limits
          })
        );
      } catch {
        this.pushRejected(userId, symbol, "Market data unavailable");
      }
    }
    ranked.sort((a, b) => b.overallScore - a.overallScore);
    this.lastRanked.set(userId, ranked);
    const top = selectTopQualifyingOpportunity(ranked);
    await this.activity(
      userId,
      top
        ? `Ranked Intraday Opportunities: top qualifying ${top.symbol} (${top.overallScore})`
        : "WAIT — no valid intraday opportunity",
      top ? "success" : "info"
    );
    return this.getStatus(userId);
  }

  private buildIntent(
    userId: string,
    signal: StockTradingViewSignal,
    opportunity: RankedIntradayOpportunity,
    quantity: number,
    reservedCash: number
  ): StockTradeIntent {
    return {
      intentId: randomUUID(),
      userId,
      symbol: signal.symbol,
      environment: "PAPER",
      strategy: opportunity.strategy,
      signalAlertId: signal.alertId,
      barTimestamp: signal.barTime ?? signal.timestamp,
      side: "BUY",
      state: "CANDIDATE",
      quantity,
      estimatedEntry: opportunity.estimatedEntry,
      stop: opportunity.stop,
      takeProfit: opportunity.takeProfit,
      reservedCash,
      brokerOrderId: null,
      filledQuantity: 0,
      averageFillPrice: null,
      outcome: null,
      blockReason: null,
      exitReason: null,
      goldMetaManaged: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      leaseOwner: null,
      leaseExpiresAt: null
    };
  }

  private signalRecord(
    userId: string,
    signal: StockTradingViewSignal,
    delivery: StockSignalRecord["deliveryStatus"],
    processing: StockSignalRecord["processingStatus"],
    decision: StockSignalRecord["decisionStatus"]
  ): StockSignalRecord {
    return {
      id: randomUUID(),
      userId,
      alertId: signal.alertId,
      deliveryStatus: delivery,
      processingStatus: processing,
      decisionStatus: decision,
      signal,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
  }

  private pushRejected(userId: string, symbol: string, reason: string): void {
    const list = this.lastRejected.get(userId) ?? [];
    list.unshift({ symbol, reason, at: nowIso() });
    this.lastRejected.set(userId, list.slice(0, 20));
  }

  private async lock(userId: string, reason: string): Promise<void> {
    let risk = await this.store.getRiskState(userId);
    risk = applyLock(risk, reason);
    await this.store.saveRiskState(risk);
    await this.audit(userId, "locked", { reason });
  }

  private async activity(
    userId: string,
    message: string,
    level: "info" | "warn" | "error" | "success"
  ): Promise<void> {
    await this.store.appendActivity(userId, { at: nowIso(), message, level });
  }

  private async audit(
    userId: string,
    action: string,
    detail: Record<string, unknown>
  ): Promise<void> {
    await this.store.appendAudit({ userId, action, detail: redactSecrets(detail) });
  }
}

function mapStrategy(strategyId: string): StockStrategyProfile {
  const s = strategyId.toUpperCase();
  if (s.includes("VWAP")) return "VWAP_RECLAIM";
  if (s.includes("PULLBACK")) return "PULLBACK_IN_TREND";
  if (s.includes("ORB") || s.includes("OPENING")) return "OPENING_RANGE_BREAKOUT";
  if (s.includes("RVOL") || s.includes("RELATIVE")) return "RELATIVE_VOLUME_BREAKOUT";
  return "MOMENTUM_BREAKOUT";
}

void createDefaultRiskState;
