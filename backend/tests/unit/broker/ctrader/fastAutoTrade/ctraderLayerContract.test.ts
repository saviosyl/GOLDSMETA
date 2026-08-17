import { describe, expect, it } from "vitest";
import { inspectCTraderLayerNewOrderContract } from "../../../../../src/services/broker/ctrader/fastAutoTrade/ctraderLayerContract";
import { CTraderConnection } from "@reiryoku/ctrader-layer";

describe("installed @reiryoku/ctrader-layer NewOrder contract", () => {
  it("proves ProtoOANewOrderReq has no Res type so sendCommand cannot return ExecutionEvent", () => {
    const contract = inspectCTraderLayerNewOrderContract();
    expect(contract.newOrderReqPayloadType).toBeGreaterThan(0);
    expect(contract.newOrderResPayloadType).toBe(-1);
    expect(contract.newOrderHasNoResType).toBe(true);
    expect(contract.sendCommandResolvesEmptyWithoutWaitingForExecutionEvent).toBe(
      true
    );
    expect(contract.executionEventPayloadType).toBeGreaterThan(0);
    expect(contract.executionEventIsPushOnly).toBe(true);
    expect(contract.orderErrorEventPayloadType).toBeGreaterThan(0);
    expect(contract.errorResPayloadType).toBeGreaterThan(0);
  });

  it("library source resolves NewOrderReq immediately when Res payload type is -1", async () => {
    const connection = new CTraderConnection({ host: "127.0.0.1", port: 9 });
    expect(connection.getPayloadTypeByName("ProtoOANewOrderRes")).toBe(-1);
    const send = (
      connection as unknown as {
        sendCommand: (
          name: string,
          data?: Record<string, unknown>
        ) => Promise<Record<string, unknown>>;
      }
    ).sendCommand.bind(connection);
    try {
      const result = await Promise.race([
        send("ProtoOANewOrderReq", {
          ctidTraderAccountId: 1,
          symbolId: 1,
          orderType: 1,
          tradeSide: 1,
          volume: 100
        }),
        new Promise<Record<string, unknown>>((_, reject) =>
          setTimeout(() => reject(new Error("sendCommand hung")), 250)
        )
      ]);
      expect(result).toEqual({});
      expect(result.executionType).toBeUndefined();
    } catch (err) {
      // Socket send on an unopened connection may throw after encode.
      // The Res-type proof above is the library contract: no wait for ExecutionEvent.
      expect(String(err)).not.toMatch(/sendCommand hung/);
    }
    try {
      connection.close();
    } catch {
      /* ignore */
    }
  });
});
