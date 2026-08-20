/**
 * ProtoOANewOrderReq builder + sanitized payload-shape telemetry.
 *
 * Installed @reiryoku/ctrader-layer OpenApiMessages.proto:
 *   volume = int64 cents (100 = 1.00 lot)
 *   relativeStopLoss / relativeTakeProfit = int64, 1/100000 of a price unit
 *   clientOrderId maxLength = 50
 *   label maxLength = 100
 *   comment maxLength = 512
 *   MARKET (orderType=1) must not send absolute stopLoss/takeProfit
 */

import { FAST_CLIENT_ORDER_ID_MAX_LEN, isFastClientOrderIdCharset } from "./clientOrderId";

export const SPOT_PRICE_SCALE = 100_000;
export const CTRADER_VOLUME_CENTS_PER_LOT = 100;
export const PROTO_OA_ORDER_TYPE_MARKET = 1;
export const PROTO_OA_TRADE_SIDE_BUY = 1;
export const PROTO_OA_TRADE_SIDE_SELL = 2;
/** ProtoOATimeInForce.IMMEDIATE_OR_CANCEL — required for MARKET (not GTC default). */
export const PROTO_OA_TIF_IMMEDIATE_OR_CANCEL = 3;

export type NewOrderPayloadStage =
  | "ACCOUNT_ID"
  | "SYMBOL_ID"
  | "SIDE"
  | "VOLUME"
  | "VOLUME_STEP"
  | "VOLUME_MIN"
  | "CLIENT_ORDER_ID"
  | "LABEL"
  | "COMMENT"
  | "RELATIVE_STOP_LOSS"
  | "RELATIVE_TAKE_PROFIT"
  | "MIN_STOP_DISTANCE"
  | "MIN_TP_DISTANCE"
  | "ABSOLUTE_SL_TP_FORBIDDEN"
  | "ENCODE"
  | "OK";

export type SanitizedNewOrderShape = {
  stage: NewOrderPayloadStage;
  ok: boolean;
  orderType: typeof PROTO_OA_ORDER_TYPE_MARKET;
  tradeSide: 1 | 2 | null;
  volume: number | null;
  relativeStopLoss: number | null;
  relativeTakeProfit: number | null;
  clientOrderIdLength: number;
  clientOrderIdCharsetOk: boolean;
  labelLength: number;
  commentLength: number;
  hasAbsoluteStopLoss: boolean;
  hasAbsoluteTakeProfit: boolean;
  timeInForce: typeof PROTO_OA_TIF_IMMEDIATE_OR_CANCEL;
  symbolDigits: number | null;
  pipPosition: number | null;
  minStopDistancePrice: number | null;
  minTpDistancePrice: number | null;
  stopDistancePrice: number | null;
  tpDistancePrice: number | null;
};

export type RelativeProtection = {
  relativeStopLoss?: number;
  relativeTakeProfit?: number;
  stopDistancePrice: number | null;
  tpDistancePrice: number | null;
};

export function relativeProtectionFromGeometry(args: {
  side: "BUY" | "SELL";
  entry: number | null | undefined;
  stopLoss?: number | null;
  takeProfit?: number | null;
}): RelativeProtection {
  const entry = args.entry;
  const out: RelativeProtection = {
    stopDistancePrice: null,
    tpDistancePrice: null
  };
  if (entry == null || !Number.isFinite(entry)) return out;
  if (args.stopLoss != null && Number.isFinite(args.stopLoss)) {
    const dist =
      args.side === "BUY" ? entry - args.stopLoss : args.stopLoss - entry;
    if (dist > 0) {
      out.stopDistancePrice = dist;
      out.relativeStopLoss = Math.round(dist * SPOT_PRICE_SCALE);
    }
  }
  if (args.takeProfit != null && Number.isFinite(args.takeProfit)) {
    const dist =
      args.side === "BUY" ? args.takeProfit - entry : entry - args.takeProfit;
    if (dist > 0) {
      out.tpDistancePrice = dist;
      out.relativeTakeProfit = Math.round(dist * SPOT_PRICE_SCALE);
    }
  }
  return out;
}

