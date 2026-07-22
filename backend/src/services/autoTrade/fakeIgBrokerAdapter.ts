/**
 * Deterministic fake IG adapter for automated tests.
 * Never contacts IG. Never places real orders.
 */

import { nowIso } from "../../utils/time";
import type {
  AutoTradeBrokerAdapter,
  IgAccount,
  IgDealConfirmation,
  IgMarketDetails,
  IgOpenPosition,
  IgOrderRequest,
  IgOrderResult
} from "./brokerAdapter";
import type { IgGoldMarketCandidate } from "./igDemoTypes";
import type { BrokerEnvironment, StopProtectionMode } from "./types";

export type FakeIgScenario =
  | "happy"
  | "reject_order"
  | "reject_stop"
  | "timeout_after_accept"
  | "stale_quote"
  | "closed_market"
  | "wide_spread"
  | "min_size_large"
  | "no_guaranteed_stop"
  | "session_fail"
  | "multi_gold"
  | "auth_fail"
  | "expired_session";

export interface FakeIgOptions {
  environment?: BrokerEnvironment;
  scenario?: FakeIgScenario;
  minDealSize?: number;
  dealSizeIncrement?: number;
  valueOfOnePip?: number;
  bid?: number;
  offer?: number;
  currency?: string;
}

export class FakeIgBrokerAdapter implements AutoTradeBrokerAdapter {
  readonly name = "fake-ig";
  readonly environment: BrokerEnvironment;
  private connected = false;
  private scenario: FakeIgScenario;
  private account: IgAccount;
  private positions: IgOpenPosition[] = [];
  private confirmations = new Map<string, IgDealConfirmation>();
  private acceptedButUnconfirmed = new Set<string>();
  private minDealSize: number;
  private dealSizeIncrement: number;
  private valueOfOnePip: number;
  private bid: number;
  private offer: number;
  private guaranteedStopAvailable = true;

  constructor(opts: FakeIgOptions = {}) {
    this.environment = opts.environment ?? "DEMO";
    this.scenario = opts.scenario ?? "happy";
    this.minDealSize = opts.minDealSize ?? 0.1;
    this.dealSizeIncrement = opts.dealSizeIncrement ?? 0.1;
    this.valueOfOnePip = opts.valueOfOnePip ?? 1;
    this.bid = opts.bid ?? 2385.2;
    this.offer = opts.offer ?? 2385.5;
    this.account = {
      accountId: this.environment === "LIVE" ? "LIVE-ACC-9988" : "DEMO-ACC-1234",
      accountName: this.environment === "LIVE" ? "Live CFD" : "Demo CFD",
      currency: opts.currency ?? "EUR",
      balance: 10000,
      available: 9500,
      marginUsed: 120,
      environment: this.environment
    };
    if (opts.scenario === "no_guaranteed_stop") this.guaranteedStopAvailable = false;
    if (opts.scenario === "min_size_large") this.minDealSize = 5;
    if (opts.scenario === "wide_spread") {
      this.bid = 2385.0;
      this.offer = 2387.5;
    }
  }

  setScenario(scenario: FakeIgScenario): void {
    this.scenario = scenario;
    if (scenario === "no_guaranteed_stop") this.guaranteedStopAvailable = false;
    if (scenario === "min_size_large") this.minDealSize = 5;
  }

  setAccountId(accountId: string): void {
    this.account = { ...this.account, accountId };
  }

