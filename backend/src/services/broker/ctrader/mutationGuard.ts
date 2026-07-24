/**
 * Hard fail-closed guards for any cTrader mutation path.
 */

import { assertCTraderMutationsDisabled } from "./flags";

export class CTraderMutationDisabledError extends Error {
  readonly code = "CTRADER_MUTATION_DISABLED";
  constructor(action: string) {
    super(`cTrader ${action} is disabled. No broker order may be submitted.`);
    this.name = "CTraderMutationDisabledError";
  }
}

export function denyCTraderMutation(action: string): never {
  assertCTraderMutationsDisabled();
  throw new CTraderMutationDisabledError(action);
}

export const DISABLED_ORDER_METHODS = {
  placeMarketBuy: () => denyCTraderMutation("placeMarketBuy"),
  placeMarketSell: () => denyCTraderMutation("placeMarketSell"),
  closePosition: () => denyCTraderMutation("closePosition"),
  partialClose: () => denyCTraderMutation("partialClose"),
  setStopLoss: () => denyCTraderMutation("setStopLoss"),
  setTakeProfit: () => denyCTraderMutation("setTakeProfit"),
  modifyProtection: () => denyCTraderMutation("modifyProtection"),
  cancelPendingOrder: () => denyCTraderMutation("cancelPendingOrder")
} as const;
