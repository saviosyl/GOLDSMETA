/**
 * Practice order preparation + submission orchestration.
 * Production api never enables mutations; apiT212OrderPreview may.
 */

import type { DecisionRecord } from "../../../models/types";
import { createStore } from "../../storage/createStore";
import {
  assertLiveExecutionDisabled,
  assertPracticeOrderSubmissionAllowed,
  isPracticeOrderSubmissionAllowed,
  snapshotExecutionFlags
} from "../executionFlags";
import type { AutoTradeStorePort } from "../autoTradeStore";
import { INTENT_LEASE_MS } from "../autoTradeStore";
import { nowIso } from "../../../utils/time";
import {
  loadT212CredentialsFromServerEnv,
  T212ApiError,
  type T212Credentials
} from "./client";
import { T212InvestClient } from "./client";
import { deriveT212MarketStatus, requireMarketOpenForSubmission } from "./marketStatus";
import {
  buildRequestFingerprint,
  buildT212IntentKey,
  intentIdFromKey,
  isUnresolvedIntentState,
  PRACTICE_ORDER_RISK_LIMITS,
  type T212AutomationMode,
  type T212OrderIntent
} from "./orderIntent";
import { calculateT212OrderQuantity } from "./quantity";
import {
  findOrderForIntent,
  markIntentUnknownAfterTimeout,
  reconcileIntentWithBrokerOrder
} from "./reconcile";
import { evaluatePracticeAutoQualification } from "./qualification";

export interface T212ClientFactory {
  (
    environment: "PRACTICE" | "LIVE",
    credentials: T212Credentials
  ): T212InvestClient;
}

export function defaultOrderClientFactory(
  environment: "PRACTICE" | "LIVE",
  credentials: T212Credentials
): T212InvestClient {
  return new T212InvestClient(environment, credentials, {
    mutationsEnabled:
      environment === "PRACTICE" && isPracticeOrderSubmissionAllowed()
  });
}

export interface TrustedDecision {
  decisionId: string;
  decision: string;
  symbol: string;
  timeframe: string | null;
  confidence: number | null;
  generatedAt: string | null;
  candleConfirmed: boolean;
}

export function toTrustedDecision(record: DecisionRecord): TrustedDecision {
  const conf =
    typeof record.confidence === "number"
      ? record.confidence
      : typeof record.setupScore === "number"
        ? Math.abs(record.setupScore)
        : null;
  const candleConfirmed = Boolean(
    record.marketStructure?.confirmationClassification ||
      record.marketStructure?.confirmationDirection
  );
  return {
    decisionId: record.decisionId,
    decision: String(record.decision ?? "WAIT").toUpperCase(),
    symbol: String(record.symbol ?? ""),
    timeframe: record.timeframe != null ? String(record.timeframe) : null,
    confidence: conf,
    generatedAt: record.generatedAt ?? record.marketDataTime ?? null,
    candleConfirmed
  };
}

export interface PracticeOrderReadinessReport {
  readyForOwnerApproval: boolean;
  orderPlaced: false;
  ticker: string;
  indicativePrice: number | null;
  calculatedQuantity: number | null;
  estimatedValue: number | null;
  signedQuantity: number | null;
  minimumFractional: {
    fractionalSupported: boolean | null;
    minOrderQuantity: number | null;
    minOrderValue: number | null;
    rejectionReason: string | null;
  };
  marketStatus: string;
  freeCash: number | null;
  positionQuantity: number | null;
  pendingOrdersCount: number;
  riskGateResults: string[];
  failedGates: string[];
  exactPracticeEndpoint: string;
  liveCredentialsAbsent: boolean;
  executionFlags: ReturnType<typeof snapshotExecutionFlags>;
  automationMode: T212AutomationMode;
  qualification: ReturnType<typeof evaluatePracticeAutoQualification> | null;
  notes: string[];
}