  async connect(_credentialsRef: string): Promise<void> {
    if (this.scenario === "session_fail" || this.scenario === "auth_fail") {
      throw new Error(this.scenario === "auth_fail" ? "IG_AUTH_FAILED" : "IG_SESSION_FAILED");
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async heartbeat(): Promise<string> {
    if (!this.connected) throw new Error("NOT_CONNECTED");
    if (this.scenario === "session_fail") throw new Error("IG_SESSION_FAILED");
    if (this.scenario === "expired_session") throw new Error("IG_SESSION_EXPIRED");
    return nowIso();
  }

  async listAccounts(): Promise<IgAccount[]> {
    this.requireConnected();
    return [{ ...this.account }];
  }

  async selectAccount(accountId: string): Promise<IgAccount> {
    this.requireConnected();
    if (accountId !== this.account.accountId) {
      throw new Error("ACCOUNT_NOT_FOUND");
    }
    return { ...this.account };
  }


  async searchGoldMarkets(): Promise<IgGoldMarketCandidate[]> {
    this.requireConnected();
    if (this.scenario === "multi_gold") {
      return [
        {
          epic: "CS.D.USCGC.TODAY.IP",
          instrumentName: "Spot Gold",
          instrumentType: "CURRENCIES",
          expiry: "-",
          marketStatus: "TRADEABLE",
          currencyCode: this.account.currency,
          bid: this.bid,
          offer: this.offer,
          proposedPrimary: true,
          reason: "Matches Spot Gold / continuous CFD naming"
        },
        {
          epic: "CS.D.CFEGOLD.CFD.IP",
          instrumentName: "Gold Cash CFD",
          instrumentType: "CURRENCIES",
          expiry: "-",
          marketStatus: "TRADEABLE",
          currencyCode: this.account.currency,
          bid: this.bid - 0.1,
          offer: this.offer + 0.1,
          proposedPrimary: false,
          reason: "Alternate Gold CFD — requires explicit selection"
        }
      ];
    }
    return [
      {
        epic: "CS.D.USCGC.TODAY.IP",
        instrumentName: "Spot Gold",
        instrumentType: "CURRENCIES",
        expiry: "-",
        marketStatus: this.scenario === "closed_market" ? "CLOSED" : "TRADEABLE",
        currencyCode: this.account.currency,
        bid: this.bid,
        offer: this.offer,
        proposedPrimary: true,
        reason: "Single Spot Gold candidate"
      }
    ];
  }

  async renewSession(): Promise<string> {
    this.requireConnected();
    if (this.scenario === "expired_session" || this.scenario === "auth_fail") {
      this.connected = false;
      throw new Error(this.scenario === "auth_fail" ? "IG_AUTH_FAILED" : "IG_SESSION_EXPIRED");
    }
    return this.heartbeat();
  }

  async discoverSpotGold(): Promise<IgMarketDetails> {
    const candidates = await this.searchGoldMarkets();
    if (candidates.length !== 1) {
      throw new Error("MULTIPLE_GOLD_CANDIDATES");
    }
    return this.getMarket(candidates[0]!.epic);
  }

  async getMarket(epic: string): Promise<IgMarketDetails> {
    this.requireConnected();
    let status: IgMarketDetails["marketStatus"] = "TRADEABLE";
    let bid = this.bid;
    let offer = this.offer;
    const updateTime = nowIso();
    if (this.scenario === "closed_market") status = "CLOSED";
    if (this.scenario === "stale_quote") {
      return {
        epic,
        instrumentName: "Spot Gold",
        marketStatus: status,
        bid,
        offer,
        high: null,
        low: null,
        netChange: null,
        percentageChange: null,
        updateTime: new Date(Date.now() - 15 * 60_000).toISOString(),
        minDealSize: this.minDealSize,
        dealSizeIncrement: this.dealSizeIncrement,
        valueOfOnePip: this.valueOfOnePip,
        currencyCode: this.account.currency,
        guaranteedStopAvailable: this.guaranteedStopAvailable,
        minNormalStopDistance: 0.3,
        minGuaranteedStopDistance: 0.5,
        marginRequirement: 5,
        instrumentType: "CURRENCIES",
        expiry: "-",
        scalingFactor: 1
      };
    }
    return {
      epic,
      instrumentName: "Spot Gold",
      instrumentType: "CURRENCIES",
      expiry: "-",
      marketStatus: status,
      bid,
      offer,
      high: bid + 5,
      low: bid - 5,
      netChange: 1.2,
      percentageChange: 0.05,
      updateTime,
      minDealSize: this.minDealSize,
      dealSizeIncrement: this.dealSizeIncrement,
      valueOfOnePip: this.valueOfOnePip,
      currencyCode: this.account.currency,
      guaranteedStopAvailable: this.guaranteedStopAvailable,
      minNormalStopDistance: 0.3,
      minGuaranteedStopDistance: 0.5,
      marginRequirement: 5,
      scalingFactor: 1
    };
  }

  async getOpenPositions(): Promise<IgOpenPosition[]> {
    this.requireConnected();
    return this.positions.map((p) => ({ ...p }));
  }

  async placeMarketOrder(request: IgOrderRequest): Promise<IgOrderResult> {
    this.requireConnected();
    if (this.scenario === "reject_order") {
      return {
        accepted: false,
        dealReference: request.dealReference,
        dealId: null,
        status: "REJECTED",
        reason: "IG rejected order (fake scenario)",
        rawRedacted: { status: "REJECTED" }
      };
    }
    if (this.scenario === "reject_stop" || (request.guaranteedStop && !this.guaranteedStopAvailable)) {
      return {
        accepted: false,
        dealReference: request.dealReference,
        dealId: null,
        status: "REJECTED",
        reason: "Guaranteed stop unavailable or rejected",
        rawRedacted: { status: "REJECTED", reason: "ATTACH_ERROR" }
      };
    }
    if (this.scenario === "timeout_after_accept") {
      const dealId = `DEAL-${request.dealReference.slice(-8)}`;
      this.acceptedButUnconfirmed.add(request.dealReference);
      this.confirmations.set(request.dealReference, {
        dealReference: request.dealReference,
        dealId,
        status: "ACCEPTED",
        reason: null,
        level: request.direction === "BUY" ? this.offer : this.bid,
        size: request.size,
        stopLevel: request.stopLevel,
        limitLevel: request.limitLevel
      });
      this.positions.push({
        dealId,
        dealReference: request.dealReference,
        epic: request.epic,
        instrumentName: "Spot Gold",
        direction: request.direction,
        size: request.size,
        level: request.direction === "BUY" ? this.offer : this.bid,
        stopLevel: request.stopLevel,
        limitLevel: request.limitLevel,
        guaranteedStop: request.guaranteedStop,
        currency: request.currencyCode,
        createdDate: nowIso(),
        upl: 0
      });
      throw new Error("IG_HTTP_TIMEOUT");
    }

    const dealId = `DEAL-${request.dealReference.slice(-8)}`;
    const level = request.direction === "BUY" ? this.offer : this.bid;
    this.confirmations.set(request.dealReference, {
      dealReference: request.dealReference,
      dealId,
      status: "ACCEPTED",
      reason: null,
      level,
      size: request.size,
      stopLevel: request.stopLevel,
      limitLevel: request.limitLevel
    });
    this.positions.push({
      dealId,
      dealReference: request.dealReference,
      epic: request.epic,
      instrumentName: "Spot Gold",
      direction: request.direction,
      size: request.size,
      level,
      stopLevel: request.stopLevel,
      limitLevel: request.limitLevel,
      guaranteedStop: request.guaranteedStop,
      currency: request.currencyCode,
      createdDate: nowIso(),
      upl: 0
    });
    return {
      accepted: true,
      dealReference: request.dealReference,
      dealId,
      status: "ACCEPTED",
      reason: null,
      rawRedacted: { status: "ACCEPTED", dealId }
    };
  }

  async confirmDeal(dealReference: string): Promise<IgDealConfirmation> {
    this.requireConnected();
    const conf = this.confirmations.get(dealReference);
    if (!conf) {
      return {
        dealReference,
        dealId: null,
        status: "UNKNOWN",
        reason: "No confirmation found",
        level: null,
        size: null,
        stopLevel: null,
        limitLevel: null
      };
    }
    this.acceptedButUnconfirmed.delete(dealReference);
    return { ...conf };
  }

  async closePosition(dealId: string): Promise<IgOrderResult> {
    this.requireConnected();
    const idx = this.positions.findIndex((p) => p.dealId === dealId);
    if (idx < 0) {
      return {
        accepted: false,
        dealReference: dealId,
        dealId,
        status: "REJECTED",
        reason: "Position not found",
        rawRedacted: {}
      };
    }
    this.positions.splice(idx, 1);
    return {
      accepted: true,
      dealReference: dealId,
      dealId,
      status: "ACCEPTED",
      reason: null,
      rawRedacted: { closed: true }
    };
  }

  async amendStops(
    dealId: string,
    patch: { stopLevel?: number; limitLevel?: number }
  ): Promise<IgOrderResult> {
    this.requireConnected();
    const pos = this.positions.find((p) => p.dealId === dealId);
    if (!pos) {
      return {
        accepted: false,
        dealReference: dealId,
        dealId,
        status: "REJECTED",
        reason: "Position not found",
        rawRedacted: {}
      };
    }
    if (patch.stopLevel != null) pos.stopLevel = patch.stopLevel;
    if (patch.limitLevel != null) pos.limitLevel = patch.limitLevel;
    return {
      accepted: true,
      dealReference: dealId,
      dealId,
      status: "ACCEPTED",
      reason: null,
      rawRedacted: { amended: true }
    };
  }

  supportsStopProtection(mode: StopProtectionMode): boolean {
    if (mode === "NORMAL_ALLOWED") return true;
    return this.guaranteedStopAvailable;
  }

  private requireConnected(): void {
    if (!this.connected) throw new Error("NOT_CONNECTED");
  }
}