export type BuildNewOrderArgs = {
  ctidTraderAccountId: string | number;
  symbolId: string | number;
  side: "BUY" | "SELL";
  volumeCents: number;
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

export type BuiltNewOrder =
  | {
      ok: true;
      payload: Record<string, number | string>;
      shape: SanitizedNewOrderShape;
    }
  | {
      ok: false;
      payload: null;
      shape: SanitizedNewOrderShape;
      reason: NewOrderPayloadStage;
    };

function int64(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (!Number.isInteger(n)) return null;
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

function shape(partial: Partial<SanitizedNewOrderShape> & { stage: NewOrderPayloadStage; ok: boolean }): SanitizedNewOrderShape {
  return {
    orderType: PROTO_OA_ORDER_TYPE_MARKET,
    tradeSide: null,
    volume: null,
    relativeStopLoss: null,
    relativeTakeProfit: null,
    clientOrderIdLength: 0,
    clientOrderIdCharsetOk: false,
    labelLength: 0,
    commentLength: 0,
    hasAbsoluteStopLoss: false,
    hasAbsoluteTakeProfit: false,
    timeInForce: PROTO_OA_TIF_IMMEDIATE_OR_CANCEL,
    symbolDigits: null,
    pipPosition: null,
    minStopDistancePrice: null,
    minTpDistancePrice: null,
    stopDistancePrice: null,
    tpDistancePrice: null,
    ...partial
  };
}

/**
 * Build a MARKET NewOrder payload that only contains proto-legal fields.
 * Absolute SL/TP are never included (unsupported for MARKET).
 */
export function buildProtoMarketNewOrder(args: BuildNewOrderArgs): BuiltNewOrder {
  const accountId = int64(Number(args.ctidTraderAccountId));
  const symbolId = int64(Number(args.symbolId));
  const tradeSide: 1 | 2 | null =
    args.side === "BUY"
      ? PROTO_OA_TRADE_SIDE_BUY
      : args.side === "SELL"
        ? PROTO_OA_TRADE_SIDE_SELL
        : null;
  const volume = int64(args.volumeCents);
  const clientOrderId = String(args.clientOrderId || "").trim();
  const label = String(args.label ?? "GoldMeta FAST Demo").slice(0, 100);
  const comment = String(args.comment ?? "GoldMeta FAST Demo").slice(0, 512);
  const relSl = args.relativeStopLoss != null ? int64(args.relativeStopLoss) : null;
  const relTp = args.relativeTakeProfit != null ? int64(args.relativeTakeProfit) : null;

  const base = {
    symbolDigits: args.symbolDigits ?? null,
    pipPosition: args.pipPosition ?? null,
    minStopDistancePrice: args.minStopDistancePrice ?? null,
    minTpDistancePrice: args.minTpDistancePrice ?? null,
    stopDistancePrice: args.stopDistancePrice ?? null,
    tpDistancePrice: args.tpDistancePrice ?? null,
    clientOrderIdLength: clientOrderId.length,
    clientOrderIdCharsetOk: isFastClientOrderIdCharset(clientOrderId),
    labelLength: label.length,
    commentLength: comment.length,
    volume,
    relativeStopLoss: relSl,
    relativeTakeProfit: relTp,
    tradeSide
  };

  if (accountId == null || accountId <= 0) {
    return { ok: false, payload: null, reason: "ACCOUNT_ID", shape: shape({ ...base, stage: "ACCOUNT_ID", ok: false }) };
  }
  if (symbolId == null || symbolId <= 0) {
    return { ok: false, payload: null, reason: "SYMBOL_ID", shape: shape({ ...base, stage: "SYMBOL_ID", ok: false }) };
  }
  if (tradeSide == null) {
    return { ok: false, payload: null, reason: "SIDE", shape: shape({ ...base, stage: "SIDE", ok: false }) };
  }
  if (volume == null || volume <= 0) {
    return { ok: false, payload: null, reason: "VOLUME", shape: shape({ ...base, stage: "VOLUME", ok: false }) };
  }
  if (args.minVolumeCents != null && volume < args.minVolumeCents) {
    return { ok: false, payload: null, reason: "VOLUME_MIN", shape: shape({ ...base, stage: "VOLUME_MIN", ok: false }) };
  }
  if (
    args.stepVolumeCents != null &&
    args.stepVolumeCents > 0 &&
    volume % args.stepVolumeCents !== 0
  ) {
    return { ok: false, payload: null, reason: "VOLUME_STEP", shape: shape({ ...base, stage: "VOLUME_STEP", ok: false }) };
  }
  if (
    !clientOrderId ||
    clientOrderId.length > FAST_CLIENT_ORDER_ID_MAX_LEN ||
    !isFastClientOrderIdCharset(clientOrderId)
  ) {
    return {
      ok: false,
      payload: null,
      reason: "CLIENT_ORDER_ID",
      shape: shape({ ...base, stage: "CLIENT_ORDER_ID", ok: false })
    };
  }
  if (args.relativeStopLoss != null && (relSl == null || relSl <= 0)) {
    return {
      ok: false,
      payload: null,
      reason: "RELATIVE_STOP_LOSS",
      shape: shape({ ...base, stage: "RELATIVE_STOP_LOSS", ok: false })
    };
  }
  if (args.relativeTakeProfit != null && (relTp == null || relTp <= 0)) {
    return {
      ok: false,
      payload: null,
      reason: "RELATIVE_TAKE_PROFIT",
      shape: shape({ ...base, stage: "RELATIVE_TAKE_PROFIT", ok: false })
    };
  }
  if (
    args.minStopDistancePrice != null &&
    args.stopDistancePrice != null &&
    args.stopDistancePrice + 1e-12 < args.minStopDistancePrice
  ) {
    return {
      ok: false,
      payload: null,
      reason: "MIN_STOP_DISTANCE",
      shape: shape({ ...base, stage: "MIN_STOP_DISTANCE", ok: false })
    };
  }
  if (
    args.minTpDistancePrice != null &&
    args.tpDistancePrice != null &&
    args.tpDistancePrice + 1e-12 < args.minTpDistancePrice
  ) {
    return {
      ok: false,
      payload: null,
      reason: "MIN_TP_DISTANCE",
      shape: shape({ ...base, stage: "MIN_TP_DISTANCE", ok: false })
    };
  }

  const payload: Record<string, number | string> = {
    ctidTraderAccountId: accountId,
    symbolId,
    orderType: PROTO_OA_ORDER_TYPE_MARKET,
    tradeSide,
    volume,
    timeInForce: PROTO_OA_TIF_IMMEDIATE_OR_CANCEL,
    clientOrderId,
    label,
    comment
  };
  if (relSl != null && relSl > 0) payload.relativeStopLoss = relSl;
  if (relTp != null && relTp > 0) payload.relativeTakeProfit = relTp;

  return {
    ok: true,
    payload,
    shape: shape({ ...base, stage: "OK", ok: true })
  };
}

export function estimateCommissionRoundTrip(args: {
  lots: number;
  entryPrice?: number | null;
  preciseTradingCommissionRate?: number | null;
  commission?: number | null;
  commissionType?: string | null;
}): number | null {
  const lots = args.lots;
  if (!(lots > 0) || !Number.isFinite(lots)) return null;
  const type = String(args.commissionType ?? "").toUpperCase();
  const scaled =
    args.preciseTradingCommissionRate != null &&
    Number.isFinite(args.preciseTradingCommissionRate) &&
    args.preciseTradingCommissionRate > 0
      ? args.preciseTradingCommissionRate / 1e8
      : args.commission != null &&
          Number.isFinite(args.commission) &&
          args.commission > 0
        ? args.commission > 1
          ? args.commission / 1e8
          : args.commission
        : null;
  if (scaled == null || !(scaled > 0)) return null;
  if (type.includes("LOT") && !type.includes("MILLION")) {
    // Diagnostic: 2 legs × USD-per-lot. Not used for sizing.
    return Number((2 * lots * scaled).toFixed(4));
  }
  if (type.includes("MILLION")) {
    const price = args.entryPrice;
    if (price == null || !Number.isFinite(price) || price <= 0) return null;
    const notionalUsd = lots * price; // Pepperstone Demo XAUUSD: 1 lot = 1 oz
    return Number((2 * scaled * (notionalUsd / 1e6)).toFixed(4));
  }
  return null;
}