export async function buildPracticeOrderReadiness(args: {
  userId: string;
  store: AutoTradeStorePort;
  clientFactory?: T212ClientFactory;
  automationMode: T212AutomationMode;
}): Promise<PracticeOrderReadinessReport> {
  assertLiveExecutionDisabled();
  const notes: string[] = [];
  const creds = loadT212CredentialsFromServerEnv("PRACTICE");
  const liveAbsent = !loadT212CredentialsFromServerEnv("LIVE");
  const failedGates: string[] = [];
  const riskGateResults: string[] = [];

  if (!creds) {
    failedGates.push("T212_CREDENTIALS_MISSING_SERVER_SIDE");
  }

  const instrument = await args.store.getT212SelectedInstrument(args.userId);
  if (!instrument || instrument.ticker !== PRACTICE_ORDER_RISK_LIMITS.ticker) {
    failedGates.push("EGLN_NOT_CONFIRMED");
  }

  const factory = args.clientFactory ?? defaultOrderClientFactory;
  let freeCash: number | null = null;
  let indicativePrice: number | null = null;
  let positionQuantity: number | null = null;
  let pendingOrdersCount = 0;
  let marketStatus = "UNKNOWN";
  let fractionalSupported = instrument?.fractionalSupported ?? null;
  let minOrderQuantity = instrument?.minOrderQuantity ?? null;
  let minOrderValue = instrument?.minOrderValue ?? null;

  let calc = calculateT212OrderQuantity({
    side: "BUY",
    targetOrderValueEur: PRACTICE_ORDER_RISK_LIMITS.maxOrderValueEur,
    maxOrderValueEur: PRACTICE_ORDER_RISK_LIMITS.maxOrderValueEur,
    freeCashEur: null,
    indicativePrice: null,
    priceSafetyBufferPct: PRACTICE_ORDER_RISK_LIMITS.priceSafetyBufferPct,
    holdingQuantity: 0,
    pendingSellQuantity: 0,
    eligibility: {
      ticker: PRACTICE_ORDER_RISK_LIMITS.ticker,
      minOrderQuantity,
      minOrderValue,
      fractionalSupported,
      maxOpenQuantity: null,
      quantityPrecision: null
    }
  });

  if (creds) {
    const client = factory("PRACTICE", creds);
    try {
      const [summary, positions, orders, instruments, exchanges] = await Promise.all([
        client.getAccountSummary(),
        client.getPositions(),
        client.getOrders(),
        client.getInstruments(),
        client.getExchanges().catch(() => [])
      ]);
      freeCash = summary.cash?.availableToTrade ?? null;
      pendingOrdersCount = orders.length;
      const holding = positions.find(
        (p) => (p.ticker ?? "") === PRACTICE_ORDER_RISK_LIMITS.ticker
      );
      positionQuantity = holding?.quantityAvailableForTrading ?? holding?.quantity ?? 0;
      indicativePrice =
        typeof holding?.currentPrice === "number" && holding.currentPrice > 0
          ? holding.currentPrice
          : null;

      const raw = instruments.find(
        (i) => (i.ticker ?? "") === PRACTICE_ORDER_RISK_LIMITS.ticker
      );
      minOrderQuantity = raw?.minTradeQuantity ?? minOrderQuantity;
      const eligibility = {
        ticker: PRACTICE_ORDER_RISK_LIMITS.ticker,
        minOrderQuantity,
        minOrderValue,
        fractionalSupported,
        maxOpenQuantity: raw?.maxOpenQuantity ?? null,
        quantityPrecision: null as number | null
      };

      const mkt = deriveT212MarketStatus({
        instrument: {
          ticker: PRACTICE_ORDER_RISK_LIMITS.ticker,
          workingScheduleId: raw?.workingScheduleId ?? null
        },
        exchanges
      });
      marketStatus = mkt.status;
      const mktGate = requireMarketOpenForSubmission(mkt);
      if (!mktGate.ok) failedGates.push(mktGate.code);
      else riskGateResults.push("MARKET_OPEN");

      calc = calculateT212OrderQuantity({
        side: "BUY",
        targetOrderValueEur: PRACTICE_ORDER_RISK_LIMITS.maxOrderValueEur,
        maxOrderValueEur: PRACTICE_ORDER_RISK_LIMITS.maxOrderValueEur,
        freeCashEur: freeCash,
        indicativePrice,
        priceSafetyBufferPct: PRACTICE_ORDER_RISK_LIMITS.priceSafetyBufferPct,
        holdingQuantity: positionQuantity ?? 0,
        pendingSellQuantity: 0,
        eligibility
      });
      if (!calc.ok && calc.rejectionReason) failedGates.push(calc.rejectionReason);
      else riskGateResults.push("QUANTITY_OK");

      if ((positionQuantity ?? 0) > 0) failedGates.push("EXISTING_BUY_POSITION");
      else riskGateResults.push("NO_OPEN_POSITION");

      if (pendingOrdersCount > 0) {
        const pendingBuy = orders.some(
          (o) =>
            (o.ticker ?? "") === PRACTICE_ORDER_RISK_LIMITS.ticker &&
            typeof o.quantity === "number" &&
            o.quantity > 0
        );
        if (pendingBuy) failedGates.push("PENDING_BUY_CONFLICT");
        else riskGateResults.push("NO_PENDING_BUY");
      } else riskGateResults.push("NO_PENDING_ORDERS");
    } catch (e) {
      const code = e instanceof T212ApiError ? e.code : "T212_READINESS_FETCH_FAILED";
      failedGates.push(code);
      notes.push(code);
    }
  }

  let qualification: ReturnType<typeof evaluatePracticeAutoQualification> | null = null;
  try {
    const qual = await args.store.getT212PracticeAutoQualification(args.userId);
    qualification = evaluatePracticeAutoQualification(qual);
  } catch {
    qualification = null;
  }

  const readyForOwnerApproval =
    failedGates.length === 0 &&
    calc.ok &&
    calc.quantity != null &&
    isPracticeOrderSubmissionAllowed();

  return {
    readyForOwnerApproval,
    orderPlaced: false,
    ticker: PRACTICE_ORDER_RISK_LIMITS.ticker,
    indicativePrice: calc.indicativePrice,
    calculatedQuantity: calc.quantity,
    estimatedValue: calc.estimatedValue,
    signedQuantity: calc.signedQuantity,
    minimumFractional: {
      fractionalSupported,
      minOrderQuantity,
      minOrderValue,
      rejectionReason:
        fractionalSupported == null ? "FRACTIONAL_ELIGIBILITY_UNKNOWN" : null
    },
    marketStatus,
    freeCash,
    positionQuantity,
    pendingOrdersCount,
    riskGateResults,
    failedGates,
    exactPracticeEndpoint: "POST https://demo.trading212.com/api/v0/equity/orders/market",
    liveCredentialsAbsent: liveAbsent,
    executionFlags: snapshotExecutionFlags(),
    automationMode: args.automationMode,
    qualification,
    notes
  };
}

