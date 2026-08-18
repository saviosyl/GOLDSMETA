/**
 * FAST Demo NewOrder transport.
 *
 * Installed @reiryoku/ctrader-layer sendCommand("ProtoOANewOrderReq") does
 * NOT return ProtoOAExecutionEvent (no ProtoOANewOrderRes → immediate {}).
 * Execution / reject arrive as push events. This module:
 *   1. treats a sendCommand payload as PRIMARY when it is execution-like
 *   2. otherwise correlates ProtoOAExecutionEvent / OrderErrorEvent / ErrorRes
 *   3. never maps a known reject to CTRADER_ORDER_TIMEOUT
 *   4. never retries NewOrder after an uncertain send
 */

import { sanitizeBrokerErrorCode } from "./brokerTelemetry";
import { withBoundedOp, BoundedOpTimeoutError } from "./boundedOp";
import {
  matchReconcileByClientOrderId,
  type ReconcileSnapshot
} from "./orderReconcile";
import {
  buildProtoMarketNewOrder,
  type SanitizedNewOrderShape
} from "./newOrderPayload";
import {
  normalizeBrokerPrice,
  normalizeFilledLots,
  presentEconomicNumber
} from "./brokerFillEconomics";
import { FAST_CLIENT_ORDER_ID_MAX_LEN } from "./clientOrderId";

export type BrokerOrderOutcome =
  | "BROKER_FILLED"
  | "BROKER_ACCEPTED"
  | "BROKER_REJECTED"
  | "BROKER_SUBMIT_ERROR"
  | "BROKER_OUTCOME_UNKNOWN"
  | "BROKER_TIMEOUT_RECONCILED_FILLED"
  | "BROKER_TIMEOUT_RECONCILED_NOT_FOUND"
  | "BROKER_ACCEPTED_PENDING_FILL";

export type FastOrderRequest = {
  ctidTraderAccountId: string;
  symbolId: string;
  side: "BUY" | "SELL";
  volume: number;
  relativeStopLoss?: number;
  relativeTakeProfit?: number;
  clientOrderId: string;
  label?: string;
  comment?: string;
  symbolDigits?: number | null;
  pipPosition?: number | null;
  minStopDistancePrice?: number | null;
  minTpDistancePrice?: number | null;
  minVolumeCents?: number | null;
  stepVolumeCents?: number | null;
  stopDistancePrice?: number | null;
  tpDistancePrice?: number | null;
};

export type FastOrderResult = {
  accepted: boolean;
  outcome: BrokerOrderOutcome;
  executionType: string | null;
  orderId: string | null;
  positionId: string | null;
  errorCode: string | null;
  clientOrderId: string;
  fillPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  filledVolumeLots: number | null;
  ctidTraderAccountId: string;
  requestSent: boolean;
  newOrderReqCount: number;
  payloadShape?: SanitizedNewOrderShape | null;
  raw?: Record<string, unknown>;
};

export type OrderTransportEvent = {
  name: string;
  payload: Record<string, unknown>;
};

export type OrderTransportPort = {
  sendNewOrder: (payload: Record<string, unknown>) => Promise<{
    confirmedSent: boolean;
    response: Record<string, unknown>;
  }>;
  onEvent: (listener: (event: OrderTransportEvent) => void) => () => void;
};

export type ReconcilePort = {
  reconcile: () => Promise<ReconcileSnapshot>;
};

const DEFAULT_EVENT_WAIT_MS = 8_000;
const DEFAULT_SEND_WAIT_MS = 8_000;
/** Must cover underlying FastDemoSession sendCommand timeout (~12s). */
const DEFAULT_SEND_UNCERTAINTY_MS = 15_000;
const DEFAULT_RECONCILE_ATTEMPTS = 2;
const DEFAULT_RECONCILE_GAP_MS = 250;

