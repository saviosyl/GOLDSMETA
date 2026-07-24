/**
 * Clearly labelled demonstration fixtures — NOT live broker data.
 * TEST FIXTURE — NOT LIVE BROKER DATA
 */

import type { BrokerAccount, BrokerQuote, BrokerSymbol, BrokerPosition } from "../domain";
import { hashAccountKey, maskAccountId } from "./tokenCrypto";

export const FIXTURE_BANNER =
  "DEMONSTRATION DATA — NO BROKER CONNECTION — NO ORDER PLACED";

export const TEST_FIXTURE_LABEL = "TEST FIXTURE — NOT LIVE BROKER DATA";

export function fixtureDemoAccount(): BrokerAccount {
  const id = "DEMO-FIXTURE-1001";
  return {
    brokerId: "pepperstone_ctrader",
    environment: "DEMO",
    accountIdMasked: maskAccountId(id),
    accountKeyHash: hashAccountKey(id),
    currency: "EUR",
    balance: 10000,
    equity: 10000,
    freeMargin: 9500,
    usedMargin: 500,
    leverage: 100,
    accountType: "HEDGED_CFD_DEMO",
    positionMode: "HEDGED",
    brokerName: "Pepperstone",
    brokerNameSource: "USER_CONFIRMED",
    isDemo: true
  };
}

export function fixtureXauUsdSymbol(): BrokerSymbol {
  return {
    brokerId: "pepperstone_ctrader",
    environment: "DEMO",
    symbolId: "FIX-XAUUSD-1",
    symbolName: "XAUUSD",
    displayName: "XAUUSD",
    baseAsset: "XAU",
    quoteAsset: "USD",
    digits: 2,
    pipPosition: 1,
    tickSize: 0.01,
    minVolume: 0.01,
    volumeStep: 0.01,
    maxVolume: 50,
    lotSize: 100,
    commissionType: "USD_PER_MILLION",
    commissionAmount: 35,
    minCommission: null,
    swapLong: -2.5,
    swapShort: 0.8,
    minStopDistance: 0.3,
    guaranteedStopAvailable: false,
    tradingScheduleId: "FIX-SCHED-1",
    metadataComplete: true,
    missingFields: []
  };
}

export function fixtureQuote(marketStatus: "OPEN" | "CLOSED" = "OPEN"): BrokerQuote {
  return {
    symbolId: "FIX-XAUUSD-1",
    symbolName: "XAUUSD",
    bid: 2350.12,
    ask: 2350.42,
    spread: 0.3,
    timestamp: new Date().toISOString(),
    marketStatus,
    stale: false,
    source: "FIXTURE"
  };
}

export function fixtureLongPosition(): BrokerPosition {
  return {
    positionId: "FIX-POS-1",
    symbolId: "FIX-XAUUSD-1",
    symbolName: "XAUUSD",
    direction: "LONG",
    volume: 0.02,
    entryPrice: 2348.5,
    stopLoss: 2340,
    takeProfit: 2365,
    unrealisedPnl: 32.4,
    openedAt: new Date(Date.now() - 3600_000).toISOString()
  };
}
