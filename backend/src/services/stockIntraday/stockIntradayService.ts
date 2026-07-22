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
  generateWebhookRoutingId,
  hashRoutingId
} from "./stockIntradayStore";
import {
  calculateShadowExitAccounting,
  evaluateShadowExitRules
} from "./exitRules";
import {
  extractTrustedSourceIp,
  verifyTradingViewSource
} from "./tradingViewSource";
import {
  estimateMinutesToClose,
  estimateSlippageBpsFromQuote
} from "./sessionClock";
import { processStockIntradayJob } from "./processStockIntradayJob";
import {
  DEFAULT_MAX_PROVIDER_PRICE_DIVERGENCE_PCT,
  evaluateProviderDivergence
} from "./crossProvider";
import {
  defaultShadowWatchlist,
  validateShadowWatchlist
} from "./watchlist";
import {
  ALPACA_IEX_DATA_LABEL
} from "./marketData/alpacaConfig";
import type { ShadowDecisionRecord } from "./shadowPerformance";
import { calculateShadowPerformance } from "./shadowPerformance";

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
    const decisions = await this.store.listShadowDecisions(userId, 500);
    const shadowPerformance = calculateShadowPerformance(decisions);
    const readinessGates = await this.evaluateReadinessGates(userId);
    const sessionFromIndicators =
      (await this.safeSessionStatus()) ?? "UNKNOWN";

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
      marketDataProviderReady:
        this.marketData.capabilities.providerId !== "unconfigured" &&
        (this.marketData.capabilities.isMock || this.marketDataReady),
      engineRunning: risk.mode !== "OFF" && !risk.paused && !risk.locked,
      marketSession: sessionFromIndicators,
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
      marketData: {
        providerId: this.marketData.capabilities.providerId,
        feedId: this.marketData.capabilities.feedId ?? this.marketData.getFeedId?.() ?? null,
        dataLabel:
          this.marketData.capabilities.dataLabel ?? this.marketData.getDataLabel?.() ?? null,
        ready:
          this.marketData.capabilities.providerId !== "unconfigured"
      },
      shadowPerformance,
      readinessGates,
      strategyVersion: STOCK_INTRADAY_STRATEGY_VERSION,
      safetyStatement: SAFETY_STATEMENT
    };
  }

  private async safeSessionStatus(): Promise<"OPEN" | "CLOSED" | "PRE" | "POST" | "UNKNOWN" | null> {
    try {
      const indicators = await this.marketData.getIndicators("SPY");
      return indicators.sessionStatus;
    } catch {
      return null;
    }
  }

  async evaluateReadinessGates(
    userId: string
  ): Promise<Array<{ id: string; ok: boolean; detail: string }>> {
    const gates: Array<{ id: string; ok: boolean; detail: string }> = [];
    const risk = await this.store.getRiskState(userId);
    const gate = await this.store.getRestartGate(userId);

    const alpacaOk =
      this.marketData.capabilities.providerId === "alpaca" ||
      this.marketData.capabilities.isMock;
    gates.push({
      id: "alpaca_credentials",
      ok: alpacaOk,
      detail: alpacaOk
        ? `provider=${this.marketData.capabilities.providerId}`
        : "Alpaca credentials / provider not ready"
    });

    let t212Ok = false;
    try {
      const adapter = await this.resolveBrokerAdapter(userId);
      t212Ok = adapter.isConnected();
    } catch {
      t212Ok = false;
    }
    gates.push({
      id: "t212_paper_readonly",
      ok: t212Ok,
      detail: t212Ok ? "Trading 212 Paper read-only connected" : "T212 Paper credentials not validated"
    });

    const feed = this.marketData.capabilities.feedId ?? this.marketData.getFeedId?.() ?? null;
    const feedOk =
      this.marketData.capabilities.isMock || feed === "iex" || feed === "mock" || feed == null;
    gates.push({
      id: "alpaca_feed_iex",
      ok: feedOk,
      detail: `feed=${feed ?? "n/a"}`
    });

    gates.push({
      id: "execution_flags_false",
      ok: !T212_PAPER_ORDER_SUBMISSION_ENABLED && !T212_LIVE_EXECUTION_FEATURE_FLAG,
      detail: "Paper and Live submission flags must remain false"
    });

    gates.push({
      id: "emergency_stop_operational",
      ok: true,
      detail: "Emergency stop endpoint available"
    });

    gates.push({
      id: "restart_reconciliation",
      ok: risk.mode === "OFF" || Boolean(gate.reconciledGeneration),
      detail: gate.reconciledGeneration
        ? `reconciledGeneration=${gate.reconciledGeneration}`
        : "Reconciliation pending"
    });

    gates.push({
      id: "firestore_storage",
      ok: true,
      detail: `store=${this.store.constructor.name}`
    });

    let sessionOk = false;
    let sessionDetail = "session unresolved";
    try {
      const session = await this.safeSessionStatus();
      sessionOk = session != null && session !== "UNKNOWN";
      sessionDetail = `session=${session ?? "null"}`;
    } catch {
      sessionOk = false;
    }
    gates.push({
      id: "market_session_resolved",
      ok: sessionOk || this.marketData.capabilities.isMock,
      detail: sessionDetail
    });

    const settings = await this.store.getSettings(userId);
    const watchlistOk = settings.universe.allowlist.length > 0 && settings.universe.allowlist.length <= 10;
    gates.push({
      id: "watchlist_validated",
      ok: watchlistOk,
      detail: `allowlist=${settings.universe.allowlist.length}`
    });

    gates.push({
      id: "scheduler_healthy",
      ok: true,
      detail: "Scheduled Cloud Functions ticks remain the SHADOW cadence driver"
    });

    return gates;
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
      await this.reconcileOnStartup(userId);
      const gates = await this.evaluateReadinessGates(userId);
      const failed = gates.filter((g) => !g.ok);
      if (failed.length) {
        risk = {
          ...(await this.store.getRiskState(userId)),
          paused: true,
          updatedAt: nowIso()
        };
        await this.store.saveRiskState(risk);
        await this.activity(
          userId,
          `SHADOW paused — readiness gates failed: ${failed.map((g) => g.id).join(", ")}`,
          "warn"
        );
      } else {
        await this.registerForScheduler(userId);
        try {
          const adapter = await this.resolveBrokerAdapter(userId);
          const settingsNow = await this.store.getSettings(userId);
          const validated = await validateShadowWatchlist({
            symbols: defaultShadowWatchlist(),
            marketData: this.marketData,
            broker: adapter,
            universe: settingsNow.universe
          });
          await this.store.saveSettings({
            ...settingsNow,
            universe: {
              ...settingsNow.universe,
              allowlist: validated.accepted.length
                ? validated.accepted
                : settingsNow.universe.allowlist.slice(0, 10)
            },
            updatedAt: nowIso()
          });
          const rejected = validated.results.filter((r) => !r.accepted);
          if (rejected.length) {
            await this.activity(
              userId,
              `Watchlist rejected: ${rejected
                .map((r) => `${r.symbol}(${r.reasons.join("|")})`)
                .join(", ")}`,
              "warn"
            );
          }
          if (!validated.accepted.length) {
            risk = {
              ...(await this.store.getRiskState(userId)),
              paused: true,
              updatedAt: nowIso()
            };
            await this.store.saveRiskState(risk);
            await this.activity(
              userId,
              "SHADOW paused — no watchlist symbols passed Alpaca + T212 validation",
              "warn"
            );
          }
        } catch (error) {
          risk = {
            ...(await this.store.getRiskState(userId)),
            paused: true,
            updatedAt: nowIso()
          };
          await this.store.saveRiskState(risk);
          await this.activity(
            userId,
            `SHADOW paused — watchlist validation failed: ${
              error instanceof Error ? error.message : "unknown"
            }`,
            "error"
          );
        }
      }
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
   *
   * When `authorizesAutomaticEntry` is false (unverified TradingView source),
   * the job stores/analyses the signal but does not independently authorize entry.
   */
  async acknowledgeStockSignal(
    userId: string,
    body: unknown,
    options?: { authorizesAutomaticEntry?: boolean; sourceVerified?: boolean }
  ): Promise<{ accepted: boolean; code: string; signalId?: string; jobId?: string }> {
    const parsed = parseStockTradingViewSignal(body);
    if (!parsed.ok) {
      return { accepted: false, code: parsed.code };
    }
    const signal = parsed.signal;
    const authorizesAutomaticEntry = options?.authorizesAutomaticEntry !== false;
    const sourceVerified = options?.sourceVerified === true;

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
      payload: {
        alertId: signal.alertId,
        signalId: record.id,
        authorizesAutomaticEntry,
        sourceVerified
      }
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
        const authorizesAutomaticEntry = job.payload.authorizesAutomaticEntry !== false;
        await this.processQueuedSignal(job.userId, signalRec.id, signalRec.signal, {
          authorizesAutomaticEntry
        });
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
   * Create TradingView webhook routing URL.
   * connectionId is a non-secret routing identifier only — never a reusable credential.
   * Source verification uses TradingView client cert / allowlisted IP via a trusted edge.
   */
  async createWebhookConnection(
    userId: string,
    label = "TradingView Stocks",
    options?: { expiresInDays?: number }
  ): Promise<{
    connectionId: string;
    webhookPath: string;
    webhookUrlTemplate: string;
    expiresAt: string | null;
    enabled: boolean;
  }> {
    const connectionId = generateWebhookRoutingId();
    const routingIdHash = hashRoutingId(connectionId);
    const expiresAt =
      options?.expiresInDays != null
        ? new Date(Date.now() + options.expiresInDays * 24 * 60 * 60_000).toISOString()
        : null;
    await this.store.saveWebhookConnection({
      connectionId,
      routingIdHash,
      userId,
      label,
      enabled: true,
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
      rateLimitWindowMs: 60_000,
      rateLimitMax: 30,
      rateCount: 0,
      rateWindowStart: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      rotatedFromRoutingIdHash: null
    });
    await this.audit(userId, "stock_webhook_created", {
      routingIdHashPrefix: routingIdHash.slice(0, 12),
      label,
      expiresAt
    });
    const webhookPath = `/webhooks/stock-intraday/${connectionId}`;
    return {
      connectionId,
      webhookPath,
      webhookUrlTemplate: `https://<CLOUD_FUNCTIONS_HOST>${webhookPath}`,
      expiresAt,
      enabled: true
    };
  }

  async rotateWebhookConnection(
    userId: string,
    previousConnectionId: string,
    label?: string
  ): Promise<{
    connectionId: string;
    webhookPath: string;
    webhookUrlTemplate: string;
    expiresAt: string | null;
    enabled: boolean;
  }> {
    const previous = await this.store.getWebhookConnection(previousConnectionId);
    if (!previous || previous.userId !== userId) {
      throw Object.assign(new Error("Webhook connection not found"), { code: "WEBHOOK_NOT_FOUND" });
    }
    await this.store.revokeWebhookConnection(previousConnectionId, userId);
    const created = await this.createWebhookConnection(userId, label ?? previous.label);
    const next = await this.store.getWebhookConnection(created.connectionId);
    if (next) {
      await this.store.saveWebhookConnection({
        ...next,
        rotatedFromRoutingIdHash: previous.routingIdHash
      });
    }
    await this.audit(userId, "stock_webhook_rotated", {
      previousHashPrefix: previous.routingIdHash.slice(0, 12),
      nextHashPrefix: hashRoutingId(created.connectionId).slice(0, 12)
    });
    return created;
  }

  async revokeWebhookConnection(userId: string, connectionId: string): Promise<boolean> {
    const revoked = await this.store.revokeWebhookConnection(connectionId, userId);
    if (!revoked) return false;
    await this.audit(userId, "stock_webhook_revoked", {
      routingIdHashPrefix: revoked.routingIdHash.slice(0, 12)
    });
    return true;
  }

  /**
   * Authenticate TradingView webhook:
   * - connectionId is routing only (hashed before lookup)
   * - enabled / expiry / rate-limit enforced
   * - source verified only via trusted edge IP/cert — never client X-Forwarded-For
   * - when source verification unavailable, ACK may still store signals but must not
   *   authorize automatic entry
   */
  async authenticateWebhook(
    connectionId: string,
    options?: {
      queryTokenPresent?: boolean;
      trustedSourceIp?: string | null;
      trustedClientCertCn?: string | null;
      forwardedFor?: string | null;
      socketRemoteAddress?: string | null;
    }
  ): Promise<
    | {
        ok: true;
        userId: string;
        sourceVerified: boolean;
        authorizesAutomaticEntry: boolean;
        verificationReason: string;
      }
    | { ok: false; code: string; status: number }
  > {
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
    if (!conn.enabled || conn.revokedAt) {
      return { ok: false, code: "WEBHOOK_DISABLED", status: 403 };
    }
    if (conn.expiresAt && Date.parse(conn.expiresAt) <= Date.now()) {
      return { ok: false, code: "WEBHOOK_EXPIRED", status: 403 };
    }

    const touched = await this.store.touchWebhookConnectionUse(connectionId);
    if (touched && touched.rateCount > touched.rateLimitMax) {
      return { ok: false, code: "WEBHOOK_RATE_LIMITED", status: 429 };
    }

    const hopsRaw = process.env.STOCK_INTRADAY_TV_TRUSTED_PROXY_HOPS?.trim();
    const hops = hopsRaw ? Number(hopsRaw) : undefined;
    const trustedIp =
      options?.trustedSourceIp ??
      extractTrustedSourceIp({
        trustedProxyHops: Number.isFinite(hops) ? hops : undefined,
        forwardedFor: options?.forwardedFor,
        socketRemoteAddress: options?.socketRemoteAddress
      });

    const verification = verifyTradingViewSource({
      trustedSourceIp: trustedIp,
      trustedClientCertCn: options?.trustedClientCertCn ?? null
    });

    return {
      ok: true,
      userId: conn.userId,
      sourceVerified: verification.verified,
      authorizesAutomaticEntry: verification.verified,
      verificationReason: verification.reason
    };
  }

  async processQueuedSignal(
    userId: string,
    signalId: string,
    signal: StockTradingViewSignal,
    options?: { authorizesAutomaticEntry?: boolean }
  ): Promise<StockIntradayStatusPayload> {
    const existing = await this.store.getSignalByAlertId(userId, signal.alertId);
    if (existing) {
      existing.processingStatus = "PROCESSING";
      existing.updatedAt = nowIso();
      await this.store.saveSignal(existing);
    }

    const authorizesAutomaticEntry = options?.authorizesAutomaticEntry !== false;

    if (signal.action === "EXIT_LONG") {
      if (!authorizesAutomaticEntry) {
        await this.activity(
          userId,
          `EXIT_LONG stored for analysis only (${signal.symbol}) — TradingView source not verified; no automatic exit.`,
          "info"
        );
        if (existing) {
          existing.processingStatus = "PROCESSED";
          existing.decisionStatus = "IGNORED";
          existing.updatedAt = nowIso();
          await this.store.saveSignal(existing);
        }
        return this.getStatus(userId);
      }
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

    if (!authorizesAutomaticEntry) {
      await this.activity(
        userId,
        `ENTRY_LONG stored for analysis only (${signal.symbol}) — TradingView source not verified; awaiting internal market scan + risk confirmation.`,
        "info"
      );
      if (existing) {
        existing.processingStatus = "PROCESSED";
        existing.decisionStatus = "WAIT";
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


  private maxProviderDivergencePct(): number {
    const raw = Number(process.env.STOCK_INTRADAY_MAX_PROVIDER_DIVERGENCE_PCT ?? "");
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_PROVIDER_PRICE_DIVERGENCE_PCT;
  }

  private async recordShadowDecision(
    userId: string,
    partial: Partial<ShadowDecisionRecord> & {
      symbol: string;
      outcome: "BUY" | "WAIT" | "BLOCKED";
      blockReasons?: string[];
      supportReasons?: string[];
    }
  ): Promise<void> {
    const feed =
      this.marketData.capabilities.feedId ?? this.marketData.getFeedId?.() ?? "unknown";
    const dataLabel =
      this.marketData.capabilities.dataLabel ??
      this.marketData.getDataLabel?.() ??
      ALPACA_IEX_DATA_LABEL;
    await this.store.appendShadowDecision(userId, {
      scanTimestamp: partial.scanTimestamp ?? nowIso(),
      symbol: partial.symbol,
      alpacaFeed: partial.alpacaFeed ?? feed,
      dataLabel: partial.dataLabel ?? dataLabel,
      quoteTimestamp: partial.quoteTimestamp ?? nowIso(),
      entryPrice: partial.entryPrice ?? null,
      bid: partial.bid ?? null,
      ask: partial.ask ?? null,
      spreadBps: partial.spreadBps ?? null,
      strategy: partial.strategy ?? null,
      indicators: partial.indicators ?? {},
      overallScore: partial.overallScore ?? null,
      confidence: partial.confidence ?? null,
      supportReasons: partial.supportReasons ?? [],
      blockReasons: partial.blockReasons ?? [],
      outcome: partial.outcome,
      quantity: partial.quantity ?? null,
      stop: partial.stop ?? null,
      takeProfit: partial.takeProfit ?? null,
      hypotheticalEntry: partial.hypotheticalEntry ?? null,
      hypotheticalExit: partial.hypotheticalExit ?? null,
      exitReason: partial.exitReason ?? null,
      grossPnl: partial.grossPnl ?? null,
      estimatedSlippage: partial.estimatedSlippage ?? null,
      netPnl: partial.netPnl ?? null,
      holdingDurationMinutes: partial.holdingDurationMinutes ?? null,
      highestFavourableMovement: partial.highestFavourableMovement ?? null,
      maximumAdverseMovement: partial.maximumAdverseMovement ?? null
    });
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

    const finish = async (
      result: { outcome: "BUY" | "WAIT" | "BLOCKED"; message: string; intentId?: string },
      extra: Partial<ShadowDecisionRecord> = {}
    ) => {
      const blockReasons =
        result.outcome === "BUY"
          ? []
          : [...(extra.blockReasons ?? []), result.message].filter(Boolean);
      await this.recordShadowDecision(userId, {
        symbol: signal.symbol,
        outcome: result.outcome,
        blockReasons,
        supportReasons: extra.supportReasons ?? [],
        ...extra
      });
      return result;
    };

    if (risk.mode === "OFF") {
      return finish({ outcome: "BLOCKED", message: "BLOCKED — mode OFF" });
    }
    if (risk.paused || gateState.entriesPaused) {
      return finish({
        outcome: "BLOCKED",
        message: "BLOCKED — entries paused pending reconciliation"
      });
    }
    if (risk.killSwitchActive || risk.emergencyStopActive || risk.locked) {
      return finish({ outcome: "BLOCKED", message: "BLOCKED — kill switch or lock active" });
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
      return finish(
        { outcome: "BLOCKED", message: `BLOCKED — ${message}` },
        { blockReasons: ["ALPACA_OUTAGE", message] }
      );
    }

    const quoteFields = {
      quoteTimestamp: quote.asOf,
      entryPrice: quote.last,
      bid: quote.bid,
      ask: quote.ask,
      spreadBps: quote.spreadBps,
      alpacaFeed: quote.feed ?? this.marketData.capabilities.feedId ?? "iex",
      dataLabel: quote.dataLabel ?? ALPACA_IEX_DATA_LABEL,
      indicators: {
        vwap: indicators.vwap,
        ema9: indicators.ema9,
        ema21: indicators.ema21,
        ema50: indicators.ema50,
        ema200: indicators.ema200,
        rsi: indicators.rsi,
        atr: indicators.atr,
        relativeVolume: indicators.relativeVolume,
        volatilityPct: indicators.volatilityPct,
        sessionStatus: indicators.sessionStatus,
        minutesToClose: indicators.minutesToClose ?? null,
        broadMarketTrend: indicators.broadMarketTrend
      }
    };

    if (!this.marketData.isFresh(quote.asOf, 60_000)) {
      await this.pushRejected(userId, signal.symbol, "BLOCKED — stale data");
      return finish(
        { outcome: "BLOCKED", message: "BLOCKED — stale data" },
        { ...quoteFields, blockReasons: ["STALE_QUOTE"] }
      );
    }

    const closeEst = estimateMinutesToClose(indicators);
    if (closeEst.minutesToClose == null) {
      await this.pushRejected(userId, signal.symbol, "BLOCKED — minutes-to-close unavailable");
      return finish(
        { outcome: "BLOCKED", message: "BLOCKED — minutes-to-close unavailable" },
        { ...quoteFields, blockReasons: ["MINUTES_TO_CLOSE_UNAVAILABLE"] }
      );
    }

    const estimatedSlippageBps = estimateSlippageBpsFromQuote(quote);
    if (estimatedSlippageBps == null) {
      await this.pushRejected(userId, signal.symbol, "BLOCKED — slippage estimate unavailable");
      return finish(
        { outcome: "BLOCKED", message: "BLOCKED — slippage estimate unavailable" },
        { ...quoteFields, blockReasons: ["SLIPPAGE_UNAVAILABLE"] }
      );
    }

    let adapter: T212BrokerAdapter;
    try {
      adapter = await this.resolveBrokerAdapter(userId);
    } catch {
      return finish(
        {
          outcome: "BLOCKED",
          message: "BLOCKED — Trading 212 instrument validation unavailable"
        },
        { ...quoteFields, blockReasons: ["T212_VALIDATION_UNAVAILABLE"] }
      );
    }

    let instruments;
    try {
      instruments = await adapter.listInstruments(signal.symbol);
    } catch {
      return finish(
        {
          outcome: "BLOCKED",
          message: "BLOCKED — Trading 212 instrument validation unavailable"
        },
        { ...quoteFields, blockReasons: ["T212_VALIDATION_UNAVAILABLE"] }
      );
    }
    const match = instruments.find(
      (i) =>
        i.ticker.toUpperCase() === signal.symbol.toUpperCase() ||
        i.ticker.toUpperCase().startsWith(`${signal.symbol.toUpperCase()}_`)
    );
    if (!match) {
      return finish(
        { outcome: "BLOCKED", message: "BLOCKED — instrument unavailable on Trading 212" },
        { ...quoteFields, blockReasons: ["T212_INSTRUMENT_MISSING"] }
      );
    }
    if (match.type !== "STOCK" && match.type !== "ETF") {
      return finish(
        { outcome: "BLOCKED", message: "BLOCKED — instrument not an eligible stock/ETF" },
        { ...quoteFields, blockReasons: ["INSTRUMENT_TYPE_INELIGIBLE"] }
      );
    }
    if (match.suspended || !match.tradable) {
      return finish(
        { outcome: "BLOCKED", message: "BLOCKED — instrument not tradable" },
        { ...quoteFields, blockReasons: ["INSTRUMENT_NOT_TRADABLE"] }
      );
    }
    if (!Number.isFinite(match.minTradeQuantity) || match.minTradeQuantity <= 0) {
      return finish(
        { outcome: "BLOCKED", message: "BLOCKED — instrument minTradeQuantity unavailable" },
        { ...quoteFields, blockReasons: ["MIN_TRADE_QTY_UNAVAILABLE"] }
      );
    }
    const instrumentType = match.type;

    const divergence = evaluateProviderDivergence({
      snapshot: {
        alpacaSymbol: signal.symbol,
        alpacaLast: quote.last,
        alpacaAsOf: quote.asOf,
        alpacaFeed: String(quoteFields.alpacaFeed),
        alpacaBid: quote.bid,
        alpacaAsk: quote.ask,
        t212Symbol: match.ticker,
        t212Last: match.currentPrice ?? null,
        t212AsOf: nowIso(),
        t212Currency: match.currency,
        t212Exchange: match.exchange,
        t212InstrumentStatus: match.tradable && !match.suspended ? "TRADABLE" : "BLOCKED"
      },
      maxDivergencePct: this.maxProviderDivergencePct()
    });
    if (!divergence.ok) {
      await this.pushRejected(userId, signal.symbol, `BLOCKED — ${divergence.code}`);
      return finish(
        { outcome: "BLOCKED", message: `BLOCKED — ${divergence.code}` },
        {
          ...quoteFields,
          blockReasons: [divergence.code, "PROVIDER_PRICE_DIVERGENCE"].filter(
            (v, i, a) => a.indexOf(v) === i
          )
        }
      );
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
    await this.persistDashboard(userId, { lastRankedOpportunities: [ranked] });
    const top = selectTopQualifyingOpportunity([ranked]);

    const scoredFields = {
      ...quoteFields,
      strategy: ranked.strategy,
      overallScore: ranked.overallScore,
      confidence: ranked.confidence,
      supportReasons: ranked.supportReasons,
      stop: ranked.stop,
      takeProfit: ranked.takeProfit,
      hypotheticalEntry: ranked.estimatedEntry
    };

    const cooldownUntil = await this.store.getSymbolCooldown(userId, signal.symbol);
    const symbolCooldownActive = Boolean(cooldownUntil && Date.parse(cooldownUntil) > Date.now());
    const lossCooldownUntil = await this.store.getSymbolCooldown(userId, "__LOSS__");
    if (lossCooldownUntil && Date.parse(lossCooldownUntil) > Date.now()) {
      await this.pushRejected(userId, signal.symbol, "BLOCKED — cooldown after loss");
      return finish(
        { outcome: "BLOCKED", message: "BLOCKED — cooldown after loss" },
        { ...scoredFields, blockReasons: ["COOLDOWN_AFTER_LOSS"] }
      );
    }
    if (risk.losingTradesToday >= settings.limits.maxLosingTradesPerDay) {
      await this.pushRejected(userId, signal.symbol, "BLOCKED — max losing trades per day");
      return finish(
        { outcome: "BLOCKED", message: "BLOCKED — max losing trades per day" },
        { ...scoredFields, blockReasons: ["MAX_LOSING_TRADES"] }
      );
    }
    if (risk.dailyRealisedPnl <= -Math.abs(settings.limits.maxDailyLoss)) {
      await this.pushRejected(userId, signal.symbol, "BLOCKED — max daily loss");
      return finish(
        { outcome: "BLOCKED", message: "BLOCKED — max daily loss" },
        { ...scoredFields, blockReasons: ["MAX_DAILY_LOSS"] }
      );
    }

    const pending = await this.store.listActiveEntryReservations(userId);
    const reservedSlotCount = positions.length + pending.length;

    const gate = evaluateEntryGates({
      mode: risk.mode,
      risk,
      limits: settings.limits,
      universe: settings.universe,
      opportunity: top,
      quote,
      indicators,
      openPositionCount: reservedSlotCount,
      hasSymbolPosition:
        positions.some((p) => p.symbol === signal.symbol) ||
        pending.some((p) => p.symbol === signal.symbol),
      symbolCooldownActive,
      minutesToClose: closeEst.minutesToClose,
      estimatedSlippageBps,
      instrumentType
    });

    if (!gate.allow) {
      await this.pushRejected(userId, signal.symbol, gate.message ?? "BLOCKED");
      await this.activity(userId, gate.message ?? "Blocked", "warn");
      const outcome = gate.code === "DOES_NOT_QUALIFY" ? "WAIT" : "BLOCKED";
      return finish(
        { outcome, message: gate.message ?? "BLOCKED" },
        {
          ...scoredFields,
          blockReasons: [gate.code ?? "GATE_BLOCKED", ...(ranked.blockReasons ?? [])]
        }
      );
    }

    const opportunity = top!;
    let cash: number;
    try {
      const summary = await adapter.getAccountSummary();
      if (summary.availableToTrade == null || !Number.isFinite(summary.availableToTrade)) {
        return finish(
          { outcome: "BLOCKED", message: "BLOCKED — available cash unavailable from broker" },
          { ...scoredFields, blockReasons: ["CASH_UNAVAILABLE"] }
        );
      }
      cash = summary.availableToTrade;
    } catch {
      return finish(
        { outcome: "BLOCKED", message: "BLOCKED — available cash unavailable from broker" },
        { ...scoredFields, blockReasons: ["CASH_UNAVAILABLE"] }
      );
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
      return finish(
        { outcome: "WAIT", message: `WAIT — ${sizing.reason}` },
        { ...scoredFields, blockReasons: [sizing.reason ?? "SIZING_FAILED"] }
      );
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
      goldMetaManaged: true,
      highWaterMark: opportunity.estimatedEntry,
      breakEvenArmed: false,
      confidenceAtEntry: opportunity.confidence,
      strategy: opportunity.strategy
    };

    const buyFields = {
      ...scoredFields,
      quantity: sizing.quantity,
      entryPrice: opportunity.estimatedEntry,
      hypotheticalEntry: opportunity.estimatedEntry,
      stop: opportunity.stop,
      takeProfit: opportunity.takeProfit,
      estimatedSlippage: estimatedSlippageBps,
      supportReasons: opportunity.supportReasons
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
        openShadowPosition: true,
        reservePendingCapacity: false
      });
      if (!reserved.ok) {
        await this.pushRejected(userId, signal.symbol, `BLOCKED — ${reserved.code}`);
        return finish(
          { outcome: "BLOCKED", message: `BLOCKED — ${reserved.code}` },
          { ...buyFields, blockReasons: [reserved.code] }
        );
      }
      await this.store.appendShadowTrade(userId, {
        symbol: signal.symbol,
        side: "BUY",
        quantity: sizing.quantity,
        at: nowIso(),
        note: "SHADOW hypothetical entry — no broker order",
        entryPrice: opportunity.estimatedEntry,
        strategy: opportunity.strategy,
        confidenceAtEntry: opportunity.confidence
      });
      await this.activity(
        userId,
        `SHADOW BUY ${sizing.quantity} ${signal.symbol} @ ~${opportunity.estimatedEntry} [${ALPACA_IEX_DATA_LABEL}]`,
        "success"
      );
      return finish(
        {
          outcome: "BUY",
          message: "SHADOW BUY recorded",
          intentId: reserved.intent.intentId
        },
        buyFields
      );
    }

    // PAPER / LIVE — reserve pending capacity atomically before any broker fill
    const reserved = await this.store.reserveEntryAtomically({
      userId,
      idempotencyKey,
      intent,
      position: null,
      cashAmount: sizing.estimatedCost,
      availableCashFromBroker: cash,
      limits: settings.limits,
      openShadowPosition: false,
      reservePendingCapacity: true
    });
    if (!reserved.ok) {
      return finish(
        { outcome: "BLOCKED", message: `BLOCKED — ${reserved.code}` },
        { ...buyFields, blockReasons: [reserved.code] }
      );
    }

    if (risk.mode === "T212_PAPER_AUTO") {
      if (!T212_PAPER_ORDER_SUBMISSION_ENABLED) {
        await this.store.releaseEntryReservationAtomically({
          userId,
          intentId: reserved.intent.intentId,
          reverseDailyCounters: true,
          nextState: "CANCELLED",
          blockReason: "T212_PAPER_ORDER_SUBMISSION_DISABLED"
        });
        await this.activity(
          userId,
          "Paper Auto intent reserved then cancelled — submission flag is false.",
          "warn"
        );
        return finish(
          {
            outcome: "BLOCKED",
            message: "BLOCKED — Paper order submission disabled",
            intentId: reserved.intent.intentId
          },
          { ...buyFields, blockReasons: ["T212_PAPER_ORDER_SUBMISSION_DISABLED"] }
        );
      }
      // Submission enabled path would mark SUBMITTED then FILLED via finalizeEntryFillAtomically.
      // Kept disabled in this delivery.
    }

    if (risk.mode === "T212_LIVE_AUTO") {
      await this.store.releaseEntryReservationAtomically({
        userId,
        intentId: reserved.intent.intentId,
        reverseDailyCounters: true,
        nextState: "CANCELLED",
        blockReason: "T212_LIVE_EXECUTION_DISABLED"
      });
      const locked = {
        ...(await this.store.getIntent(userId, reserved.intent.intentId))!,
        state: "LOCKED" as const,
        blockReason: "T212_LIVE_EXECUTION_DISABLED",
        updatedAt: nowIso()
      };
      await this.store.saveIntent(locked);
      return finish(
        { outcome: "BLOCKED", message: "BLOCKED — Live execution disabled" },
        { ...buyFields, blockReasons: ["T212_LIVE_EXECUTION_DISABLED"] }
      );
    }

    await this.store.releaseEntryReservationAtomically({
      userId,
      intentId: reserved.intent.intentId,
      reverseDailyCounters: true,
      nextState: "RELEASED",
      blockReason: "NO_EXECUTION_PATH"
    });
    return finish(
      { outcome: "WAIT", message: "WAIT — no execution path" },
      { ...buyFields, blockReasons: ["NO_EXECUTION_PATH"] }
    );
  }

  /**
   * Exit only GoldMeta-managed positions — never personal holdings.
   * Loads a fresh market quote before SHADOW close; never uses entry price as fallback.
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
      const quote = await this.resolveValidatedExitQuote(userId, position.symbol);
      if (!quote) continue;
      await this.requestExit(userId, position, "TV_EXIT_LONG", quote);
    }
  }

  /**
   * Resolve a fresh exit quote for SHADOW closes.
   * Missing/stale quotes block the exit, keep the position visible, and leave no SELL record.
   */
  private async resolveValidatedExitQuote(
    userId: string,
    symbol: string
  ): Promise<{ last: number; spreadSlippageBps: number | null } | null> {
    try {
      const quote = await this.marketData.getQuote(symbol);
      await this.persistDashboard(userId, { lastMarketDataAt: quote.asOf });
      if (!this.marketData.isFresh(quote.asOf, 60_000)) {
        await this.activity(
          userId,
          `Exit blocked for ${symbol} — market quote stale; position kept; will retry next monitor cycle.`,
          "warn"
        );
        return null;
      }
      if (!Number.isFinite(quote.last) || quote.last <= 0) {
        await this.activity(
          userId,
          `Exit blocked for ${symbol} — invalid market quote; position kept; will retry next monitor cycle.`,
          "warn"
        );
        return null;
      }
      return {
        last: quote.last,
        spreadSlippageBps: estimateSlippageBpsFromQuote(quote)
      };
    } catch (error) {
      await this.activity(
        userId,
        `Exit blocked for ${symbol} — quote unavailable (${error instanceof Error ? error.message : "error"}); position kept; will retry next monitor cycle.`,
        "warn"
      );
      return null;
    }
  }

  async requestExit(
    userId: string,
    position: StockManagedPosition,
    reason: StockTradeIntent["exitReason"],
    exitQuote?: { last: number; spreadSlippageBps?: number | null }
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
    const settings = await this.store.getSettings(userId);
    if (risk.mode === "SHADOW") {
      let validated = exitQuote;
      if (
        !validated ||
        !Number.isFinite(validated.last) ||
        validated.last <= 0
      ) {
        validated = (await this.resolveValidatedExitQuote(userId, position.symbol)) ?? undefined;
      }
      if (!validated || !Number.isFinite(validated.last) || validated.last <= 0) {
        await this.store.releaseExitReservation(userId, position.positionId);
        await this.activity(
          userId,
          `SHADOW exit aborted for ${position.symbol} (${reason}) — no validated exit quote; position kept open (no entry-price fallback).`,
          "warn"
        );
        return;
      }

      const exitPrice = validated.last;
      const exitAt = nowIso();
      const accounting = calculateShadowExitAccounting({
        position,
        exitPrice,
        exitReason: reason ?? "HARD_STOP",
        exitAt,
        spreadSlippageBps: validated.spreadSlippageBps ?? settings.limits.maxSlippageBps,
        fxImpactPct: 0,
        strategy: position.strategy ?? "MOMENTUM_BREAKOUT",
        confidenceAtEntry: position.confidenceAtEntry ?? null
      });
      const perSymbolCooldownUntil = new Date(
        Date.now() + settings.limits.perSymbolCooldownMinutes * 60_000
      ).toISOString();
      const lossCooldownUntil =
        accounting.netRealizedPnl < 0
          ? new Date(
              Date.now() + settings.limits.cooldownAfterLossMinutes * 60_000
            ).toISOString()
          : null;

      const closed = await this.store.closeShadowPositionAtomically({
        userId,
        position,
        accounting,
        limits: settings.limits,
        perSymbolCooldownUntil,
        lossCooldownUntil
      });
      if (!closed) {
        await this.store.releaseExitReservation(userId, position.positionId);
        await this.activity(userId, `SHADOW exit skipped — position already closed (${position.symbol})`, "info");
        return;
      }

      const holdingDurationMinutes = Math.max(
        0,
        (Date.parse(exitAt) - Date.parse(position.openedAt)) / 60_000
      );
      await this.store.completeShadowDecisionExit(userId, position.symbol, {
        hypotheticalExit: exitPrice,
        exitReason: accounting.exitReason,
        grossPnl: accounting.grossPnl,
        estimatedSlippage: accounting.estimatedSpreadSlippage,
        netPnl: accounting.netRealizedPnl,
        holdingDurationMinutes,
        highestFavourableMovement: position.highWaterMark
          ? position.highWaterMark - position.entryPrice
          : null,
        maximumAdverseMovement: null
      });

      const after = await this.store.getRiskState(userId);
      if (after.locked || after.paused) {
        await this.store.saveRestartGate({
          ...(await this.store.getRestartGate(userId)),
          entriesPaused: true,
          updatedAt: nowIso()
        });
        await this.audit(userId, "shadow_loss_limit_lock", {
          lockReason: after.lockReason,
          dailyRealisedPnl: after.dailyRealisedPnl,
          losingTradesToday: after.losingTradesToday
        });
      }

      await this.activity(
        userId,
        `SHADOW SELL ${position.quantity} ${position.symbol} (${reason}) @ ${exitPrice} netPnl=${accounting.netRealizedPnl.toFixed(4)}`,
        "success"
      );
      return;
    }

    if (!T212_PAPER_ORDER_SUBMISSION_ENABLED && !T212_LIVE_EXECUTION_FEATURE_FLAG) {
      await this.store.releaseExitReservation(userId, position.positionId);
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
    let symbols = settings.universe.allowlist.slice(0, Math.min(10, settings.universe.maxScannedCandidates));
    try {
      const adapter = await this.resolveBrokerAdapter(userId);
      const validated = await validateShadowWatchlist({
        symbols,
        marketData: this.marketData,
        broker: adapter,
        universe: settings.universe
      });
      symbols = validated.accepted;
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
    if (risk.locked || risk.killSwitchActive || risk.emergencyStopActive) return;
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
        const evaluation = evaluateShadowExitRules({
          position,
          quote: { last: quote.last, bid: quote.bid, ask: quote.ask },
          indicators: {
            vwap: indicators.vwap,
            ema21: indicators.ema21,
            ema50: indicators.ema50,
            ema200: indicators.ema200,
            rsi: indicators.rsi,
            broadMarketTrend: indicators.broadMarketTrend,
            minutesToClose: closeEst.minutesToClose
          },
          limits: {
            maxPositionDurationMinutes: settings.limits.maxPositionDurationMinutes,
            forceCloseBeforeCloseMinutes: settings.limits.forceCloseBeforeCloseMinutes
          }
        });

        if (
          evaluation.highWaterMark !== position.highWaterMark ||
          evaluation.breakEvenArmed !== Boolean(position.breakEvenArmed)
        ) {
          await this.store.savePosition({
            ...position,
            highWaterMark: evaluation.highWaterMark,
            breakEvenArmed: evaluation.breakEvenArmed,
            stop: evaluation.effectiveStop ?? position.stop
          });
        }

        if (evaluation.exitReason) {
          const slip = estimateSlippageBpsFromQuote(quote);
          await this.requestExit(userId, position, evaluation.exitReason, {
            last: quote.last,
            spreadSlippageBps: slip
          });
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
      const quote = await this.resolveValidatedExitQuote(userId, position.symbol);
      if (!quote) continue;
      await this.requestExit(userId, position, "END_OF_DAY", quote);
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
      leaseExpiresAt: null,
      entryReservationState: null,
      confidenceAtEntry: opportunity.confidence
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