function asText(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function unwrapDescriptor(payload: Record<string, unknown>): Record<string, unknown> {
  const descriptor = payload.descriptor;
  if (descriptor && typeof descriptor === "object") {
    return { ...payload, ...(descriptor as Record<string, unknown>) };
  }
  return payload;
}

export function isExecutionLikePayload(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const row = unwrapDescriptor(value as Record<string, unknown>);
  return (
    row.executionType != null ||
    row.order != null ||
    row.position != null ||
    row.deal != null ||
    row.errorCode != null ||
    row.orderId != null
  );
}

export function normalizeExecutionType(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper === "2" || upper === "ORDER_ACCEPTED") return "ORDER_ACCEPTED";
  if (upper === "3" || upper === "ORDER_FILLED") return "ORDER_FILLED";
  if (upper === "7" || upper === "ORDER_REJECTED") return "ORDER_REJECTED";
  return upper;
}

function extractIds(payload: Record<string, unknown>): {
  orderId: string | null;
  positionId: string | null;
  clientOrderId: string | null;
  errorCode: string | null;
  executionType: string | null;
} {
  const row = unwrapDescriptor(payload);
  const order = (row.order ?? {}) as Record<string, unknown>;
  const position = (row.position ?? {}) as Record<string, unknown>;
  return {
    orderId:
      asText(order.orderId) ?? asText(row.orderId) ?? asText(payload.orderId),
    positionId:
      asText(position.positionId) ??
      asText(row.positionId) ??
      asText(payload.positionId),
    clientOrderId:
      asText(order.clientOrderId) ??
      asText(row.clientOrderId) ??
      asText(payload.clientOrderId),
    errorCode: asText(row.errorCode ?? row.description ?? payload.errorCode),
    executionType: normalizeExecutionType(row.executionType ?? payload.executionType)
  };
}

function extractFill(payload: Record<string, unknown>): {
  fillPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  filledVolumeLots: number | null;
} {
  const row = unwrapDescriptor(payload);
  const position = (row.position ?? {}) as Record<string, unknown>;
  const trade = (position.tradeData ?? position.trade ?? {}) as Record<
    string,
    unknown
  >;
  const deal = (row.deal ?? {}) as Record<string, unknown>;
  const volUnits =
    presentEconomicNumber(deal.filledVolume) ??
    presentEconomicNumber(trade.volume) ??
    presentEconomicNumber(position.volume);
  return {
    fillPrice:
      normalizeBrokerPrice(deal.executionPrice) ??
      normalizeBrokerPrice(position.price) ??
      normalizeBrokerPrice(trade.price) ??
      normalizeBrokerPrice(row.price),
    stopLoss:
      normalizeBrokerPrice(position.stopLoss) ??
      normalizeBrokerPrice(trade.stopLoss) ??
      normalizeBrokerPrice(row.stopLoss),
    takeProfit:
      normalizeBrokerPrice(position.takeProfit) ??
      normalizeBrokerPrice(trade.takeProfit) ??
      normalizeBrokerPrice(row.takeProfit),
    filledVolumeLots: normalizeFilledLots({
      filledVolumeLots: null,
      filledVolumeCents: volUnits
    })
  };
}

function payloadMatchesClientOrder(
  payload: Record<string, unknown>,
  clientOrderId: string
): boolean {
  const ids = extractIds(payload);
  if (!ids.clientOrderId) return true;
  return ids.clientOrderId === clientOrderId;
}

