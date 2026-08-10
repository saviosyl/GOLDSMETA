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
import { loadPinnedAccountIdFromServerEnv } from "./igBrokerAdapter";
import { runIgDemoReadOnlyDiagnostics } from "./igDemoDiagnostics";
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
  BROKER_EXECUTION_ENABLED,
  DEMO_ORDER_SUBMISSION_ENABLED,
  LIVE_EXECUTION_FEATURE_FLAG,
  T212_LIVE_EXECUTION_FEATURE_FLAG,
  T212_PAPER_ORDER_SUBMISSION_ENABLED,
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
import {
  getActiveQualificationAccountId,
  getQualificationDoc
} from "../broker/ctrader/qualificationStore";
import { deriveAdvancedState } from "../broker/ctrader/qualificationMachine";
import { getUserAutoTradeSettings } from "../broker/ctrader/userAutoTradeSettings";
import { evaluateDemoAutoExecutionAuthority } from "../broker/ctrader/demoAutoExecutionAuthority";
import { isCTraderDemoOrderSubmissionEnabled } from "../broker/ctrader/flags";
import {
  badgeForBroker,
  DEFAULT_T212_RISK_LIMITS,
  T212_PROXY_DISCLAIMER,
  type SelectedBrokerId,
  type T212Environment,
  type T212ExecutionProposal,
  type T212InstrumentCandidate,
  type T212SelectedInstrument
} from "./t212/types";
import {
  assertOrderSubmissionDisabled,
  buildDisconnectedT212View,
  connectionViewFromReport,
  defaultT212ClientFactory,
  runT212ReadOnlyDiagnostics,
  type T212ClientFactory
} from "./t212/diagnostics";
import {
  buildDryRunPreview,
  buildIdempotencyKey,
  buildProposal,
  proposalIdFromIdempotencyKey,
  translateXauusdToT212Invest,
  type GoldMetaDecisionInput
} from "./t212/executionRules";
import {
  requireExplicitInstrumentSelection,
  toGoldCandidate
} from "./t212/instruments";
import {
  loadT212CredentialsFromServerEnv,
  type T212Credentials
} from "./t212/client";

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
  private goldCandidatesByUser = new Map<string, import("./igDemoTypes").IgGoldMarketCandidate[]>();
  private proposedEpicByUser = new Map<string, string | null>();
  private selectionRequiredByUser = new Map<string, boolean>();
  private lastDiagnosticByUser = new Map<
    string,
    import("./igDemoTypes").IgDemoDiagnosticReport | null
  >();
  private accountMatchByUser = new Map<
    string,
    "matched" | "mismatch" | "unconfigured" | "unknown"
  >();
  private connectionErrorByUser = new Map<string, string | null>();
  private marketExtrasByUser = new Map<
    string,
    Partial<AutoTradeStatusPayload["connection"]>
  >();
  private t212ConnectedEnvByUser = new Map<string, T212Environment>();
  private t212ViewByUser = new Map<string, AutoTradeStatusPayload["t212"]>();
  private t212CandidatesByUser = new Map<string, T212InstrumentCandidate[]>();
  private t212DiagnosticByUser = new Map<
    string,
    import("./t212/types").T212DiagnosticReport | null
  >();
  private t212ClientFactory: T212ClientFactory;
  private t212CredentialLoader: (
    environment: T212Environment
  ) => T212Credentials | null;
  readonly ownerId: string;

  constructor(
    private readonly store: AutoTradeStorePort,
    private readonly adapterFactory: (env: BrokerEnvironment) => AutoTradeBrokerAdapter = (env) =>
      new FakeIgBrokerAdapter({ environment: env }),
    options: {
      ownerId?: string;
      t212ClientFactory?: T212ClientFactory;
      t212CredentialLoader?: (environment: T212Environment) => T212Credentials | null;
    } = {}
  ) {
    this.ownerId = options.ownerId ?? createExecutionOwnerId("svc");
    this.t212ClientFactory = options.t212ClientFactory ?? defaultT212ClientFactory;
    this.t212CredentialLoader =
      options.t212CredentialLoader ?? ((env) => loadT212CredentialsFromServerEnv(env));
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
    const brokerSelection = await this.store.getBrokerSelection(userId);
    const selectedBroker = brokerSelection.selectedBroker;
    const t212Instrument = await this.store.getT212SelectedInstrument(userId);
    const t212Proposals = await this.store.listT212Proposals(userId, 10);
    const pendingProposal =
      t212Proposals.find(
        (p) =>
          p.status === "AWAITING_CONFIRMATION" ||
          p.status === "CREATED" ||
          p.status === "DRY_RUN_APPROVED"
      ) ?? null;
    const adapter = this.adapters.get(userId);
    let positions: AutoTradeStatusPayload["positions"] = [];
    let marketFields: Partial<AutoTradeStatusPayload["connection"]> =
      this.marketExtrasByUser.get(userId) ?? {};
    const connError = this.connectionErrorByUser.get(userId) ?? null;
    const igActive = selectedBroker === "IG_DEMO";

    if (igActive && adapter?.isConnected()) {
      try {
        const open = await adapter.getOpenPositions();
        const preferred =
          this.proposedEpicByUser.get(userId) ??
          connection.marketEpic ??
          connection.pinnedMarketEpic;
        let market: import("./brokerAdapter").IgMarketDetails | undefined;
        if (preferred && !this.selectionRequiredByUser.get(userId)) {
          market = await adapter.getMarket(preferred);
        } else {
          const candidates = await adapter.searchGoldMarkets();
          this.goldCandidatesByUser.set(userId, candidates);
          const primary = candidates.filter((c) => c.proposedPrimary);
          if (candidates.length === 1 || primary.length === 1) {
            market = await adapter.getMarket((primary[0] ?? candidates[0])!.epic);
            this.selectionRequiredByUser.set(userId, candidates.length > 1 && primary.length !== 1);
          } else {
            this.selectionRequiredByUser.set(userId, true);
            if (primary[0]) this.proposedEpicByUser.set(userId, primary[0].epic);
          }
        }
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
          currentBid: market?.bid ?? null,
          currentAsk: market?.offer ?? null,
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
        if (market) {
          marketFields = {
            marketStatus: market.marketStatus,
            marketEpic: market.epic,
            marketName: market.instrumentName,
            instrumentType: market.instrumentType,
            expiry: market.expiry,
            bid: market.bid,
            ask: market.offer,
            spread: Number((market.offer - market.bid).toFixed(4)),
            minDealSize: market.minDealSize,
            sizeIncrement: market.dealSizeIncrement,
            valuePerPoint: market.valueOfOnePip,
            minNormalStopDistance: market.minNormalStopDistance,
            minGuaranteedStopDistance: market.minGuaranteedStopDistance,
            guaranteedStopAvailable: market.guaranteedStopAvailable,
            marginRequirement: market.marginRequirement
          };
          this.marketExtrasByUser.set(userId, marketFields);
          this.proposedEpicByUser.set(userId, market.epic);
        }
        const hb = await adapter.heartbeat();
        connection.lastHeartbeatAt = hb;
        connection.connected = true;
        connection.environment = adapter.environment;
        await this.store.saveConnection(connection);
        this.connectionErrorByUser.set(userId, null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "broker_status_error";
        this.connectionErrorByUser.set(userId, message);
      }
    }

    const limits = settings.limits;
    const connected = Boolean(igActive && adapter?.isConnected() && connection.connected);
    const connectionState: AutoTradeStatusPayload["connection"]["connectionState"] = !igActive
      ? "Disconnected"
      : connError
        ? "Error"
        : connected
          ? "Connected"
          : "Disconnected";

    const t212Env = this.t212ConnectedEnvByUser.get(userId) ?? null;
    const t212View =
      this.t212ViewByUser.get(userId) ??
      buildDisconnectedT212View(t212Instrument);
    if (t212View && t212Instrument && !t212View.selectedInstrument) {
      t212View.selectedInstrument = t212Instrument;
    }

    // Pepperstone Demo Auto authority (qualification) may be ON while legacy
    // risk.mode remains OFF. Surface DEMO displayStatus for API consumers without
    // enabling the legacy IG/T212 execution path (mode stays OFF).
    let displayStatus = displayStatusFor(
      risk.mode,
      risk.locked || risk.emergencyStopActive
    );
    if (
      selectedBroker === "PEPPERSTONE_CTRADER" &&
      !(risk.locked || risk.emergencyStopActive)
    ) {
      try {
        const accountId = await getActiveQualificationAccountId(userId);
        const qual = accountId
          ? await getQualificationDoc(userId, accountId)
          : null;
        const demoSettings = await getUserAutoTradeSettings(userId, "demo");
        const authority = evaluateDemoAutoExecutionAuthority({
          qualificationState: qual ? deriveAdvancedState(qual) : null,
          autoTradeEnabledIntent: demoSettings.autoTradeEnabledIntent,
          autoTradePaused: demoSettings.autoTradePaused,
          emergencyStopActive: demoSettings.emergencyStopActive,
          selectedAccountIsLive: false,
          demoOrderSubmissionEnabled: isCTraderDemoOrderSubmissionEnabled()
        });
        if (authority.demoExecutionEnabled) {
          displayStatus = "DEMO";
        }
      } catch {
        /* keep legacy displayStatus */
      }
    }

    return {
      displayStatus,
      mode: risk.mode,
      locked: risk.locked || risk.emergencyStopActive,
      lockReason: risk.lockReason,
      emergencyStopActive: risk.emergencyStopActive,
      liveExecutionFeatureEnabled: LIVE_EXECUTION_FEATURE_FLAG,
      demoOrderSubmissionEnabled: DEMO_ORDER_SUBMISSION_ENABLED,
      brokerExecutionEnabled: false,
      t212PaperOrderSubmissionEnabled: false,
      t212LiveExecutionFeatureEnabled: false,
      readOnly: true,
      ordersEnabled: false,
      selectedBroker,
      brokerBadge: badgeForBroker(selectedBroker, t212Env ?? t212View?.environment ?? null),
      igParked: true,
      t212: selectedBroker === "T212_INVEST" ? t212View : t212View,
      t212RiskLimits: DEFAULT_T212_RISK_LIMITS,
      t212GoldCandidates: this.t212CandidatesByUser.get(userId) ?? [],
      t212LastDiagnosticReport: this.t212DiagnosticByUser.get(userId) ?? null,
      t212PendingProposal: pendingProposal,
      t212Disclaimer: T212_PROXY_DISCLAIMER,
      connection: {
        connected,
        environment:
          selectedBroker === "PEPPERSTONE_CTRADER"
            ? "DEMO"
            : igActive
              ? connection.environment
              : null,
        environmentLabel:
          selectedBroker === "PEPPERSTONE_CTRADER"
            ? "PEPPERSTONE CTRADER DEMO — READ ONLY"
            : selectedBroker === "IG_DEMO"
              ? "IG DEMO — PARKED"
              : selectedBroker === "T212_INVEST"
                ? badgeForBroker("T212_INVEST", t212Env ?? "PRACTICE")
                : "MANUAL XAUUSD",
        accountIdMasked: igActive ? maskAccountId(connection.accountId) : null,
        accountName: igActive ? connection.accountName : null,
        currency: igActive ? connection.currency ?? limits.currency : limits.currency,
        balance: igActive ? connection.balance : null,
        available: igActive ? connection.available : null,
        marginUsed: igActive ? connection.marginUsed : null,
        marketStatus: igActive ? marketFields.marketStatus ?? null : null,
        marketEpic: igActive ? marketFields.marketEpic ?? connection.marketEpic : null,
        marketName: igActive ? marketFields.marketName ?? connection.marketName : null,
        instrumentType: igActive ? marketFields.instrumentType ?? null : null,
        expiry: igActive ? marketFields.expiry ?? null : null,
        bid: igActive ? marketFields.bid ?? null : null,
        ask: igActive ? marketFields.ask ?? null : null,
        spread: igActive ? marketFields.spread ?? null : null,
        minDealSize: igActive ? marketFields.minDealSize ?? null : null,
        sizeIncrement: igActive ? marketFields.sizeIncrement ?? null : null,
        valuePerPoint: igActive ? marketFields.valuePerPoint ?? null : null,
        minNormalStopDistance: igActive ? marketFields.minNormalStopDistance ?? null : null,
        minGuaranteedStopDistance: igActive
          ? marketFields.minGuaranteedStopDistance ?? null
          : null,
        guaranteedStopAvailable: igActive ? marketFields.guaranteedStopAvailable ?? null : null,
        marginRequirement: igActive ? marketFields.marginRequirement ?? null : null,
        lastHeartbeatAt: igActive ? connection.lastHeartbeatAt : null,
        accountMatch: igActive ? this.accountMatchByUser.get(userId) ?? null : null,
        connectionState
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
      positions: igActive ? positions : [],
      activity,
      strategyVersion: AUTOTRADE_STRATEGY_VERSION,
      goldCandidates: igActive ? this.goldCandidatesByUser.get(userId) ?? [] : [],
      proposedEpic: igActive
        ? this.proposedEpicByUser.get(userId) ?? connection.marketEpic
        : null,
      selectionRequired: igActive ? this.selectionRequiredByUser.get(userId) ?? false : false,
      lastDiagnosticReport: igActive ? this.lastDiagnosticByUser.get(userId) ?? null : null
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
      const selection = await this.store.getBrokerSelection(userId);
      if (selection.selectedBroker !== "IG_DEMO") {
        throw Object.assign(
          new Error("IG Demo is parked. Select IG Demo as broker before enabling IG modes."),
          { code: "IG_PARKED" }
        );
      }
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
    const selection = await this.store.getBrokerSelection(userId);
    if (selection.selectedBroker !== "IG_DEMO") {
      throw Object.assign(
        new Error("IG Demo is temporarily parked. Switch broker selection to IG Demo to reconnect."),
        { code: "IG_PARKED" }
      );
    }
    if (environment === "LIVE") {
      throw Object.assign(new Error("LIVE broker connection is blocked for this release."), {
        code: "LIVE_ADAPTER_BLOCKED"
      });
    }

    const previous = await this.store.getConnection(userId);
    const configuredId = loadPinnedAccountIdFromServerEnv("DEMO");
    let adapter: AutoTradeBrokerAdapter;
    try {
      adapter = this.adapterFactory(environment);
    } catch (error) {
      const message = error instanceof Error ? error.message : "ADAPTER_INIT_FAILED";
      this.connectionErrorByUser.set(userId, message);
      if (message === "IG_DEMO_CREDENTIALS_NOT_CONFIGURED" || message === "IG_CREDENTIALS_NOT_CONFIGURED") {
        await this.activity(userId, "IG Demo secrets are not configured (fail closed).", "error");
        throw Object.assign(new Error(message), { code: "IG_CREDENTIALS_MISSING" });
      }
      throw error;
    }
    try {
      await adapter.connect(credentialsRef);
      const accounts = await adapter.listAccounts();
      if (!accounts.length) throw new Error("No IG accounts found");

      let account = accounts[0]!;
      if (configuredId) {
        const match = accounts.find((a) => a.accountId === configuredId);
        if (!match) {
          this.accountMatchByUser.set(userId, "mismatch");
          this.connectionErrorByUser.set(userId, "ACCOUNT_MISMATCH");
          await adapter.disconnect();
          await this.lock(userId, "account_mismatch");
          await this.activity(
            userId,
            "Account mismatch — configured IG_DEMO_ACCOUNT_ID does not match Demo accounts. AutoTrade locked.",
            "error"
          );
          throw Object.assign(new Error("ACCOUNT_MISMATCH"), { code: "ACCOUNT_MISMATCH" });
        }
        const activeId = adapter.getSessionAccountId();
        if (activeId === configuredId) {
          await this.activity(
            userId,
            "Configured Demo account already active — skipped account switch.",
            "info"
          );
        }
        account = await adapter.selectAccount(configuredId);
        this.accountMatchByUser.set(userId, "matched");
      } else {
        account = await adapter.selectAccount(account.accountId);
        this.accountMatchByUser.set(userId, "unconfigured");
      }

      const candidates = await adapter.searchGoldMarkets();
      this.goldCandidatesByUser.set(userId, candidates);
      const primary = candidates.filter((c) => c.proposedPrimary);
      let marketEpic: string | null = null;
      let marketName: string | null = null;
      let selectionRequired = false;

      if (candidates.length === 0) {
        throw new Error("GOLD_MARKET_NOT_FOUND");
      }

      const pinned = previous.pinnedMarketEpic;
      if (pinned && candidates.some((c) => c.epic === pinned)) {
        marketEpic = pinned;
        const market = await adapter.getMarket(pinned);
        marketName = market.instrumentName;
        this.marketExtrasByUser.set(userId, {
          marketStatus: market.marketStatus,
          marketEpic: market.epic,
          marketName: market.instrumentName,
          instrumentType: market.instrumentType,
          expiry: market.expiry,
          bid: market.bid,
          ask: market.offer,
          spread: Number((market.offer - market.bid).toFixed(4)),
          minDealSize: market.minDealSize,
          sizeIncrement: market.dealSizeIncrement,
          valuePerPoint: market.valueOfOnePip,
          minNormalStopDistance: market.minNormalStopDistance,
          minGuaranteedStopDistance: market.minGuaranteedStopDistance,
          guaranteedStopAvailable: market.guaranteedStopAvailable,
          marginRequirement: market.marginRequirement
        });
        selectionRequired = false;
      } else if (candidates.length === 1 || primary.length === 1) {
        const chosen = (primary[0] ?? candidates[0])!;
        marketEpic = chosen.epic;
        const market = await adapter.getMarket(chosen.epic);
        marketName = market.instrumentName;
        this.marketExtrasByUser.set(userId, {
          marketStatus: market.marketStatus,
          marketEpic: market.epic,
          marketName: market.instrumentName,
          instrumentType: market.instrumentType,
          expiry: market.expiry,
          bid: market.bid,
          ask: market.offer,
          spread: Number((market.offer - market.bid).toFixed(4)),
          minDealSize: market.minDealSize,
          sizeIncrement: market.dealSizeIncrement,
          valuePerPoint: market.valueOfOnePip,
          minNormalStopDistance: market.minNormalStopDistance,
          minGuaranteedStopDistance: market.minGuaranteedStopDistance,
          guaranteedStopAvailable: market.guaranteedStopAvailable,
          marginRequirement: market.marginRequirement
        });
        selectionRequired = candidates.length > 1 && primary.length !== 1;
      } else {
        selectionRequired = true;
        marketEpic = primary[0]?.epic ?? null;
        marketName = primary[0]?.instrumentName ?? null;
        await this.activity(
          userId,
          "Multiple Gold markets found — explicit EPIC selection required before any execution stage.",
          "warn"
        );
      }

      this.proposedEpicByUser.set(userId, marketEpic);
      this.selectionRequiredByUser.set(userId, selectionRequired);
      this.adapters.set(userId, adapter);
      this.connectionErrorByUser.set(userId, null);

      if (
        previous.pinnedAccountId &&
        previous.pinnedAccountId !== account.accountId
      ) {
        await this.lock(userId, "account_change");
      }
      if (
        previous.pinnedMarketEpic &&
        marketEpic &&
        previous.pinnedMarketEpic !== marketEpic
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
        marketEpic,
        marketName,
        lastHeartbeatAt: await adapter.heartbeat(),
        credentialsRef,
        pinnedAccountId: previous.pinnedAccountId ?? account.accountId,
        pinnedMarketEpic: previous.pinnedMarketEpic ?? marketEpic,
        updatedAt: nowIso()
      });
      await this.audit(userId, "broker_connected", {
        environment,
        accountIdMasked: maskAccountId(account.accountId),
        selectionRequired,
        proposedEpic: marketEpic
      });
      await this.activity(
        userId,
        `Connected to IG DEMO — READ ONLY (${maskAccountId(account.accountId)}). Demo order submission disabled.`,
        "success"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "IG session failed";
      this.connectionErrorByUser.set(userId, message);
      if (message === "IG_DEMO_CREDENTIALS_NOT_CONFIGURED" || message === "IG_CREDENTIALS_NOT_CONFIGURED") {
        await this.activity(userId, "IG Demo secrets are not configured (fail closed).", "error");
        throw Object.assign(new Error(message), { code: "IG_CREDENTIALS_MISSING" });
      }
      if (message === "ACCOUNT_MISMATCH") {
        throw error;
      }
      await this.lock(userId, "ig_session_failed");
      await this.activity(userId, message, "error");
      throw error;
    }
    return this.getStatus(userId);
  }

  async disconnectBroker(userId: string): Promise<AutoTradeStatusPayload> {
    const adapter = this.adapters.get(userId);
    if (adapter) {
      try {
        await adapter.disconnect();
      } catch {
        /* ignore */
      }
      this.adapters.delete(userId);
    }
    const connection = await this.store.getConnection(userId);
    await this.store.saveConnection({
      ...connection,
      connected: false,
      lastHeartbeatAt: null,
      updatedAt: nowIso()
    });
    this.connectionErrorByUser.set(userId, null);
    await this.audit(userId, "broker_disconnected", {});
    await this.activity(userId, "Disconnected from IG Demo (session cleared server-side).", "info");
    return this.getStatus(userId);
  }

  /** Read-only DEMO diagnostics refresh (no order submission / dealing endpoints). */
  async refreshDemoDiagnostics(userId: string): Promise<AutoTradeStatusPayload> {
    await this.ensureRestartPolicy(userId);
    let adapter = this.adapters.get(userId);
    if (!adapter?.isConnected() || adapter.environment !== "DEMO") {
      try {
        await this.connectBroker(userId, "DEMO");
      } catch (error) {
        // Still attempt diagnostics if adapter was partially created — connectBroker already locked
        const message = error instanceof Error ? error.message : "CONNECT_FAILED";
        if (message === "ACCOUNT_MISMATCH" || message === "IG_CREDENTIALS_NOT_CONFIGURED" || message === "IG_DEMO_CREDENTIALS_NOT_CONFIGURED") {
          throw error;
        }
      }
      adapter = this.adapters.get(userId);
    }
    if (!adapter) {
      // Fail closed without silent FakeIg when credentials missing
      try {
        adapter = this.adapterFactory("DEMO");
        await adapter.connect("server:demo-diagnostics");
        this.adapters.set(userId, adapter);
      } catch (error) {
        const message = error instanceof Error ? error.message : "NOT_CONNECTED";
        this.connectionErrorByUser.set(userId, message);
        throw Object.assign(new Error(message), {
          code:
            message.includes("CREDENTIALS") ? "IG_CREDENTIALS_MISSING" : "DIAGNOSTICS_FAILED"
        });
      }
    }

    const preferred =
      this.proposedEpicByUser.get(userId) ??
      (await this.store.getConnection(userId)).pinnedMarketEpic;
    const report = await runIgDemoReadOnlyDiagnostics(adapter, { preferredEpic: preferred });
    this.lastDiagnosticByUser.set(userId, report);
    this.goldCandidatesByUser.set(userId, report.goldCandidates);
    this.proposedEpicByUser.set(userId, report.proposedEpic);
    this.selectionRequiredByUser.set(userId, report.selectionRequired);
    this.accountMatchByUser.set(userId, report.accountMatch);

    if (report.accountMatch === "mismatch") {
      await this.lock(userId, "account_mismatch");
      this.connectionErrorByUser.set(userId, "ACCOUNT_MISMATCH");
      try {
        await adapter.disconnect();
      } catch {
        /* ignore */
      }
      this.adapters.delete(userId);
      throw Object.assign(new Error("ACCOUNT_MISMATCH"), { code: "ACCOUNT_MISMATCH" });
    }

    if (report.selectedMarket) {
      const m = report.selectedMarket;
      this.marketExtrasByUser.set(userId, {
        marketStatus: m.marketStatus,
        marketEpic: m.epic,
        marketName: m.instrumentName,
        instrumentType: m.instrumentType,
        expiry: m.expiry,
        bid: m.bid,
        ask: m.offer,
        spread: m.spread,
        minDealSize: m.minDealSize,
        sizeIncrement: m.dealSizeIncrement,
        valuePerPoint: m.valueOfOnePip,
        minNormalStopDistance: m.minNormalStopDistance,
        minGuaranteedStopDistance: m.minGuaranteedStopDistance,
        guaranteedStopAvailable: m.guaranteedStopAvailable,
        marginRequirement: m.marginRequirement
      });
    }

    const connection = await this.store.getConnection(userId);
    let accountId = connection.accountId;
    let accountName = report.accountName ?? connection.accountName;
    try {
      const accounts = await adapter.listAccounts();
      const configuredId = loadPinnedAccountIdFromServerEnv("DEMO");
      const selected =
        (configuredId && accounts.find((a) => a.accountId === configuredId)) || accounts[0];
      if (selected) {
        accountId = selected.accountId;
        accountName = selected.accountName;
      }
    } catch {
      /* keep prior */
    }
    await this.store.saveConnection({
      ...connection,
      connected: report.connected,
      environment: "DEMO",
      accountId,
      accountName,
      currency: report.currency ?? connection.currency,
      balance: report.balance,
      available: report.available,
      marginUsed: report.marginUsed,
      marketEpic: report.proposedEpic ?? connection.marketEpic,
      marketName: report.selectedMarket?.instrumentName ?? connection.marketName,
      lastHeartbeatAt: report.heartbeatAt,
      updatedAt: nowIso()
    });
    await this.store.appendBrokerEvent({
      id: randomUUID(),
      userId,
      at: nowIso(),
      type: "demo_diagnostics_refresh",
      detail: redactSecrets({
        ok: report.ok,
        accountMatch: report.accountMatch,
        proposedEpic: report.proposedEpic,
        selectionRequired: report.selectionRequired,
        sessionRenewal: report.sessionRenewal,
        openPositionsCount: report.openPositionsCount,
        dealingEndpointsCalled: report.dealingEndpointsCalled,
        marketStatus: report.selectedMarket?.marketStatus ?? null,
        spread: report.selectedMarket?.spread ?? null,
        errors: report.errors
      })
    });

    if (!report.ok && report.errors.length) {
      this.connectionErrorByUser.set(userId, report.errors[0] ?? "DIAGNOSTICS_FAILED");
    } else {
      this.connectionErrorByUser.set(userId, null);
    }

    await this.activity(
      userId,
      report.ok
        ? "IG Demo read-only diagnostics OK — no dealing endpoints called."
        : `IG Demo diagnostics issues: ${report.errors.join(", ")}`,
      report.ok ? "success" : "warn"
    );
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
    // Invalidate T212 confirm-mode proposals and clear in-memory T212 session.
    await this.store.clearAwaitingT212Proposals(userId);
    this.t212ConnectedEnvByUser.delete(userId);
    this.t212ViewByUser.set(
      userId,
      buildDisconnectedT212View(await this.store.getT212SelectedInstrument(userId))
    );
    await this.audit(userId, "emergency_stop", { t212ProposalsCancelled: true });
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

  /**
   * Persist broker selection. Changing broker forces AutoTrade OFF, clears pending
   * execution intents/proposals, disconnects adapters, and never places an order.
   */
  async selectBroker(
    userId: string,
    selectedBroker: SelectedBrokerId
  ): Promise<AutoTradeStatusPayload> {
    await this.ensureRestartPolicy(userId);
    assertOrderSubmissionDisabled();

    const previous = await this.store.getBrokerSelection(userId);
    await this.store.saveBrokerSelection({
      userId,
      selectedBroker,
      updatedAt: nowIso()
    });

    let risk = await this.store.getRiskState(userId);
    risk = { ...risk, mode: "OFF", updatedAt: nowIso() };
    await this.store.saveRiskState(risk);

    await this.store.clearAwaitingT212Proposals(userId);
    // Clear IG pending intents by disconnecting + activity note (no order).
    const adapter = this.adapters.get(userId);
    if (adapter) {
      try {
        await adapter.disconnect();
      } catch {
        /* ignore */
      }
      this.adapters.delete(userId);
    }
    this.t212ConnectedEnvByUser.delete(userId);
    this.t212ViewByUser.set(
      userId,
      buildDisconnectedT212View(await this.store.getT212SelectedInstrument(userId))
    );
    this.connectionErrorByUser.set(userId, null);
    this.lastDiagnosticByUser.delete(userId);

    const connection = await this.store.getConnection(userId);
    await this.store.saveConnection({
      ...connection,
      connected: false,
      lastHeartbeatAt: null,
      updatedAt: nowIso()
    });

    await this.audit(userId, "broker_selected", {
      from: previous.selectedBroker,
      to: selectedBroker,
      modeForcedOff: true,
      ordersPlaced: false
    });
    await this.activity(
      userId,
      `Broker set to ${selectedBroker}. AutoTrade OFF — reconnect required. No order placed.`,
      "warn"
    );
    return this.getStatus(userId);
  }

  async connectTrading212(
    userId: string,
    environment: T212Environment = "PRACTICE"
  ): Promise<AutoTradeStatusPayload> {
    await this.ensureRestartPolicy(userId);
    assertOrderSubmissionDisabled();
    const selection = await this.store.getBrokerSelection(userId);
    if (selection.selectedBroker !== "T212_INVEST") {
      throw Object.assign(
        new Error("Select Trading 212 Invest as broker before connecting."),
        { code: "BROKER_NOT_T212" }
      );
    }
    if (environment === "LIVE") {
      throw Object.assign(
        new Error(
          "Trading 212 Live Invest is locked for this release. Use Practice/Demo read-only only."
        ),
        { code: "T212_LIVE_LOCKED" }
      );
    }

    const instrument = await this.store.getT212SelectedInstrument(userId);
    const report = await runT212ReadOnlyDiagnostics({
      environment: "PRACTICE",
      selectedInstrument: instrument,
      credentials: this.t212CredentialLoader("PRACTICE"),
      clientFactory: this.t212ClientFactory
    });
    this.t212DiagnosticByUser.set(userId, report);
    this.t212CandidatesByUser.set(userId, report.goldCandidates);
    const view = connectionViewFromReport(report);
    this.t212ViewByUser.set(userId, view);
    if (report.connected) {
      this.t212ConnectedEnvByUser.set(userId, report.environment);
    } else {
      this.t212ConnectedEnvByUser.delete(userId);
      throw Object.assign(
        new Error(report.errors[0] ?? "T212_CONNECT_FAILED"),
        { code: report.errors[0] ?? "T212_CONNECT_FAILED" }
      );
    }
    await this.audit(userId, "t212_connected", {
      environment: report.environment,
      readOnly: true,
      orderEndpointsCalled: false
    });
    await this.activity(
      userId,
      `Connected to Trading 212 ${report.environment} — READ ONLY. Order submission disabled.`,
      "success"
    );
    return this.getStatus(userId);
  }

  async disconnectTrading212(userId: string): Promise<AutoTradeStatusPayload> {
    await this.store.clearAwaitingT212Proposals(userId);
    this.t212ConnectedEnvByUser.delete(userId);
    const instrument = await this.store.getT212SelectedInstrument(userId);
    this.t212ViewByUser.set(userId, buildDisconnectedT212View(instrument));
    await this.audit(userId, "t212_disconnected", { t212ProposalsCancelled: true });
    await this.activity(
      userId,
      "Disconnected from Trading 212 — awaiting proposals cancelled (server session cleared).",
      "info"
    );
    return this.getStatus(userId);
  }

  async refreshT212Diagnostics(
    userId: string,
    query?: string
  ): Promise<AutoTradeStatusPayload> {
    await this.ensureRestartPolicy(userId);
    assertOrderSubmissionDisabled();
    const env = this.t212ConnectedEnvByUser.get(userId) ?? "PRACTICE";
    const instrument = await this.store.getT212SelectedInstrument(userId);
    const report = await runT212ReadOnlyDiagnostics({
      environment: env,
      selectedInstrument: instrument,
      credentials: this.t212CredentialLoader(env),
      clientFactory: this.t212ClientFactory,
      query
    });
    this.t212DiagnosticByUser.set(userId, report);
    this.t212CandidatesByUser.set(userId, report.goldCandidates);
    this.t212ViewByUser.set(userId, connectionViewFromReport(report));
    if (report.connected) this.t212ConnectedEnvByUser.set(userId, report.environment);
    await this.audit(userId, "t212_diagnostics", {
      ok: report.ok,
      orderEndpointsCalled: false,
      goldCandidates: report.goldCandidates.length
    });
    return this.getStatus(userId);
  }

  async searchT212GoldInstruments(
    userId: string,
    query?: string
  ): Promise<{ candidates: T212InstrumentCandidate[]; status: AutoTradeStatusPayload }> {
    await this.refreshT212Diagnostics(userId, query);
    return {
      candidates: this.t212CandidatesByUser.get(userId) ?? [],
      status: await this.getStatus(userId)
    };
  }

  async confirmT212Instrument(
    userId: string,
    candidate: {
      instrumentId: string;
      ticker: string;
      name: string;
      currency: string;
      isin?: string | null;
      exchange?: string | null;
      fractionalSupported?: boolean | null;
      minOrderQuantity?: number | null;
      minOrderValue?: number | null;
    }
  ): Promise<AutoTradeStatusPayload> {
    await this.ensureRestartPolicy(userId);
    assertOrderSubmissionDisabled();
    if (!candidate.instrumentId || !candidate.ticker || !candidate.name) {
      throw Object.assign(new Error("Explicit instrument confirmation required."), {
        code: "SELECTED_INSTRUMENT_REQUIRED"
      });
    }

    // Always re-validate against the live Practice catalogue. Do not trust
    // client-supplied identity fields or stale in-memory candidate caches.
    const env = this.t212ConnectedEnvByUser.get(userId) ?? "PRACTICE";
    if (env !== "PRACTICE") {
      throw Object.assign(new Error("T212_LIVE_LOCKED"), { code: "T212_LIVE_LOCKED" });
    }
    const creds = this.t212CredentialLoader("PRACTICE");
    if (!creds) {
      throw Object.assign(new Error("T212_CREDENTIALS_MISSING_SERVER_SIDE"), {
        code: "T212_CREDENTIALS_MISSING_SERVER_SIDE"
      });
    }
    const factory = this.t212ClientFactory ?? defaultT212ClientFactory;
    const client = factory("PRACTICE", creds);
    // Exact ticker lookup in the full catalogue — never substitute another ISIN listing.
    const instruments = await client.getInstruments();
    const raw = instruments.find((i) => (i.ticker ?? "").trim() === candidate.ticker.trim());
    const found = raw ? toGoldCandidate(raw) : null;
    if (!found || found.instrumentId !== candidate.instrumentId) {
      throw Object.assign(new Error("INSTRUMENT_NOT_IN_CATALOGUE"), {
        code: "INSTRUMENT_NOT_IN_CATALOGUE"
      });
    }
    this.t212CandidatesByUser.set(userId, [found]);
    const check = requireExplicitInstrumentSelection([found], candidate.instrumentId);
    if (!check.ok) {
      throw Object.assign(new Error(check.reason), { code: check.reason });
    }
    if (found.ticker !== candidate.ticker) {
      throw Object.assign(new Error("INSTRUMENT_TICKER_MISMATCH"), {
        code: "INSTRUMENT_TICKER_MISMATCH"
      });
    }
    if ((found.isin ?? null) !== (candidate.isin ?? null)) {
      throw Object.assign(new Error("INSTRUMENT_ISIN_MISMATCH"), {
        code: "INSTRUMENT_ISIN_MISMATCH"
      });
    }
    if ((found.currency ?? "").toUpperCase() !== candidate.currency.toUpperCase()) {
      throw Object.assign(new Error("INSTRUMENT_CURRENCY_MISMATCH"), {
        code: "INSTRUMENT_CURRENCY_MISMATCH"
      });
    }
    if (found.name.trim() !== candidate.name.trim()) {
      throw Object.assign(new Error("INSTRUMENT_NAME_MISMATCH"), {
        code: "INSTRUMENT_NAME_MISMATCH"
      });
    }

    const previous = await this.store.getT212SelectedInstrument(userId);
    // Persist catalogue identity only — ignore client replacement fields.
    const selected: T212SelectedInstrument = {
      instrumentId: found.instrumentId,
      ticker: found.ticker,
      name: found.name,
      currency: found.currency ?? "EUR",
      isin: found.isin ?? null,
      exchange: found.exchange ?? null,
      type: found.type ?? null,
      fractionalSupported: found.fractionalSupported ?? null,
      minOrderQuantity: found.minOrderQuantity ?? null,
      minOrderValue: found.minOrderValue ?? null,
      confirmedAt: nowIso(),
      confirmedBy: userId,
      environment: "PRACTICE"
    };
    const instrumentChanged = Boolean(
      previous &&
        (previous.instrumentId !== selected.instrumentId || previous.ticker !== selected.ticker)
    );
    await this.store.saveT212SelectedInstrumentAndInvalidateAwaiting(
      userId,
      selected,
      instrumentChanged
    );
    const view = this.t212ViewByUser.get(userId) ?? buildDisconnectedT212View(selected);
    this.t212ViewByUser.set(userId, { ...view, selectedInstrument: selected });
    await this.audit(userId, "t212_instrument_confirmed", {
      ticker: selected.ticker,
      instrumentId: selected.instrumentId,
      isin: selected.isin,
      currency: selected.currency,
      type: selected.type,
      environment: "PRACTICE",
      confirmedBy: userId,
      awaitingProposalsInvalidated: instrumentChanged,
      orderEndpointsCalled: false
    });
    await this.activity(
      userId,
      `Gold execution instrument confirmed: ${selected.ticker} (${selected.name}). Practice read-only — no orders submitted.`,
      "success"
    );
    return this.getStatus(userId);
  }

  /**
   * Build a dry-run / confirm-mode proposal from a GoldMeta XAUUSD decision.
   * Never submits a broker order.
   */
  async createT212ExecutionProposal(
    userId: string,
    decision: GoldMetaDecisionInput,
    opts: { marketOpen?: boolean | null; holdingQuantity?: number } = {}
  ): Promise<{ proposal: T212ExecutionProposal; preview: ReturnType<typeof buildDryRunPreview>; status: AutoTradeStatusPayload }> {
    await this.ensureRestartPolicy(userId);
    assertOrderSubmissionDisabled();

    const risk = await this.store.getRiskState(userId);
    if (risk.emergencyStopActive || risk.locked) {
      throw Object.assign(new Error("AUTOTRADE_LOCKED"), { code: "AUTOTRADE_LOCKED" });
    }

    const selection = await this.store.getBrokerSelection(userId);
    if (selection.selectedBroker !== "T212_INVEST") {
      throw Object.assign(new Error("Broker must be Trading 212 Invest."), {
        code: "BROKER_NOT_T212"
      });
    }

    const instrument = await this.store.getT212SelectedInstrument(userId);
    const view = this.t212ViewByUser.get(userId) ?? buildDisconnectedT212View(instrument);
    const environment = this.t212ConnectedEnvByUser.get(userId) ?? "PRACTICE";
    // Prefer server-observed holding; optional override is test-only and never comes from browser payloads.
    const holdingQuantity =
      opts.holdingQuantity ?? view.holdingQuantity ?? 0;

    const translation = translateXauusdToT212Invest(decision, {
      userId,
      environment,
      instrument,
      holdingQuantity,
      freeCash: view.freeCash,
      totalValue: view.totalValue,
      estimatedPrice: null,
      marketOpen: opts.marketOpen ?? null,
      limits: DEFAULT_T212_RISK_LIMITS
    });

    if (!instrument) {
      const blocked = buildProposal({
        proposalId: randomUUID(),
        userId,
        decision,
        translation: {
          ...translation,
          status: "BLOCKED",
          rejectionReason: translation.rejectionReason ?? "SELECTED_INSTRUMENT_REQUIRED",
          action: "WAIT",
          side: null
        },
        environment,
        instrument: {
          instrumentId: "UNSELECTED",
          ticker: "UNSELECTED",
          name: "UNSELECTED",
          currency: "EUR",
          isin: null,
          exchange: null,
          type: null,
          fractionalSupported: null,
          minOrderQuantity: null,
          minOrderValue: null,
          confirmedAt: nowIso(),
          confirmedBy: userId
        },
        accountCurrency: view.currency,
        estimatedPrice: null,
        createdAt: nowIso(),
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString()
      });
      blocked.status = "BLOCKED";
      await this.store.saveT212Proposal(blocked);
      return {
        proposal: blocked,
        preview: buildDryRunPreview({
          decision,
          translation,
          environment,
          instrument: null,
          accountCurrency: view.currency
        }),
        status: await this.getStatus(userId)
      };
    }

    const idempotencyKey = buildIdempotencyKey({
      userId,
      decisionId: decision.decisionId,
      instrumentId: instrument.instrumentId,
      action: translation.action,
      environment
    });
    const proposal = buildProposal({
      proposalId: proposalIdFromIdempotencyKey(idempotencyKey),
      userId,
      decision,
      translation,
      environment,
      instrument,
      accountCurrency: view.currency,
      estimatedPrice: null,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString()
    });
    // Atomic create-if-absent + Emergency STOP lock re-check inside store write path.
    const { proposal: saved, created } =
      await this.store.createT212ProposalIfAbsent(proposal);
    if (created) {
      await this.audit(userId, "t212_proposal_created", {
        proposalId: saved.proposalId,
        decisionId: saved.decisionId,
        status: saved.status,
        action: saved.action,
        orderSubmitted: false
      });
    }
    return {
      proposal: saved,
      preview: buildDryRunPreview({
        decision,
        translation,
        environment,
        instrument,
        accountCurrency: view.currency
      }),
      status: await this.getStatus(userId)
    };
  }

  /**
   * Confirm Mode approval — while order flags are false, yields DRY_RUN_APPROVED only.
   * Preserves future biometric confirmation interface via optional confirmMethod.
   */
  async approveT212ProposalDryRun(
    userId: string,
    proposalId: string,
    opts: { confirmMethod?: "manual" | "biometric_future" } = {}
  ): Promise<{ proposal: T212ExecutionProposal; status: AutoTradeStatusPayload }> {
    assertOrderSubmissionDisabled();
    if (T212_PAPER_ORDER_SUBMISSION_ENABLED || T212_LIVE_EXECUTION_FEATURE_FLAG || BROKER_EXECUTION_ENABLED) {
      throw Object.assign(new Error("T212_ORDER_FLAGS_MUST_REMAIN_FALSE"), {
        code: "T212_ORDER_FLAGS_MUST_REMAIN_FALSE"
      });
    }

    const risk = await this.store.getRiskState(userId);
    if (risk.emergencyStopActive || risk.locked) {
      throw Object.assign(new Error("AUTOTRADE_LOCKED"), { code: "AUTOTRADE_LOCKED" });
    }

    const selection = await this.store.getBrokerSelection(userId);
    if (selection.selectedBroker !== "T212_INVEST") {
      throw Object.assign(new Error("BROKER_NOT_T212"), { code: "BROKER_NOT_T212" });
    }

    const list = await this.store.listT212Proposals(userId, 50);
    const proposal = list.find((p) => p.proposalId === proposalId);
    if (!proposal) {
      throw Object.assign(new Error("PROPOSAL_NOT_FOUND"), { code: "PROPOSAL_NOT_FOUND" });
    }
    if (proposal.userId !== userId) {
      throw Object.assign(new Error("PROPOSAL_OWNERSHIP_MISMATCH"), {
        code: "PROPOSAL_OWNERSHIP_MISMATCH"
      });
    }
    if (
      proposal.status !== "AWAITING_CONFIRMATION" &&
      proposal.status !== "CREATED" &&
      proposal.status !== "SUBMISSION_DISABLED"
    ) {
      throw Object.assign(new Error("PROPOSAL_NOT_CONFIRMABLE"), {
        code: "PROPOSAL_NOT_CONFIRMABLE"
      });
    }

    const selected = await this.store.getT212SelectedInstrument(userId);
    if (
      !selected ||
      selected.instrumentId !== proposal.instrumentId ||
      selected.ticker !== proposal.instrumentTicker
    ) {
      const rejected = {
        ...proposal,
        status: "REJECTED" as const,
        rejectionReason: "INSTRUMENT_CHANGED",
        updatedAt: nowIso()
      };
      await this.store.saveT212Proposal(rejected);
      throw Object.assign(new Error("INSTRUMENT_CHANGED"), { code: "INSTRUMENT_CHANGED" });
    }

    if (Date.parse(proposal.expiresAt) < Date.now()) {
      const expired = {
        ...proposal,
        status: "REJECTED" as const,
        rejectionReason: "PROPOSAL_EXPIRED",
        updatedAt: nowIso()
      };
      await this.store.saveT212Proposal(expired);
      throw Object.assign(new Error("PROPOSAL_EXPIRED"), { code: "PROPOSAL_EXPIRED" });
    }

    const approved: T212ExecutionProposal = {
      ...proposal,
      status: "DRY_RUN_APPROVED",
      rejectionReason: "ORDER_SUBMISSION_DISABLED",
      updatedAt: nowIso(),
      riskEvaluation: {
        ...proposal.riskEvaluation,
        confirmMethod: opts.confirmMethod ?? "manual",
        biometricInterfaceReserved: true,
        orderSubmitted: false,
        dryRunOnly: true
      }
    };
    await this.store.saveT212Proposal(approved);
    await this.audit(userId, "t212_dry_run_approved", {
      proposalId,
      confirmMethod: opts.confirmMethod ?? "manual",
      orderSubmitted: false
    });
    await this.activity(
      userId,
      `Dry-run approved for proposal ${proposalId.slice(0, 8)}… — no broker order submitted.`,
      "success"
    );
    return { proposal: approved, status: await this.getStatus(userId) };
  }
}

export { LIVE_CONFIRMATION_PHRASE };