export async function prepareAndOptionallySubmitPracticeOrder(args: {
  userId: string;
  decisionId: string;
  proposalId?: string | null;
  store: AutoTradeStorePort;
  automationMode: T212AutomationMode;
  submit: boolean;
  ownerId: string;
  clientFactory?: T212ClientFactory;
  goldMetaStore?: {
    getDecision(
      userId: string,
      decisionId: string
    ): Promise<DecisionRecord | undefined> | DecisionRecord | undefined;
  };
}): Promise<{
  intent: T212OrderIntent;
  submitted: boolean;
  readiness: PracticeOrderReadinessReport;
}> {
  assertLiveExecutionDisabled();
  if (args.submit) {
    assertPracticeOrderSubmissionAllowed();
  }

  const goldMetaStore = args.goldMetaStore ?? createStore();
  const record = await Promise.resolve(
    goldMetaStore.getDecision(args.userId, args.decisionId)
  );
  if (!record) {
    throw Object.assign(new Error("TRUSTED_DECISION_NOT_FOUND"), {
      code: "TRUSTED_DECISION_NOT_FOUND"
    });
  }
  const decision = toTrustedDecision(record);

  if (decision.symbol !== "XAUUSD") {
    throw Object.assign(new Error("SYMBOL_NOT_XAUUSD"), { code: "SYMBOL_NOT_XAUUSD" });
  }
  if (decision.decision === "WAIT" || decision.decision === "HOLD") {
    throw Object.assign(new Error("WAIT_NO_ORDER"), { code: "WAIT_NO_ORDER" });
  }

  const readiness = await buildPracticeOrderReadiness({
    userId: args.userId,
    store: args.store,
    clientFactory: args.clientFactory,
    automationMode: args.automationMode
  });

  const instrument = await args.store.getT212SelectedInstrument(args.userId);
  if (!instrument || instrument.ticker !== PRACTICE_ORDER_RISK_LIMITS.ticker) {
    throw Object.assign(new Error("EGLN_NOT_CONFIRMED"), { code: "EGLN_NOT_CONFIRMED" });
  }

  const action =
    decision.decision === "SELL" || decision.decision === "EXIT"
      ? "SELL_CLOSE"
      : decision.decision === "BUY" || decision.decision === "STRONG_BUY"
        ? "BUY"
        : null;
  if (!action) {
    throw Object.assign(new Error("UNSUPPORTED_DECISION"), { code: "UNSUPPORTED_DECISION" });
  }

  if (
    typeof decision.confidence === "number" &&
    decision.confidence < PRACTICE_ORDER_RISK_LIMITS.minConfidence
  ) {
    throw Object.assign(new Error("CONFIDENCE_TOO_LOW"), { code: "CONFIDENCE_TOO_LOW" });
  }
  if (decision.generatedAt) {
    const age = (Date.now() - Date.parse(decision.generatedAt)) / 1000;
    if (!Number.isNaN(age) && age > PRACTICE_ORDER_RISK_LIMITS.maxSignalAgeSeconds) {
      throw Object.assign(new Error("STALE_DECISION"), { code: "STALE_DECISION" });
    }
  }
  if (PRACTICE_ORDER_RISK_LIMITS.requireConfirmedCandle && !decision.candleConfirmed) {
    throw Object.assign(new Error("CONFIRMED_CANDLE_REQUIRED"), {
      code: "CONFIRMED_CANDLE_REQUIRED"
    });
  }

  const side = action === "SELL_CLOSE" ? "SELL" : "BUY";
  const calc = calculateT212OrderQuantity({
    side,
    targetOrderValueEur: PRACTICE_ORDER_RISK_LIMITS.maxOrderValueEur,
    maxOrderValueEur: PRACTICE_ORDER_RISK_LIMITS.maxOrderValueEur,
    freeCashEur: readiness.freeCash,
    indicativePrice: readiness.indicativePrice,
    priceSafetyBufferPct: PRACTICE_ORDER_RISK_LIMITS.priceSafetyBufferPct,
    holdingQuantity: readiness.positionQuantity ?? 0,
    pendingSellQuantity: 0,
    eligibility: {
      ticker: instrument.ticker,
      minOrderQuantity: readiness.minimumFractional.minOrderQuantity,
      minOrderValue: readiness.minimumFractional.minOrderValue,
      fractionalSupported: readiness.minimumFractional.fractionalSupported,
      maxOpenQuantity: null,
      quantityPrecision: null
    }
  });
  if (!calc.ok || calc.quantity == null || calc.signedQuantity == null) {
    throw Object.assign(new Error(calc.rejectionReason ?? "QUANTITY_CALC_FAILED"), {
      code: calc.rejectionReason ?? "QUANTITY_CALC_FAILED"
    });
  }

  const unresolved = await args.store.listUnresolvedT212OrderIntents(args.userId);
  if (unresolved.length > 0) {
    throw Object.assign(new Error("UNRESOLVED_INTENT_EXISTS"), {
      code: "UNRESOLVED_INTENT_EXISTS"
    });
  }

  const intentKey = buildT212IntentKey({
    userId: args.userId,
    environment: "PRACTICE",
    decisionId: decision.decisionId,
    ticker: instrument.ticker,
    action
  });
  const intentId = intentIdFromKey(intentKey);
  const fingerprint = buildRequestFingerprint({
    intentKey,
    ticker: instrument.ticker,
    signedQuantity: calc.signedQuantity,
    environment: "PRACTICE",
    decisionId: decision.decisionId
  });

  const createdAt = nowIso();
  const prepared: T212OrderIntent = {
    intentId,
    intentKey,
    userId: args.userId,
    broker: "T212_INVEST",
    environment: "PRACTICE",
    decisionId: decision.decisionId,
    proposalId: args.proposalId ?? null,
    ticker: instrument.ticker,
    instrumentId: instrument.instrumentId,
    action,
    side,
    quantity: calc.quantity,
    signedQuantity: calc.signedQuantity,
    estimatedValue: calc.estimatedValue,
    indicativePrice: calc.indicativePrice,
    requestFingerprint: fingerprint,
    state: "PREPARED",
    brokerOrderId: null,
    brokerStatus: null,
    filledQuantity: null,
    averageFillPrice: null,
    rejectionReason: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    submittedAt: null,
    lastReconciledAt: null,
    createdAt,
    updatedAt: createdAt,
    dryRunOnly: !args.submit,
    riskEvaluation: {
      readinessFailedGates: readiness.failedGates,
      automationMode: args.automationMode,
      trustedDecision: {
        decisionId: decision.decisionId,
        decision: decision.decision,
        symbol: decision.symbol,
        confidence: decision.confidence,
        candleConfirmed: decision.candleConfirmed
      },
      quantityNotes: calc.notes
    }
  };

  const claim = await args.store.claimT212OrderIntent({
    userId: args.userId,
    intentKey,
    ownerId: args.ownerId,
    leaseMs: INTENT_LEASE_MS,
    create: () => prepared
  });

  if (claim.status === "duplicate") {
    return {
      intent: claim.intent,
      submitted: claim.intent.state !== "PREPARED" && !claim.intent.dryRunOnly,
      readiness
    };
  }
  if (claim.status === "lease_held") {
    throw Object.assign(new Error("EXECUTION_LEASE_HELD"), {
      code: "EXECUTION_LEASE_HELD"
    });
  }

  let intent = claim.intent;
  if (!args.submit || args.automationMode === "MANUAL" || args.automationMode === "OFF") {
    return { intent, submitted: false, readiness };
  }
  if (args.automationMode === "LIVE_LOCKED") {
    throw Object.assign(new Error("T212_LIVE_LOCKED"), { code: "T212_LIVE_LOCKED" });
  }
  if (args.automationMode === "PRACTICE_AUTO") {
    const qual = await args.store.getT212PracticeAutoQualification(args.userId);
    const gate = evaluatePracticeAutoQualification(qual);
    if (!gate.unlocked) {
      throw Object.assign(new Error("PRACTICE_AUTO_LOCKED"), {
        code: "PRACTICE_AUTO_LOCKED",
        failedGates: gate.failedGates
      });
    }
  }

  intent = {
    ...intent,
    state: "SUBMITTING",
    updatedAt: nowIso(),
    dryRunOnly: false
  };
  await args.store.saveT212OrderIntent(intent);

  const creds = loadT212CredentialsFromServerEnv("PRACTICE");
  if (!creds) {
    throw Object.assign(new Error("T212_CREDENTIALS_MISSING_SERVER_SIDE"), {
      code: "T212_CREDENTIALS_MISSING_SERVER_SIDE"
    });
  }
  const factory = args.clientFactory ?? defaultOrderClientFactory;
  const client = factory("PRACTICE", creds);

  try {
    const order = await client.placeMarketOrder({
      ticker: intent.ticker,
      quantity: intent.signedQuantity
    });
    intent = {
      ...intent,
      state: "SUBMITTED",
      brokerOrderId: order.id != null ? String(order.id) : null,
      brokerStatus: order.status ?? "NEW",
      submittedAt: nowIso(),
      updatedAt: nowIso()
    };
    await args.store.saveT212OrderIntent(intent);

    const pending = await client.getOrders();
    const hist = await client.getHistoricalOrders().catch(() => []);
    const snapshot = findOrderForIntent([...pending, ...hist], intent);
    const reconciled = reconcileIntentWithBrokerOrder(intent, snapshot, nowIso());
    intent = reconciled.intent;
    await args.store.saveT212OrderIntent(intent);
    await args.store.releaseT212OrderIntentLease(args.userId, intent.intentId, args.ownerId);
    return { intent, submitted: true, readiness };
  } catch (e) {
    if (e instanceof T212ApiError && e.code === "TIMEOUT") {
      intent = markIntentUnknownAfterTimeout(intent, nowIso(), "TIMEOUT_AFTER_DISPATCH");
      await args.store.saveT212OrderIntent(intent);
      try {
        const pending = await client.getOrders();
        const hist = await client.getHistoricalOrders().catch(() => []);
        const snapshot = findOrderForIntent([...pending, ...hist], intent);
        const reconciled = reconcileIntentWithBrokerOrder(intent, snapshot, nowIso());
        intent = reconciled.intent;
        await args.store.saveT212OrderIntent(intent);
      } catch {
        /* keep UNKNOWN */
      }
      await args.store.releaseT212OrderIntentLease(args.userId, intent.intentId, args.ownerId);
      throw Object.assign(new Error("ORDER_STATE_UNKNOWN"), {
        code: "ORDER_STATE_UNKNOWN",
        intentId: intent.intentId
      });
    }
    intent = {
      ...intent,
      state: "REJECTED",
      rejectionReason: e instanceof T212ApiError ? e.code : "SUBMIT_FAILED",
      updatedAt: nowIso()
    };
    await args.store.saveT212OrderIntent(intent);
    await args.store.releaseT212OrderIntentLease(args.userId, intent.intentId, args.ownerId);
    throw e;
  }
}

export async function recoverUnresolvedT212Intents(args: {
  userId: string;
  store: AutoTradeStorePort;
  clientFactory?: T212ClientFactory;
}): Promise<T212OrderIntent[]> {
  assertLiveExecutionDisabled();
  const unresolved = await args.store.listUnresolvedT212OrderIntents(args.userId);
  if (unresolved.length === 0) return [];
  const creds = loadT212CredentialsFromServerEnv("PRACTICE");
  if (!creds) return unresolved;
  const client = (args.clientFactory ?? defaultOrderClientFactory)("PRACTICE", creds);
  const pending = await client.getOrders();
  const hist = await client.getHistoricalOrders().catch(() => []);
  const all = [...pending, ...hist];
  const out: T212OrderIntent[] = [];
  for (const intent of unresolved) {
    if (!isUnresolvedIntentState(intent.state)) {
      out.push(intent);
      continue;
    }
    const snapshot = findOrderForIntent(all, intent);
    const reconciled = reconcileIntentWithBrokerOrder(intent, snapshot, nowIso());
    if (reconciled.changed) {
      await args.store.saveT212OrderIntent(reconciled.intent);
    }
    out.push(reconciled.intent);
  }
  return out;
}