function classifyKnownPayload(
  name: string,
  payload: Record<string, unknown>,
  clientOrderId: string
): {
  outcome: BrokerOrderOutcome;
  accepted: boolean;
  errorCode: string | null;
  executionType: string | null;
} | null {
  if (!payloadMatchesClientOrder(payload, clientOrderId)) return null;
  const ids = extractIds(payload);
  const event = name.toUpperCase();

  if (
    event.includes("ORDERERROREVENT") ||
    event.includes("ERRORRES") ||
    event.includes("ERROR_RES")
  ) {
    return {
      outcome: "BROKER_REJECTED",
      accepted: false,
      errorCode: sanitizeBrokerErrorCode(ids.errorCode ?? "BROKER_REJECTED"),
      executionType: ids.executionType
    };
  }

  if (ids.errorCode) {
    return {
      outcome: "BROKER_REJECTED",
      accepted: false,
      errorCode: sanitizeBrokerErrorCode(ids.errorCode),
      executionType: ids.executionType
    };
  }

  if (ids.executionType === "ORDER_REJECTED") {
    return {
      outcome: "BROKER_REJECTED",
      accepted: false,
      errorCode: sanitizeBrokerErrorCode("ORDER_REJECTED"),
      executionType: ids.executionType
    };
  }

  if (ids.executionType === "ORDER_FILLED") {
    return {
      outcome: "BROKER_FILLED",
      accepted: true,
      errorCode: null,
      executionType: ids.executionType
    };
  }

  if (ids.positionId != null && ids.executionType !== "ORDER_REJECTED") {
    return {
      outcome: "BROKER_FILLED",
      accepted: true,
      errorCode: null,
      executionType: ids.executionType ?? "ORDER_FILLED"
    };
  }

  if (ids.executionType === "ORDER_ACCEPTED" || ids.orderId != null) {
    return {
      outcome: "BROKER_ACCEPTED",
      accepted: false,
      errorCode: null,
      executionType: ids.executionType ?? "ORDER_ACCEPTED"
    };
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function submitFastMarketOrder(args: {
  request: FastOrderRequest;
  transport: OrderTransportPort;
  reconcile?: ReconcilePort;
  sendTimeoutMs?: number;
  /**
   * Total wait from send start covering underlying sendCommand uncertainty.
   * Outer withBoundedOp may expire earlier; we keep listening (no resend)
   * until this window ends, then optionally reconcile by clientOrderId.
   */
  sendUncertaintyMs?: number;
  eventWaitMs?: number;
  reconcileAttempts?: number;
  reconcileGapMs?: number;
}): Promise<FastOrderResult> {
  const clientOrderId = args.request.clientOrderId.trim().slice(0, FAST_CLIENT_ORDER_ID_MAX_LEN);
  const built = buildProtoMarketNewOrder({
    ctidTraderAccountId: args.request.ctidTraderAccountId,
    symbolId: args.request.symbolId,
    side: args.request.side,
    volumeCents: args.request.volume,
    relativeStopLoss: args.request.relativeStopLoss,
    relativeTakeProfit: args.request.relativeTakeProfit,
    clientOrderId,
    label: args.request.label,
    comment: args.request.comment,
    symbolDigits: args.request.symbolDigits,
    pipPosition: args.request.pipPosition,
    minStopDistancePrice: args.request.minStopDistancePrice,
    minTpDistancePrice: args.request.minTpDistancePrice,
    minVolumeCents: args.request.minVolumeCents,
    stepVolumeCents: args.request.stepVolumeCents,
    stopDistancePrice: args.request.stopDistancePrice,
    tpDistancePrice: args.request.tpDistancePrice
  });
  if (!built.ok) {
    return {
      accepted: false,
      outcome: "BROKER_SUBMIT_ERROR",
      executionType: null,
      orderId: null,
      positionId: null,
      errorCode: `PAYLOAD_${built.reason}`,
      clientOrderId,
      fillPrice: null,
      stopLoss: null,
      takeProfit: null,
      filledVolumeLots: null,
      ctidTraderAccountId: args.request.ctidTraderAccountId,
      requestSent: false,
      newOrderReqCount: 0,
      payloadShape: built.shape
    };
  }
  if (!clientOrderId) {
    return {
      accepted: false,
      outcome: "BROKER_SUBMIT_ERROR",
      executionType: null,
      orderId: null,
      positionId: null,
      errorCode: "CLIENT_ORDER_ID_REQUIRED",
      clientOrderId: "",
      fillPrice: null,
      stopLoss: null,
      takeProfit: null,
      filledVolumeLots: null,
      ctidTraderAccountId: args.request.ctidTraderAccountId,
      requestSent: false,
      newOrderReqCount: 0
    };
  }

  type Classified = NonNullable<ReturnType<typeof classifyKnownPayload>>;
  let latest: Record<string, unknown> = {};
  let classified: Classified | null = null;
  let settled = false;

  const finishKnown = (
    name: string,
    payload: Record<string, unknown>
  ): boolean => {
    const next = classifyKnownPayload(name, payload, clientOrderId);
    if (!next) return false;
    latest = { ...latest, ...unwrapDescriptor(payload) };
    classified = next as Classified;
    const ids = extractIds(unwrapDescriptor(payload));
    if (next.outcome === "BROKER_ACCEPTED" && !ids.positionId) {
      return false;
    }
    settled = true;
    return true;
  };

  const unsubscribe = args.transport.onEvent((event) => {
    if (settled) return;
    finishKnown(event.name, event.payload);
  });

  const payload = built.payload;

  let requestSent = false;
  let newOrderReqCount = 0;
  let sendResponse: Record<string, unknown> = {};
  const sendStartedAt = Date.now();
  const uncertaintyMs =
    args.sendUncertaintyMs ?? DEFAULT_SEND_UNCERTAINTY_MS;

  const finishFromClassified = (): FastOrderResult | null => {
    const known = classified as Classified | null;
    if (known === null || known.outcome === "BROKER_ACCEPTED") return null;
    const ids = extractIds(latest);
    const fill = extractFill(latest);
    return {
      accepted: known.accepted,
      outcome: known.outcome,
      executionType: known.executionType,
      orderId: ids.orderId,
      positionId: ids.positionId,
      errorCode: known.errorCode,
      clientOrderId,
      fillPrice: fill.fillPrice,
      stopLoss: fill.stopLoss,
      takeProfit: fill.takeProfit,
      filledVolumeLots: fill.filledVolumeLots,
      ctidTraderAccountId: args.request.ctidTraderAccountId,
      requestSent,
      newOrderReqCount,
      raw: latest
    };
  };

  const tryReconcileFilled = async (): Promise<FastOrderResult | null> => {
    if (!args.reconcile) return null;
    const attempts = Math.min(
      args.reconcileAttempts ?? DEFAULT_RECONCILE_ATTEMPTS,
      2
    );
    const gap = args.reconcileGapMs ?? DEFAULT_RECONCILE_GAP_MS;
    for (let i = 0; i < attempts; i += 1) {
      try {
        const snapshot = await args.reconcile.reconcile();
        const match = matchReconcileByClientOrderId({ clientOrderId, snapshot });
        if (match.matched && match.positionId) {
          return {
            accepted: true,
            outcome: "BROKER_TIMEOUT_RECONCILED_FILLED",
            executionType: "RECONCILED",
            orderId: match.orderId,
            positionId: match.positionId,
            errorCode: null,
            clientOrderId,
            fillPrice: null,
            stopLoss: null,
            takeProfit: null,
            filledVolumeLots: null,
            ctidTraderAccountId: args.request.ctidTraderAccountId,
            requestSent,
            newOrderReqCount,
            raw: { reconcile: match, afterSendTimeout: true }
          };
        }
      } catch {
        /* bounded miss */
      }
      if (i < attempts - 1) await sleep(gap);
    }
    return null;
  };

  try {
    const sent = await withBoundedOp(
      "NEWORDER_SEND",
      args.sendTimeoutMs ?? DEFAULT_SEND_WAIT_MS,
      () => args.transport.sendNewOrder(payload)
    );
    requestSent = sent.confirmedSent;
    if (sent.confirmedSent) newOrderReqCount = 1;
    sendResponse = sent.response ?? {};
    if (isExecutionLikePayload(sendResponse)) {
      finishKnown("sendCommand", sendResponse);
    }
  } catch (err) {
    if (err instanceof BoundedOpTimeoutError) {
      // Outer send wait expired while underlying sendCommand may still be in
      // flight. Do NOT resend. Keep listening through the uncertainty window,
      // then read-only reconcile by exact clientOrderId. Terminal "not found"
      // is owned by the durable ENTRY PENDING watchdog — not this short path.
      while (!settled && Date.now() - sendStartedAt < uncertaintyMs) {
        await sleep(20);
      }
      const knownEarly = finishFromClassified();
      if (knownEarly) {
        unsubscribe();
        return knownEarly;
      }
      const reconciled = await tryReconcileFilled();
      unsubscribe();
      if (reconciled) return reconciled;
      return {
        accepted: false,
        outcome: "BROKER_OUTCOME_UNKNOWN",
        executionType: null,
        orderId: null,
        positionId: null,
        errorCode: "NEWORDER_SEND_TIMEOUT",
        clientOrderId,
        fillPrice: null,
        stopLoss: null,
        takeProfit: null,
        filledVolumeLots: null,
        ctidTraderAccountId: args.request.ctidTraderAccountId,
        requestSent: false,
        newOrderReqCount: 0,
        payloadShape: built.shape,
        raw: { error: err.message, uncertainSend: true }
      };
    }
    unsubscribe();
    return {
      accepted: false,
      outcome: requestSent ? "BROKER_OUTCOME_UNKNOWN" : "BROKER_SUBMIT_ERROR",
      executionType: null,
      orderId: null,
      positionId: null,
      errorCode: sanitizeBrokerErrorCode(
        err instanceof Error ? err.message : "BROKER_SUBMIT_ERROR"
      ),
      clientOrderId,
      fillPrice: null,
      stopLoss: null,
      takeProfit: null,
      filledVolumeLots: null,
      ctidTraderAccountId: args.request.ctidTraderAccountId,
      requestSent,
      newOrderReqCount,
      raw: { error: err instanceof Error ? err.message : String(err) }
    };
  }

  if (!settled) {
    const waitMs = args.eventWaitMs ?? DEFAULT_EVENT_WAIT_MS;
    const started = Date.now();
    while (!settled && Date.now() - started < waitMs) {
      await sleep(20);
    }
  }
  unsubscribe();

  const known = classified as Classified | null;
  if (known !== null && known.outcome !== "BROKER_ACCEPTED") {
    const ids = extractIds(latest);
    const fill = extractFill(latest);
    return {
      accepted: known.accepted,
      outcome: known.outcome,
      executionType: known.executionType,
      orderId: ids.orderId,
      positionId: ids.positionId,
      errorCode: known.errorCode,
      clientOrderId,
      fillPrice: fill.fillPrice,
      stopLoss: fill.stopLoss,
      takeProfit: fill.takeProfit,
      filledVolumeLots: fill.filledVolumeLots,
      ctidTraderAccountId: args.request.ctidTraderAccountId,
      requestSent,
      newOrderReqCount,
      payloadShape: built.shape,
      raw: {
        ...latest,
        payloadShape: built.shape
      }
    };
  }

  if (!requestSent) {
    return {
      accepted: false,
      outcome: "BROKER_SUBMIT_ERROR",
      executionType: null,
      orderId: null,
      positionId: null,
      errorCode: "NEWORDER_NOT_SENT",
      clientOrderId,
      fillPrice: null,
      stopLoss: null,
      takeProfit: null,
      filledVolumeLots: null,
      ctidTraderAccountId: args.request.ctidTraderAccountId,
      requestSent: false,
      newOrderReqCount: 0,
      raw: sendResponse
    };
  }

  const acceptedIds = extractIds(latest);
  const acceptedKnown = known?.outcome === "BROKER_ACCEPTED";

  if (!args.reconcile) {
    if (acceptedKnown) {
      return {
        accepted: false,
        outcome: "BROKER_ACCEPTED",
        executionType: acceptedIds.executionType ?? "ORDER_ACCEPTED",
        orderId: acceptedIds.orderId,
        positionId: null,
        errorCode: null,
        clientOrderId,
        fillPrice: null,
        stopLoss: null,
        takeProfit: null,
        filledVolumeLots: null,
        ctidTraderAccountId: args.request.ctidTraderAccountId,
        requestSent: true,
        newOrderReqCount,
        raw: latest
      };
    }
    return {
      accepted: false,
      outcome: "BROKER_OUTCOME_UNKNOWN",
      executionType: null,
      orderId: null,
      positionId: null,
      errorCode: "BROKER_OUTCOME_UNKNOWN",
      clientOrderId,
      fillPrice: null,
      stopLoss: null,
      takeProfit: null,
      filledVolumeLots: null,
      ctidTraderAccountId: args.request.ctidTraderAccountId,
      requestSent: true,
      newOrderReqCount,
      raw: sendResponse
    };
  }

  const attempts = args.reconcileAttempts ?? DEFAULT_RECONCILE_ATTEMPTS;
  const gap = args.reconcileGapMs ?? DEFAULT_RECONCILE_GAP_MS;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const snapshot = await args.reconcile.reconcile();
      const match = matchReconcileByClientOrderId({ clientOrderId, snapshot });
      if (match.matched && match.positionId) {
        return {
          accepted: true,
          outcome: "BROKER_TIMEOUT_RECONCILED_FILLED",
          executionType: "RECONCILED",
          orderId: match.orderId,
          positionId: match.positionId,
          errorCode: null,
          clientOrderId,
          fillPrice: null,
          stopLoss: null,
          takeProfit: null,
          filledVolumeLots: null,
          ctidTraderAccountId: args.request.ctidTraderAccountId,
          requestSent: true,
          newOrderReqCount,
          raw: { reconcile: match }
        };
      }
    } catch {
      /* bounded miss — try again */
    }
    if (i < attempts - 1) await sleep(gap);
  }

  if (acceptedKnown) {
    return {
      accepted: false,
      outcome: "BROKER_ACCEPTED",
      executionType: acceptedIds.executionType ?? "ORDER_ACCEPTED",
      orderId: acceptedIds.orderId,
      positionId: null,
      errorCode: null,
      clientOrderId,
      fillPrice: null,
      stopLoss: null,
      takeProfit: null,
      filledVolumeLots: null,
      ctidTraderAccountId: args.request.ctidTraderAccountId,
      requestSent: true,
      newOrderReqCount,
      raw: latest
    };
  }

  return {
    accepted: false,
    outcome: "BROKER_TIMEOUT_RECONCILED_NOT_FOUND",
    executionType: null,
    orderId: null,
    positionId: null,
    errorCode: "BROKER_TIMEOUT_RECONCILED_NOT_FOUND",
    clientOrderId,
    fillPrice: null,
    stopLoss: null,
    takeProfit: null,
    filledVolumeLots: null,
    ctidTraderAccountId: args.request.ctidTraderAccountId,
    requestSent: true,
    newOrderReqCount,
    raw: sendResponse
  };
}

