/**
 * V6 AutoTrade broker port — IG-capable abstraction.
 * Fake adapter used for all automated tests; real IG adapter never places LIVE
 * orders while LIVE_EXECUTION_FEATURE_FLAG is false.
 */

import type { BrokerEnvironment, StopProtectionMode } from "./types";

export interface IgAccount {
  accountId: string;
  accountName: string;
  currency: string;
  balance: number;
  available: number;
  marginUsed: number;
  environment: BrokerEnvironment;
}

export interface IgMarketDetails {
  epic: string;
  instrumentName: string;
  instrumentType: string | null;
  expiry: string | null;
  marketStatus: "OPEN" | "CLOSED" | "TRADEABLE" | "UNKNOWN";
  bid: number;
  offer: number;
  high: number | null;
  low: number | null;
  netChange: number | null;
  percentageChange: number | null;
  updateTime: string;
  minDealSize: number;
  dealSizeIncrement: number;
  valueOfOnePip: number;
  currencyCode: string;
  guaranteedStopAvailable: boolean;
  minNormalStopDistance: number | null;
  minGuaranteedStopDistance: number | null;
  marginRequirement: number | null;
  scalingFactor: number;
}

export interface IgOpenPosition {
  dealId: string;
  dealReference: string | null;
  epic: string;
  instrumentName: string;
  direction: "BUY" | "SELL";
  size: number;
  level: number;
  stopLevel: number | null;
  limitLevel: number | null;
  guaranteedStop: boolean;
  currency: string;
  createdDate: string;
  upl: number | null;
}

export interface IgOrderRequest {
  dealReference: string;
  epic: string;
  direction: "BUY" | "SELL";
  size: number;
  orderType: "MARKET";
  stopLevel: number;
  limitLevel: number;
  guaranteedStop: boolean;
  forceOpen: true;
  currencyCode: string;
}

export interface IgOrderResult {
  accepted: boolean;
  dealReference: string;
  dealId: string | null;
  status: "ACCEPTED" | "REJECTED" | "UNKNOWN";
  reason: string | null;
  rawRedacted: Record<string, unknown>;
}

export interface IgDealConfirmation {
  dealReference: string;
  dealId: string | null;
  status: "ACCEPTED" | "REJECTED" | "UNKNOWN";
  reason: string | null;
  level: number | null;
  size: number | null;
  stopLevel: number | null;
  limitLevel: number | null;
}

export interface AutoTradeBrokerAdapter {
  readonly name: string;
  readonly environment: BrokerEnvironment;

  /** Authenticate / refresh session. Never log secrets. */
  connect(credentialsRef: string): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  heartbeat(): Promise<string>;

  listAccounts(): Promise<IgAccount[]>;
  selectAccount(accountId: string): Promise<IgAccount>;
  /** Search IG for Spot Gold / XAUUSD candidates — never silently picks when multiple. */
  searchGoldMarkets(): Promise<import("./igDemoTypes").IgGoldMarketCandidate[]>;
  discoverSpotGold(): Promise<IgMarketDetails>;
  getMarket(epic: string): Promise<IgMarketDetails>;
  getOpenPositions(): Promise<IgOpenPosition[]>;
  /** Re-authenticate / refresh session tokens without logging secrets. */
  renewSession(): Promise<string>;

  placeMarketOrder(request: IgOrderRequest): Promise<IgOrderResult>;
  confirmDeal(dealReference: string): Promise<IgDealConfirmation>;
  closePosition(dealId: string): Promise<IgOrderResult>;
  amendStops(
    dealId: string,
    patch: { stopLevel?: number; limitLevel?: number }
  ): Promise<IgOrderResult>;

  supportsStopProtection(mode: StopProtectionMode): boolean;
}
