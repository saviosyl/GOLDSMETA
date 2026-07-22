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
import type { StockIntradayJob, StockIntradayStorePort } from "./stockIntradayStore";
import {
  currentDeploymentGeneration,
  emptyDashboardSnapshot,
  generateWebhookSecret,
  hashWebhookSecret
} from "./stockIntradayStore";
import {
  estimateMinutesToClose,
  estimateSlippageBpsFromQuote
} from "./sessionClock";
import { processStockIntradayJob } from "./processStockIntradayJob";

export class StockIntradayService {
  /** Optional UI-session adapter cache — durable jobs never rely on this alone. */
  private adapters = new Map<string, T212BrokerAdapter>();
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

  /** Test helper — resets persistent restart gate for a user. */
  static async resetRestartGateForTests(
    store: StockIntradayStorePort,
    userId = "u1"
  ): Promise<void> {
    await store.saveRestartGate({
      userId,
      entriesPaused: true,
      lastReconciledAt: null,
      deploymentGeneration: currentDeploymentGeneration(),
      reconciledGeneration: null,
      updatedAt: nowIso()
    });
    await store.saveDashboardSnapshot(emptyDashboardSnapshot(userId));
  }

  /**
   * Per-invocation Paper read-only adapter from server-side secrets/factory.
   * Does not persist credentials. Works on cold starts without UI Connect.
   */
  async resolveBrokerAdapter(userId: string): Promise<T212BrokerAdapter> {
    const cached = this.adapters.get(userId);
    if (cached?.isConnected()) return cached;
    const adapter = this.adapterFactory();
    await adapter.connect(`server:durable:${userId}`);
    this.adapters.set(userId, adapter);
    return adapter;
  }

  /**
   * Persistent deployment generation gate — safe across concurrent CF instances.
   * Same generation + already-reconciled SHADOW does not re-pause.
   * Paper/Live stay paused / reset on generation change.
   */
  private async ensureRestartPolicy(userId: string): Promise<void> {
    const generation = currentDeploymentGeneration();
    const gate = await this.store.getRestartGate(userId);
    let risk = await this.store.getRiskState(userId);

    if (gate.deploymentGeneration === generation) {
      // Same deploy generation — do not re-pause an already reconciled SHADOW engine.
      if (
        risk.mode === "SHADOW" &&
        gate.reconciledGeneration === generation &&
        !gate.entriesPaused
      ) {
        return;
      }
      if (gate.reconciledGeneration === generation) {
        return;
      }
      // Generation matches but not yet reconciled for this deploy — keep paused.
      return;
    }

    // New deployment generation: pause entries and require reconciliation.
    if (risk.mode !== "OFF" && risk.mode !== "SHADOW") {
      const previous = risk.mode;
      risk = resetModeAfterRestart(risk);
      await this.store.saveRiskState(risk);
      await this.activity(
        userId,
        `Deployment generation change: mode reset to OFF (was ${previous}). New entries paused.`,
        "warn"
      );
    } else if (risk.mode === "SHADOW") {
      risk = { ...risk, paused: true, updatedAt: nowIso() };
      await this.store.saveRiskState(risk);
    }

    await this.store.saveRestartGate({
      userId,
      entriesPaused: true,
      lastReconciledAt: gate.lastReconciledAt,
      deploymentGeneration: generation,
      reconciledGeneration: null,
      updatedAt: nowIso()
    });
  }

  private async persistDashboard(
    userId: string,
    patch: Partial<{
      lastTradingViewAlert: StockTradingViewSignal | null;
      lastRankedOpportunities: RankedIntradayOpportunity[];
      rejectedRecently: Array<{ symbol: string; reason: string; at: string }>;
      lastMarketDataAt: string | null;
    }>
  ): Promise<void> {
    const current = await this.store.getDashboardSnapshot(userId);
    await this.store.saveDashboardSnapshot({
      ...current,
      ...patch,
      userId,
      updatedAt: nowIso()
    });
  }

  private async pushRejected(userId: string, symbol: string, reason: string): Promise<void> {
    const current = await this.store.getDashboardSnapshot(userId);
    const rejectedRecently = [
      { symbol, reason, at: nowIso() },
      ...current.rejectedRecently
    ].slice(0, 20);
    await this.persistDashboard(userId, { rejectedRecently });
  }