export function hasBrokerFillEvidence(result: {
  outcome?: string | null;
  positionId?: string | null;
  executionType?: string | null;
}): boolean {
  if (!result.positionId) return false;
  const outcome = result.outcome ?? "";
  if (outcome === "BROKER_ACCEPTED" || outcome === "BROKER_ACCEPTED_PENDING_FILL") {
    return false;
  }
  return (
    outcome === "BROKER_FILLED" ||
    outcome === "BROKER_TIMEOUT_RECONCILED_FILLED" ||
    result.executionType === "ORDER_FILLED" ||
    result.executionType === "RECONCILED"
  );
}

export function toDemoMarketOrderResult(
  result: FastOrderResult
): {
  accepted: boolean;
  executionType: string | null;
  orderId: string | null;
  positionId: string | null;
  errorCode: string | null;
  clientOrderId: string | null;
  fillPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  filledVolumeLots: number | null;
  ctidTraderAccountId: string | null;
  outcome: BrokerOrderOutcome;
  requestSent: boolean;
  newOrderReqCount: number;
  payloadShape?: SanitizedNewOrderShape | null;
  raw?: Record<string, unknown>;
} {
  return {
    accepted: hasBrokerFillEvidence(result),
    executionType: result.executionType,
    orderId: result.orderId,
    positionId: result.positionId,
    errorCode: result.errorCode,
    clientOrderId: result.clientOrderId,
    fillPrice: result.fillPrice,
    stopLoss: result.stopLoss,
    takeProfit: result.takeProfit,
    filledVolumeLots: result.filledVolumeLots,
    ctidTraderAccountId: result.ctidTraderAccountId,
    outcome: result.outcome,
    requestSent: result.requestSent,
    newOrderReqCount: result.newOrderReqCount,
    payloadShape: result.payloadShape ?? null,
    raw: result.raw
  };
}
