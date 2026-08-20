import { describe, expect, it } from "vitest";
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import {
  PROTO_OA_ORDER_TYPE_MARKET,
  PROTO_OA_TIF_IMMEDIATE_OR_CANCEL,
  SPOT_PRICE_SCALE,
  buildProtoMarketNewOrder,
  relativeProtectionFromGeometry
} from "../../../../../src/services/broker/ctrader/demoTransport/newOrderPayload";
import { generateFastClientOrderId } from "../../../../../src/services/broker/ctrader/demoTransport/clientOrderId";

describe("FAST NewOrder payload vs installed proto", () => {
  const connection = new CTraderConnection({ host: "127.0.0.1", port: 9 });
  const newOrderType = connection.getPayloadTypeByName("ProtoOANewOrderReq");

  it("installed proto exposes ProtoOANewOrderReq", () => {
    expect(newOrderType).toBeGreaterThan(0);
  });

  it("production success geometry converts to proto 1/100000 relatives", () => {
    const rel = relativeProtectionFromGeometry({
      side: "BUY",
      entry: 4396.35,
      stopLoss: 4395.88,
      takeProfit: 4397.98
    });
    expect(rel.stopDistancePrice).toBeCloseTo(0.47, 8);
    expect(rel.tpDistancePrice).toBeCloseTo(1.63, 8);
    expect(rel.relativeStopLoss).toBe(Math.round(0.47 * SPOT_PRICE_SCALE));
    expect(rel.relativeTakeProfit).toBe(Math.round(1.63 * SPOT_PRICE_SCALE));
    const built = buildProtoMarketNewOrder({
      ctidTraderAccountId: "48014710",
      symbolId: "41",
      side: "BUY",
      volumeCents: 9200,
      relativeStopLoss: rel.relativeStopLoss,
      relativeTakeProfit: rel.relativeTakeProfit,
      clientOrderId: generateFastClientOrderId(
        "fast_BUY_BREAKOUT_BREAKOUT:BULLISH:4393_2_1:4396_37",
        "owner"
      ),
      label: "corr_msx3w970_f24afed5",
      comment: "GMQ corr_msx3w970_f24afed5",
      symbolDigits: 2,
      pipPosition: 1
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload.orderType).toBe(PROTO_OA_ORDER_TYPE_MARKET);
    expect(built.payload.timeInForce).toBe(PROTO_OA_TIF_IMMEDIATE_OR_CANCEL);
    expect(built.payload.tradeSide).toBe(1);
    expect(built.payload.volume).toBe(9200);
    expect(built.payload.stopLoss).toBeUndefined();
    expect(built.payload.takeProfit).toBeUndefined();
    expect(built.shape.stage).toBe("OK");
  });

  it("valid SELL, min volume, and volume step pass", () => {
    const rel = relativeProtectionFromGeometry({
      side: "SELL",
      entry: 4400,
      stopLoss: 4401,
      takeProfit: 4398
    });
    const built = buildProtoMarketNewOrder({
      ctidTraderAccountId: 48014710,
      symbolId: 41,
      side: "SELL",
      volumeCents: 100,
      relativeStopLoss: rel.relativeStopLoss,
      relativeTakeProfit: rel.relativeTakeProfit,
      clientOrderId: generateFastClientOrderId("fast_SELL_BREAKOUT_x", "o"),
      minVolumeCents: 100,
      stepVolumeCents: 100
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload.tradeSide).toBe(2);
  });

  it("rejects volume below minimum and off-step volume", () => {
    const base = {
      ctidTraderAccountId: 48014710,
      symbolId: 41,
      side: "BUY" as const,
      relativeStopLoss: 47000,
      relativeTakeProfit: 163000,
      clientOrderId: generateFastClientOrderId("fast_BUY_v", "o")
    };
    expect(
      buildProtoMarketNewOrder({ ...base, volumeCents: 50, minVolumeCents: 100 }).reason
    ).toBe("VOLUME_MIN");
    expect(
      buildProtoMarketNewOrder({
        ...base,
        volumeCents: 150,
        stepVolumeCents: 100
      }).reason
    ).toBe("VOLUME_STEP");
  });

  it("rejects stop/TP closer than symbol minimum distance", () => {
    const built = buildProtoMarketNewOrder({
      ctidTraderAccountId: 48014710,
      symbolId: 41,
      side: "BUY",
      volumeCents: 100,
      relativeStopLoss: 1000,
      relativeTakeProfit: 1000,
      clientOrderId: generateFastClientOrderId("fast_BUY_min", "o"),
      stopDistancePrice: 0.01,
      tpDistancePrice: 0.01,
      minStopDistancePrice: 0.3,
      minTpDistancePrice: 0.3
    });
    expect(built.ok).toBe(false);
    expect(built.reason).toBe("MIN_STOP_DISTANCE");
  });

  it("rejects malformed clientOrderId and absolute SL/TP are never encoded", () => {
    const bad = buildProtoMarketNewOrder({
      ctidTraderAccountId: 48014710,
      symbolId: 41,
      side: "BUY",
      volumeCents: 100,
      relativeStopLoss: 47000,
      relativeTakeProfit: 163000,
      clientOrderId: "fa with spaces!!"
    });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("CLIENT_ORDER_ID");
    const good = buildProtoMarketNewOrder({
      ctidTraderAccountId: 48014710,
      symbolId: 41,
      side: "BUY",
      volumeCents: 100,
      relativeStopLoss: 47000,
      relativeTakeProfit: 163000,
      clientOrderId: generateFastClientOrderId("fast_BUY_ok", "o")
    });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect("stopLoss" in good.payload).toBe(false);
    expect("takeProfit" in good.payload).toBe(false);
  });
});
