/**
 * Installed @reiryoku/ctrader-layer contract for ProtoOANewOrderReq.
 *
 * Do not assume sendCommand returns ProtoOAExecutionEvent — prove it
 * against the library sitting in node_modules.
 */

import { CTraderConnection } from "@reiryoku/ctrader-layer";

export type CTraderLayerNewOrderContract = {
  library: "@reiryoku/ctrader-layer";
  newOrderReqPayloadType: number;
  newOrderResPayloadType: number;
  executionEventPayloadType: number;
  orderErrorEventPayloadType: number;
  errorResPayloadType: number;
  /** True when the library has no ProtoOANewOrderRes message. */
  newOrderHasNoResType: boolean;
  /**
   * When true, sendCommand("ProtoOANewOrderReq") immediately resolves
   * with {} because getPayloadTypeByName("ProtoOANewOrderRes") === -1.
   * ProtoOAExecutionEvent is a push EVENT and is NOT returned by sendCommand.
   */
  sendCommandResolvesEmptyWithoutWaitingForExecutionEvent: boolean;
  executionEventIsPushOnly: boolean;
};

let cached: CTraderLayerNewOrderContract | null = null;

/**
 * Inspect protobuf payload-type map from a constructed (unopened) connection.
 * Does not open a socket or send bytes.
 */
export function inspectCTraderLayerNewOrderContract(): CTraderLayerNewOrderContract {
  if (cached) return cached;
  const connection = new CTraderConnection({
    host: "127.0.0.1",
    port: 9
  });
  const newOrderReqPayloadType = connection.getPayloadTypeByName("ProtoOANewOrderReq");
  const newOrderResPayloadType = connection.getPayloadTypeByName("ProtoOANewOrderRes");
  const executionEventPayloadType = connection.getPayloadTypeByName(
    "ProtoOAExecutionEvent"
  );
  const orderErrorEventPayloadType = connection.getPayloadTypeByName(
    "ProtoOAOrderErrorEvent"
  );
  const errorResPayloadType = connection.getPayloadTypeByName("ProtoOAErrorRes");
  try {
    connection.close();
  } catch {
    /* unopened */
  }

  const newOrderHasNoResType = newOrderResPayloadType === -1;
  cached = {
    library: "@reiryoku/ctrader-layer",
    newOrderReqPayloadType,
    newOrderResPayloadType,
    executionEventPayloadType,
    orderErrorEventPayloadType,
    errorResPayloadType,
    newOrderHasNoResType,
    sendCommandResolvesEmptyWithoutWaitingForExecutionEvent: newOrderHasNoResType,
    executionEventIsPushOnly: executionEventPayloadType > 0
  };
  return cached;
}
