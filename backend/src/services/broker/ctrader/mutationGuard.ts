/**
 * Fail-closed guards for cTrader mutation paths.
 * Demo market orders + Demo position management go through dedicated helpers.
 * Live and generic broker mutation paths stay denied.
 */

import {
  assertCTraderLiveMutationsDisabled,
  isCTraderDemoOrderSubmissionEnabled
} from "./flags";

export class CTraderMutationDisabledError extends Error {
  readonly code = "CTRADER_MUTATION_DISABLED";
  constructor(action: string) {
    super(`cTrader ${action} is disabled. No broker order may be submitted.`);
    this.name = "CTraderMutationDisabledError";
  }
}

export function denyCTraderMutation(action: string): never {
  assertCTraderLiveMutationsDisabled();
  throw new CTraderMutationDisabledError(action);
}

/** Deny unless Demo submission is intentionally enabled (still never Live). */
export function assertDemoMarketOrderAllowed(): void {
  assertCTraderLiveMutationsDisabled();
  if (!isCTraderDemoOrderSubmissionEnabled()) {
    throw new CTraderMutationDisabledError("placeMarketOrder");
  }
}

/**
 * Demo-only SL amend / partial close for lifecycle management.
 * Requires the same Demo submission gate; Live remains impossible.
 */
export function assertDemoPositionMutationAllowed(action: string): void {
  assertCTraderLiveMutationsDisabled();
  if (!isCTraderDemoOrderSubmissionEnabled()) {
    throw new CTraderMutationDisabledError(action);
  }
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