  async getStatus(userId: string): Promise<StockIntradayStatusPayload> {
    await this.ensureRestartPolicy(userId);
    let risk = refreshRiskPeriod(await this.store.getRiskState(userId));
    risk = await this.store.saveRiskState(risk);
    const settings = await this.store.getSettings(userId);
    const positions = await this.store.listPositions(userId);
    const activity = await this.store.listActivity(userId, 40);
    const shadowTrades = await this.store.listShadowTrades(userId);
    const dashboard = await this.store.getDashboardSnapshot(userId);

    let cash: number | null = null;
    let available: number | null = null;
    let total: number | null = null;
    let pendingOrders: StockIntradayStatusPayload["pendingOrders"] = [];
    let heartbeat: string | null = null;
    let connected = false;

    try {
      const adapter = await this.resolveBrokerAdapter(userId);
      if (adapter.isConnected()) {
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
      }
    } catch {
      connected = false;
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
        environment: connected ? "PAPER" : null,
        environmentLabel:
          "T212 PAPER — ORDERS DISABLED",
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
      rankedOpportunities: dashboard.lastRankedOpportunities,
      positions,
      pendingOrders,
      rejectedRecently: dashboard.rejectedRecently,
      shadowTrades,
      activity,
      lastTradingViewAlert: dashboard.lastTradingViewAlert,
      lastMarketDataAt: dashboard.lastMarketDataAt,
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
    if (mode === "SHADOW") {
      await this.registerForScheduler(userId);
    }
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
   * Fast webhook acknowledgement — authenticate happens at the route layer.
   * Validates payload, atomically rejects duplicate alert IDs, stores signal,
   * creates a durable processing job, and returns without running analysis.
   */
  async acknowledgeStockSignal(
    userId: string,
    body: unknown
  ): Promise<{ accepted: boolean; code: string; signalId?: string; jobId?: string }> {
    const parsed = parseStockTradingViewSignal(body);
    if (!parsed.ok) {
      return { accepted: false, code: parsed.code };
    }
    const signal = parsed.signal;

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
    const reserved = await this.store.reserveAlert(userId, signal.alertId, record);
    if (reserved === "duplicate") {
      return { accepted: false, code: "DUPLICATE_ALERT" };
    }

    await this.persistDashboard(userId, { lastTradingViewAlert: signal });
    const job = await this.store.createJob({
      jobId: `sig_${signal.alertId.slice(0, 48)}_${Date.now()}`,
      userId,
      kind: "PROCESS_SIGNAL",
      signalId: record.id,
      alertId: signal.alertId,
      maxAttempts: 5,
      payload: { alertId: signal.alertId, signalId: record.id }
    });

    return { accepted: true, code: "QUEUED", signalId: record.id, jobId: job.jobId };
  }

  /** Process a durable job by id (claim + execute). Idempotent under duplicate triggers. */
  async processDurableJobById(userId: string, jobId: string): Promise<StockIntradayJob | null> {
    return processStockIntradayJob(userId, jobId, {
      store: this.store,
      service: this
    });
  }

  /**
   * Automatic retry pass used by the retry scheduler.
   * Claims only due QUEUED jobs (nextAttemptAt <= now).
   */
  async runJobRetryPass(nowMs = Date.now()): Promise<Array<{ userId: string; jobId: string; state: string | null }>> {
    const due = await this.store.listDueRetryJobs(nowMs);
    const results: Array<{ userId: string; jobId: string; state: string | null }> = [];
    for (const item of due) {
      const job = await this.processDurableJobById(item.userId, item.jobId);
      results.push({ userId: item.userId, jobId: item.jobId, state: job?.state ?? null });
    }
    return results;
  }

  /** Execute claimed durable job work. */
  async executeDurableJob(job: StockIntradayJob): Promise<void> {
    switch (job.kind) {
      case "PROCESS_SIGNAL": {
        const alertIdRaw = job.alertId ?? job.payload.alertId;
        const alertId = typeof alertIdRaw === "string" ? alertIdRaw : "";
        const signalRec = alertId
          ? await this.store.getSignalByAlertId(job.userId, alertId)
          : null;
        if (!signalRec) {
          throw new Error("SIGNAL_NOT_FOUND");
        }
        await this.processQueuedSignal(job.userId, signalRec.id, signalRec.signal);
        return;
      }
      case "SCHEDULED_SCAN":
        await this.runAutonomousScan(job.userId);
        return;
      case "MONITOR_POSITIONS":
        await this.monitorOpenPositions(job.userId);
        return;
      case "MARKET_CLOSE_SWEEP":
        await this.marketCloseSweep(job.userId);
        return;
      case "RECONCILE":
        await this.reconcileOnStartup(job.userId);
        return;
      default: {
        const kind = String(job.kind);
        throw new Error(`UNKNOWN_JOB_KIND:${kind}`);
      }
    }
  }

  /**
   * Create TradingView webhook capability URL.
   * Auth is the unguessable path connectionId (TradingView cannot set custom headers;
   * official docs forbid passwords/credentials in the alert body).
   */
  async createWebhookConnection(
    userId: string,
    label = "TradingView Stocks"
  ): Promise<{ connectionId: string; webhookPath: string; webhookUrlTemplate: string }> {
    const connectionId = generateWebhookSecret().replace(/^gm_stock_/, "gm_si_");
    await this.store.saveWebhookConnection({
      connectionId,
      userId,
      secretHash: hashWebhookSecret(connectionId),
      label,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      failureCount: 0,
      lockedUntil: null
    });
    await this.audit(userId, "stock_webhook_created", { connectionId, label });
    const webhookPath = `/webhooks/stock-intraday/${connectionId}`;
    return {
      connectionId,
      webhookPath,
      webhookUrlTemplate: `https://<CLOUD_FUNCTIONS_HOST>${webhookPath}`
    };
  }

  /**
   * Authenticate TradingView webhook via opaque connectionId path only.
   * Rejects query-string tokens. Never expects secrets/passwords/T212 keys in body.
   */
  async authenticateWebhook(
    connectionId: string,
    options?: { queryTokenPresent?: boolean }
  ): Promise<{ ok: true; userId: string } | { ok: false; code: string; status: number }> {
    if (options?.queryTokenPresent) {
      return { ok: false, code: "QUERY_TOKEN_REJECTED", status: 400 };
    }
    if (!connectionId || connectionId.length < 16) {
      return { ok: false, code: "WEBHOOK_NOT_FOUND", status: 401 };
    }
    const conn = await this.store.getWebhookConnection(connectionId);
    if (!conn) {
      return { ok: false, code: "WEBHOOK_NOT_FOUND", status: 401 };
    }
    if (conn.lockedUntil && Date.parse(conn.lockedUntil) > Date.now()) {
      return { ok: false, code: "WEBHOOK_AUTH_LOCKED", status: 429 };
    }
    await this.store.clearWebhookAuthFailures(connectionId);
    return { ok: true, userId: conn.userId };
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
    const gateState = await this.store.getRestartGate(userId);

    if (risk.mode === "OFF") {
      return { outcome: "BLOCKED", message: "BLOCKED — mode OFF" };
    }
    if (risk.paused || gateState.entriesPaused) {
      return { outcome: "BLOCKED", message: "BLOCKED — entries paused pending reconciliation" };
    }
    if (risk.killSwitchActive || risk.emergencyStopActive || risk.locked) {
      return { outcome: "BLOCKED", message: "BLOCKED — kill switch or lock active" };
    }

    let quote;
    let indicators;
    try {
      quote = await this.marketData.getQuote(signal.symbol);
      indicators = await this.marketData.getIndicators(signal.symbol);
      await this.persistDashboard(userId, { lastMarketDataAt: quote.asOf });
    } catch (error) {
      const message = error instanceof Error ? error.message : "MARKET_DATA_FAILURE";
      await this.lock(userId, "market_data_failure");
      return { outcome: "BLOCKED", message: `BLOCKED — ${message}` };
    }

    if (!this.marketData.isFresh(quote.asOf, 60_000)) {
      await this.pushRejected(userId, signal.symbol, "BLOCKED — stale data");
      return { outcome: "BLOCKED", message: "BLOCKED — stale data" };
    }

    const closeEst = estimateMinutesToClose(indicators);
    if (closeEst.minutesToClose == null) {
      await this.pushRejected(userId, signal.symbol, "BLOCKED — minutes-to-close unavailable");
      return { outcome: "BLOCKED", message: "BLOCKED — minutes-to-close unavailable" };
    }

    const estimatedSlippageBps = estimateSlippageBpsFromQuote(quote);
    if (estimatedSlippageBps == null) {
      await this.pushRejected(userId, signal.symbol, "BLOCKED — slippage estimate unavailable");
      return { outcome: "BLOCKED", message: "BLOCKED — slippage estimate unavailable" };
    }

    let adapter: T212BrokerAdapter;
    try {
      adapter = await this.resolveBrokerAdapter(userId);
    } catch {
      return {
        outcome: "BLOCKED",
        message: "BLOCKED — Trading 212 instrument validation unavailable"
      };
    }

    let instruments;
    try {
      instruments = await adapter.listInstruments(signal.symbol);
    } catch {
      return {
        outcome: "BLOCKED",
        message: "BLOCKED — Trading 212 instrument validation unavailable"
      };
    }
    const match = instruments.find((i) => i.ticker.toUpperCase() === signal.symbol.toUpperCase());
    if (!match) {
      return { outcome: "BLOCKED", message: "BLOCKED — instrument unavailable on Trading 212" };
    }
    if (match.type !== "STOCK" && match.type !== "ETF") {
      return { outcome: "BLOCKED", message: "BLOCKED — instrument not an eligible stock/ETF" };
    }
    if (match.suspended || !match.tradable) {
      return { outcome: "BLOCKED", message: "BLOCKED — instrument not tradable" };
    }
    if (!Number.isFinite(match.minTradeQuantity) || match.minTradeQuantity <= 0) {
      return { outcome: "BLOCKED", message: "BLOCKED — instrument minTradeQuantity unavailable" };
    }
    const instrumentType = match.type;

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
    await this.persistDashboard(userId, { lastRankedOpportunities: [ranked] });
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
      minutesToClose: closeEst.minutesToClose,
      estimatedSlippageBps,
      instrumentType
    });

    if (!gate.allow) {
      await this.pushRejected(userId, signal.symbol, gate.message ?? "BLOCKED");
      await this.activity(userId, gate.message ?? "Blocked", "warn");
      return {
        outcome: gate.code === "DOES_NOT_QUALIFY" ? "WAIT" : "BLOCKED",
        message: gate.message ?? "BLOCKED"
      };
    }

    const opportunity = top!;
    let cash: number;
    try {
      const summary = await adapter.getAccountSummary();
      if (summary.availableToTrade == null || !Number.isFinite(summary.availableToTrade)) {
        return { outcome: "BLOCKED", message: "BLOCKED — available cash unavailable from broker" };
      }
      cash = summary.availableToTrade;
    } catch {
      return { outcome: "BLOCKED", message: "BLOCKED — available cash unavailable from broker" };
    }

    const reservedCashTotal = await this.store.getReservedCashTotal(userId);
    const availableCash = cash - reservedCashTotal;
    const portfolioExposureUsed = positions.reduce((s, p) => s + p.quantity * p.entryPrice, 0);
    const symbolExposureUsed = positions
      .filter((p) => p.symbol === signal.symbol)
      .reduce((s, p) => s + p.quantity * p.entryPrice, 0);

    const sizing = calculateStockPositionSize({
      estimatedEntry: opportunity.estimatedEntry,
      stop: opportunity.stop,
      limits: settings.limits,
      availableCash,
      dailyAllocationRemaining: Math.max(
        0,
        settings.limits.dailyCapitalAllocation - risk.dailyAllocationUsed
      ),
      portfolioExposureUsed,
      symbolExposureUsed,
      minTradeQuantity: match.minTradeQuantity
    });

    if (!sizing.ok) {
      await this.pushRejected(userId, signal.symbol, sizing.reason ?? "Sizing failed");
      return { outcome: "WAIT", message: `WAIT — ${sizing.reason}` };
    }

    const intent = this.buildIntent(userId, signal, opportunity, sizing.quantity, sizing.estimatedCost);
    assertTransition("CANDIDATE", "VALIDATING");
    intent.state = "VALIDATING";
    assertTransition("VALIDATING", "APPROVED");
    intent.state = "APPROVED";
    assertTransition("APPROVED", "ENTRY_RESERVED");
    intent.state = "ENTRY_RESERVED";
    intent.updatedAt = nowIso();

    const idempotencyKey = buildIntentIdempotencyKey({
      userId,
      symbol: signal.symbol,
      strategy: opportunity.strategy,
      signalOrBarTimestamp: signal.barTime ?? signal.timestamp,
      side: "BUY",
      tradingDate: dayKeyUtc()
    });

    const position: StockManagedPosition = {
      positionId: randomUUID(),
      userId,
      intentId: intent.intentId,
      symbol: signal.symbol,
      environment: "PAPER",
      quantity: sizing.quantity,
      entryPrice: opportunity.estimatedEntry,
      stop: opportunity.stop,
      takeProfit: opportunity.takeProfit,
      currentExitRule: "HARD_STOP",
      unrealisedPnl: 0,
      openedAt: nowIso(),
      goldMetaManaged: true
    };

    if (risk.mode === "SHADOW") {
      const reserved = await this.store.reserveEntryAtomically({
        userId,
        idempotencyKey,
        intent,
        position,
        cashAmount: sizing.estimatedCost,
        availableCashFromBroker: cash,
        limits: settings.limits,
        openShadowPosition: true
      });
      if (!reserved.ok) {
        await this.pushRejected(userId, signal.symbol, `BLOCKED — ${reserved.code}`);
        return { outcome: "BLOCKED", message: `BLOCKED — ${reserved.code}` };
      }
      await this.store.appendShadowTrade(userId, {
        symbol: signal.symbol,
        side: "BUY",
        quantity: sizing.quantity,
        note: "SHADOW hypothetical entry — no broker order"
      });
      await this.activity(
        userId,
        `SHADOW BUY ${sizing.quantity} ${signal.symbol} @ ~${opportunity.estimatedEntry}`,
        "success"
      );
      return {
        outcome: "BUY",
        message: "SHADOW BUY recorded",
        intentId: reserved.intent.intentId
      };
    }

    // PAPER / LIVE — reserve intent+cash atomically, then cancel (submission flags false)
    const reserved = await this.store.reserveEntryAtomically({
      userId,
      idempotencyKey,
      intent,
      position: null,
      cashAmount: sizing.estimatedCost,
      availableCashFromBroker: cash,
      limits: settings.limits,
      openShadowPosition: false
    });
    if (!reserved.ok) {
      return { outcome: "BLOCKED", message: `BLOCKED — ${reserved.code}` };
    }

    if (risk.mode === "T212_PAPER_AUTO") {
      if (!T212_PAPER_ORDER_SUBMISSION_ENABLED) {
        await this.store.releaseCash(userId, reserved.intent.intentId);
        const cancelled = {
          ...reserved.intent,
          state: "CANCELLED" as const,
          blockReason: "T212_PAPER_ORDER_SUBMISSION_DISABLED",
          updatedAt: nowIso()
        };
        await this.store.saveIntent(cancelled);
        await this.activity(
          userId,
          "Paper Auto intent reserved then cancelled — submission flag is false.",
          "warn"
        );
        return {
          outcome: "BLOCKED",
          message: "BLOCKED — Paper order submission disabled",
          intentId: cancelled.intentId
        };
      }
    }

    if (risk.mode === "T212_LIVE_AUTO") {
      await this.store.releaseCash(userId, reserved.intent.intentId);
      const locked = {
        ...reserved.intent,
        state: "LOCKED" as const,
        blockReason: "T212_LIVE_EXECUTION_DISABLED",
        updatedAt: nowIso()
      };
      await this.store.saveIntent(locked);
      return { outcome: "BLOCKED", message: "BLOCKED — Live execution disabled" };
    }

    await this.store.releaseCash(userId, reserved.intent.intentId);
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
    const reserved = await this.store.reserveExit(userId, position.positionId, reason ?? "EXIT");
    if (!reserved) {
      await this.activity(userId, `Exit already reserved for ${position.symbol}`, "info");
      return;
    }

    const risk = await this.store.getRiskState(userId);
    if (risk.mode === "SHADOW") {
      await this.store.appendShadowTrade(userId, {
        symbol: position.symbol,
        side: "SELL",
        quantity: position.quantity,
        note: `SHADOW exit: ${reason}`
      });
      await this.store.releaseCash(userId, position.intentId);
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
   * Matches only GoldMeta-managed records. Paper/Live execution remain disabled.
   */
  async reconcileOnStartup(userId: string): Promise<StockIntradayStatusPayload> {
    const generation = currentDeploymentGeneration();
    let risk = await this.store.getRiskState(userId);
    risk = { ...risk, paused: true, updatedAt: nowIso() };
    await this.store.saveRiskState(risk);
    await this.store.saveRestartGate({
      userId,
      entriesPaused: true,
      lastReconciledAt: null,
      deploymentGeneration: generation,
      reconciledGeneration: null,
      updatedAt: nowIso()
    });

    let adapter: T212BrokerAdapter | null = null;
    try {
      adapter = await this.resolveBrokerAdapter(userId);
    } catch {
      adapter = null;
    }
    const unresolved = await this.store.listUnresolvedIntents(userId);
    const managed = await this.store.listPositions(userId);
    const ambiguous: string[] = [];

    if (adapter?.isConnected()) {
      const [brokerOrders, brokerPositions] = await Promise.all([
        adapter.getPendingOrders(),
        adapter.getPositions()
      ]);

      for (const intent of unresolved) {
        if (requiresReconciliation(intent.state) || intent.state === "ENTRY_UNKNOWN") {
          const matchOrder = brokerOrders.find((o) => o.id === intent.brokerOrderId);
          const matchPos = brokerPositions.find((p) => p.ticker === intent.symbol);
          if (!matchOrder && !matchPos && intent.state === "ENTRY_UNKNOWN") {
            ambiguous.push(intent.symbol);
            intent.state = "LOCKED";
            await this.store.saveIntent(intent);
            await this.store.saveReconciliation({
              id: randomUUID(),
              userId,
              symbol: intent.symbol,
              status: "AMBIGUOUS",
              detail: { intentId: intent.intentId, reason: "ENTRY_UNKNOWN_NO_BROKER_MATCH" },
              createdAt: nowIso(),
              updatedAt: nowIso()
            });
          }
        }
      }

      for (const bp of brokerPositions) {
        const ours = managed.find((m) => m.symbol === bp.ticker && m.goldMetaManaged);
        if (!ours) {
          continue;
        }
      }
    }

    for (const symbol of ambiguous) {
      await this.lock(userId, `reconciliation:${symbol}`);
    }

    const ok = ambiguous.length === 0;
    if (ok) {
      if (risk.mode === "SHADOW") {
        risk = { ...risk, paused: false, updatedAt: nowIso() };
        await this.store.saveRiskState(risk);
      }
      await this.store.saveRestartGate({
        userId,
        entriesPaused: risk.mode !== "SHADOW",
        lastReconciledAt: nowIso(),
        deploymentGeneration: generation,
        reconciledGeneration: generation,
        updatedAt: nowIso()
      });
    }

    await this.activity(
      userId,
      ambiguous.length
        ? `Reconciliation locked symbols: ${ambiguous.join(", ")}`
        : risk.mode === "SHADOW"
          ? "Reconciliation complete — SHADOW monitoring resumed."
          : "Reconciliation complete — new entries remain paused until you resume (Paper/Live disabled).",
      ambiguous.length ? "warn" : "info"
    );
    return this.getStatus(userId);
  }

  /**
   * Autonomous SHADOW watchlist scan (no manual button required when scheduled).
   */
  async runAutonomousScan(userId: string): Promise<StockIntradayStatusPayload> {
    const settings = await this.store.getSettings(userId);
    let symbols = settings.universe.allowlist.slice(0, settings.universe.maxScannedCandidates);
    try {
      const adapter = await this.resolveBrokerAdapter(userId);
      const instruments = await adapter.listInstruments();
      const tradable = new Set(
        instruments
          .filter((i) => (i.type === "STOCK" || i.type === "ETF") && i.tradable && !i.suspended)
          .map((i) => i.ticker.toUpperCase())
      );
      symbols = symbols.filter((s) => tradable.has(s.toUpperCase()));
    } catch {
      // Instrument list unavailable — evaluateEntry will fail closed per symbol.
    }
    // Persist ranked board for the dashboard (may not qualify without a TV signal).
    await this.runShadowScan(userId, symbols);
    const dashboard = await this.store.getDashboardSnapshot(userId);
    const ordered = [...dashboard.lastRankedOpportunities].sort(
      (a, b) => b.overallScore - a.overallScore
    );
    const trySymbols = ordered.length
      ? ordered.map((o) => o.symbol)
      : symbols;

    // Same entry path as TradingView-triggered entries — no duplicated decision logic.
    for (const symbol of trySymbols) {
      const signal: StockTradingViewSignal = {
        alertId: `scan_${symbol}_${dayKeyUtc()}_${Date.now()}`,
        strategyId: "momentum_breakout",
        symbol,
        exchange: null,
        timeframe: "5m",
        action: "ENTRY_LONG",
        price: null,
        timestamp: nowIso(),
        barTime: nowIso(),
        barClosed: true,
        volume: null,
        ema21: null,
        ema50: null,
        ema200: null,
        vwap: null,
        rsi: null,
        atr: null,
        relativeVolume: null,
        support: null,
        resistance: null,
        marketTrend: null,
        confidence: 85,
        reasonCodes: ["SCHEDULED_SCAN"],
        receivedAt: nowIso()
      };
      const result = await this.evaluateEntryFromSignal(userId, signal);
      if (result.outcome === "BUY") {
        break;
      }
    }
    return this.getStatus(userId);
  }

  /**
   * Monitor GoldMeta-managed open positions for exit rules.
   * Never touches personal holdings. Never places broker orders while flags are false.
   */
  async monitorOpenPositions(userId: string): Promise<void> {
    const risk = await this.store.getRiskState(userId);
    if (risk.mode === "OFF") return;
    const positions = (await this.store.listPositions(userId)).filter((p) => p.goldMetaManaged);
    const settings = await this.store.getSettings(userId);

    for (const position of positions) {
      try {
        const quote = await this.marketData.getQuote(position.symbol);
        const indicators = await this.marketData.getIndicators(position.symbol);
        await this.persistDashboard(userId, { lastMarketDataAt: quote.asOf });

        if (!this.marketData.isFresh(quote.asOf, 60_000)) {
          await this.lock(userId, "market_data_stale_monitor");
          continue;
        }

        const closeEst = estimateMinutesToClose(indicators);
        const holdMinutes =
          (Date.now() - Date.parse(position.openedAt)) / 60_000;

        let exitReason: StockTradeIntent["exitReason"] | null = null;
        if (position.stop != null && quote.last <= position.stop) exitReason = "HARD_STOP";
        else if (position.takeProfit != null && quote.last >= position.takeProfit) {
          exitReason = "TAKE_PROFIT";
        } else if (holdMinutes >= settings.limits.maxPositionDurationMinutes) {
          exitReason = "MAX_HOLDING_TIME";
        } else if (
          closeEst.minutesToClose != null &&
          closeEst.minutesToClose <= settings.limits.forceCloseBeforeCloseMinutes
        ) {
          exitReason = "END_OF_DAY";
        } else if (
          indicators.vwap != null &&
          quote.last < indicators.vwap &&
          position.currentExitRule === "VWAP_LOSS"
        ) {
          exitReason = "VWAP_LOSS";
        }

        if (exitReason) {
          await this.requestExit(userId, position, exitReason);
        }
      } catch (error) {
        await this.activity(
          userId,
          `Monitor failed for ${position.symbol}: ${error instanceof Error ? error.message : "error"}`,
          "warn"
        );
      }
    }
  }

  async marketCloseSweep(userId: string): Promise<void> {
    const positions = (await this.store.listPositions(userId)).filter((p) => p.goldMetaManaged);
    for (const position of positions) {
      await this.requestExit(userId, position, "END_OF_DAY");
    }
  }

  getStore(): StockIntradayStorePort {
    return this.store;
  }

  /**
   * Users registered for autonomous scheduler ticks.
   * Persisted via activity of registering webhook / enabling SHADOW.
   */
  async listSchedulerUserIds(): Promise<string[]> {
    return this.store.listSchedulerUserIds();
  }

  async registerForScheduler(userId: string): Promise<void> {
    await this.store.registerSchedulerUser(userId);
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
        await this.persistDashboard(userId, { lastMarketDataAt: quote.asOf });
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
        await this.pushRejected(userId, symbol, "Market data unavailable");
      }
    }
    ranked.sort((a, b) => b.overallScore - a.overallScore);
    await this.persistDashboard(userId, { lastRankedOpportunities: ranked });
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
