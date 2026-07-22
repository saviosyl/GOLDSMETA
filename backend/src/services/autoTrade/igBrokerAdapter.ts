/**
 * IG REST adapter scaffolding (DEMO + LIVE endpoints).
 *
 * - DEMO order submission is implemented against IG demo hosts when credentials
 *   are supplied via server secrets (never from the browser).
 * - LIVE order submission is hard-blocked while LIVE_EXECUTION_FEATURE_FLAG is false.
 * - Automated tests must use FakeIgBrokerAdapter — never this class with real secrets.
 */

import { logger } from "../logging/logger";
import { redactSecrets } from "./redactSecrets";
import type {
  AutoTradeBrokerAdapter,
  IgAccount,
  IgDealConfirmation,
  IgMarketDetails,
  IgOpenPosition,
  IgOrderRequest,
  IgOrderResult
} from "./brokerAdapter";
import {
  DEMO_ORDER_SUBMISSION_ENABLED,
  LIVE_EXECUTION_FEATURE_FLAG,
  type BrokerEnvironment,
  type StopProtectionMode
} from "./types";
import type { IgGoldMarketCandidate } from "./igDemoTypes";
import { rankGoldCandidates } from "./goldMarketRanking";

const IG_DEMO_BASE = "https://demo-api.ig.com/gateway/deal";
const IG_LIVE_BASE = "https://api.ig.com/gateway/deal";

export interface IgCredentialBundle {
  apiKey: string;
  username: string;
  password: string;
  accountId?: string;
}

export interface IgBrokerAdapterOptions {
  environment: BrokerEnvironment;
  /** Injected fetch for tests; never used with real LIVE orders in this release. */
  fetchImpl?: typeof fetch;
  /**
   * When true, network calls are disabled and methods throw unless overridden.
   * Default true for safety in this development release unless credentials are loaded.
   */
  dryRun?: boolean;
}

type SessionTokens = {
  cst: string;
  securityToken: string;
  currentAccountId: string | null;
};

/**
 * Resolve IG credentials from Firebase / process server secrets only.
 * Never accepts browser-supplied secrets.
 */
export function loadIgCredentialsFromServerEnv(
  environment: BrokerEnvironment
): IgCredentialBundle | null {
  const prefix = environment === "LIVE" ? "IG_LIVE" : "IG_DEMO";
  const apiKey = process.env[`${prefix}_API_KEY`];
  const username = process.env[`${prefix}_USERNAME`];
  const password = process.env[`${prefix}_PASSWORD`];
  if (!apiKey || !username || !password) {
    return null;
  }
  return {
    apiKey,
    username,
    password,
    accountId: process.env[`${prefix}_ACCOUNT_ID`]
  };
}

/** Pinned account id may be present even when FakeIg is used in tests. */
export function loadPinnedAccountIdFromServerEnv(
  environment: BrokerEnvironment
): string | null {
  const prefix = environment === "LIVE" ? "IG_LIVE" : "IG_DEMO";
  const id = (process.env[`${prefix}_ACCOUNT_ID`] ?? "").trim();
  return id || null;
}

export class IgBrokerAdapter implements AutoTradeBrokerAdapter {
  readonly name = "ig";
  readonly environment: BrokerEnvironment;
  private connected = false;
  private session: SessionTokens | null = null;
  private credentials: IgCredentialBundle | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly dryRun: boolean;
  private lastHeartbeatAt: string | null = null;

  constructor(opts: IgBrokerAdapterOptions) {
    this.environment = opts.environment;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.dryRun = opts.dryRun ?? true;
  }

  private baseUrl(): string {
    // DEMO can never switch to the Live host — environment is fixed at construction.
    if (this.environment === "DEMO") {
      return IG_DEMO_BASE;
    }
    return IG_LIVE_BASE;
  }

  /** Active session account id from login / last switch (no network). */
  getSessionAccountId(): string | null {
    return this.session?.currentAccountId ?? null;
  }

  async connect(credentialsRef: string): Promise<void> {
    // credentialsRef is a server vault key name, never a password.
    const loaded = loadIgCredentialsFromServerEnv(this.environment);
    if (!loaded) {
      logger.warn("IG credentials not configured on server", {
        environment: this.environment,
        credentialsRef
      });
      throw new Error("IG_CREDENTIALS_NOT_CONFIGURED");
    }
    this.credentials = loaded;

    if (this.dryRun) {
      // Scaffolding mode: mark connected without network for local/preview wiring.
      this.session = {
        cst: "[REDACTED]",
        securityToken: "[REDACTED]",
        currentAccountId: loaded.accountId ?? null
      };
      this.connected = true;
      this.lastHeartbeatAt = new Date().toISOString();
      return;
    }

    const res = await this.fetchImpl(`${this.baseUrl()}/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        Accept: "application/json; charset=UTF-8",
        "X-IG-API-KEY": loaded.apiKey,
        Version: "2"
      },
      body: JSON.stringify({
        identifier: loaded.username,
        password: loaded.password
      })
    });

    if (!res.ok) {
      logger.error("IG session failed", { status: res.status, environment: this.environment });
      throw new Error("IG_SESSION_FAILED");
    }

    const cst = res.headers.get("CST");
    const securityToken = res.headers.get("X-SECURITY-TOKEN");
    if (!cst || !securityToken) {
      throw new Error("IG_SESSION_TOKENS_MISSING");
    }
    const body = (await res.json()) as { currentAccountId?: string };
    this.session = {
      cst,
      securityToken,
      currentAccountId: body.currentAccountId ?? loaded.accountId ?? null
    };
    this.connected = true;
    this.lastHeartbeatAt = new Date().toISOString();
    logger.info("IG session established", {
      environment: this.environment,
      accountIdMasked: this.session.currentAccountId
        ? `****${this.session.currentAccountId.slice(-4)}`
        : null
    });
  }

  async disconnect(): Promise<void> {
    if (this.connected && this.session && this.credentials && !this.dryRun) {
      try {
        await this.igJson("/session", "DELETE", "1");
      } catch {
        // Best-effort logout — never log tokens
      }
    }
    this.connected = false;
    this.session = null;
    this.credentials = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async heartbeat(): Promise<string> {
    this.requireConnected();
    if (!this.dryRun) {
      try {
        await this.igJson("/session", "GET", "1");
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/IG_HTTP_401|IG_HTTP_403/.test(message)) {
          throw new Error("IG_SESSION_EXPIRED");
        }
        throw error;
      }
    }
    this.lastHeartbeatAt = new Date().toISOString();
    return this.lastHeartbeatAt;
  }

  async renewSession(): Promise<string> {
    this.requireConnected();
    if (this.dryRun) {
      this.lastHeartbeatAt = new Date().toISOString();
      return this.lastHeartbeatAt;
    }
    const creds = this.credentials;
    if (!creds) throw new Error("NOT_CONNECTED");
    // Clear tokens then re-login (read-only session refresh)
    this.session = null;
    this.connected = false;
    await this.connect("server:demo-renew");
    return this.lastHeartbeatAt ?? new Date().toISOString();
  }

  async listAccounts(): Promise<IgAccount[]> {
    this.requireConnected();
    if (this.dryRun) {
      return [
        {
          accountId: this.session?.currentAccountId ?? "UNCONFIGURED",
          accountName: `${this.environment} account (scaffold)`,
          currency: "EUR",
          balance: 0,
          available: 0,
          marginUsed: 0,
          environment: this.environment
        }
      ];
    }
    const data = await this.igJson<{ accounts: Array<Record<string, unknown>> }>(
      "/accounts",
      "GET",
      "1"
    );
    return (data.accounts ?? []).map((a) => ({
      accountId: String(a.accountId ?? ""),
      accountName: String(a.accountName ?? ""),
      currency: String(a.currency ?? "EUR"),
      balance: Number((a.balance as { balance?: number })?.balance ?? 0),
      available: Number((a.balance as { available?: number })?.available ?? 0),
      marginUsed: Number((a.balance as { deposit?: number })?.deposit ?? 0),
      environment: this.environment
    }));
  }

  async selectAccount(accountId: string): Promise<IgAccount> {
    this.requireConnected();
    const alreadyActive = this.session?.currentAccountId === accountId;
    if (!this.dryRun && !alreadyActive) {
      // Switch only when the requested account is not already active.
      await this.igJson("/session", "PUT", "1", { accountId });
      if (this.session) this.session.currentAccountId = accountId;
    } else if (this.session) {
      this.session.currentAccountId = accountId;
    }
    const accounts = await this.listAccounts();
    const found = accounts.find((a) => a.accountId === accountId);
    if (!found) throw new Error("ACCOUNT_NOT_FOUND");
    return found;
  }

  async searchGoldMarkets(): Promise<IgGoldMarketCandidate[]> {
    this.requireConnected();
    if (this.dryRun) {
      return rankGoldCandidates([
        {
          epic: "CS.D.USCGC.TODAY.IP",
          instrumentName: "Spot Gold",
          instrumentType: "CURRENCIES",
          expiry: "-",
          marketStatus: "TRADEABLE",
          currencyCode: "EUR",
          bid: 0,
          offer: 0
        }
      ]);
    }
    const data = await this.igJson<{ markets?: Array<Record<string, unknown>> }>(
      `/markets?searchTerm=${encodeURIComponent("Spot Gold")}`,
      "GET",
      "1"
    );
    let markets = data.markets ?? [];
    if (markets.length === 0) {
      const alt = await this.igJson<{ markets?: Array<Record<string, unknown>> }>(
        `/markets?searchTerm=${encodeURIComponent("XAUUSD")}`,
        "GET",
        "1"
      );
      markets = alt.markets ?? [];
    }
    return rankGoldCandidates(
      markets.map((m) => ({
        epic: String(m.epic ?? ""),
        instrumentName: String(m.instrumentName ?? m.instrumentName ?? m.epic ?? ""),
        instrumentType: m.instrumentType != null ? String(m.instrumentType) : null,
        expiry: m.expiry != null ? String(m.expiry) : null,
        marketStatus: m.marketStatus != null ? String(m.marketStatus) : null,
        currencyCode: null,
        bid: m.bid != null ? Number(m.bid) : null,
        offer: m.offer != null ? Number(m.offer) : null
      }))
    );
  }

  async discoverSpotGold(): Promise<IgMarketDetails> {
    const candidates = await this.searchGoldMarkets();
    const primary = candidates.filter((c) => c.proposedPrimary);
    if (candidates.length === 0) {
      throw new Error("GOLD_MARKET_NOT_FOUND");
    }
    if (candidates.length > 1 && primary.length !== 1) {
      throw Object.assign(new Error("MULTIPLE_GOLD_CANDIDATES"), { candidates });
    }
    const epic = (primary[0] ?? candidates[0])!.epic;
    return this.getMarket(epic);
  }

  async getMarket(epic: string): Promise<IgMarketDetails> {
    this.requireConnected();
    if (this.dryRun) {
      return {
        epic,
        instrumentName: "Spot Gold",
        instrumentType: "CURRENCIES",
        expiry: "-",
        marketStatus: "UNKNOWN",
        bid: 0,
        offer: 0,
        high: null,
        low: null,
        netChange: null,
        percentageChange: null,
        updateTime: new Date().toISOString(),
        minDealSize: 0.1,
        dealSizeIncrement: 0.1,
        valueOfOnePip: 1,
        currencyCode: "EUR",
        guaranteedStopAvailable: true,
        minNormalStopDistance: null,
        minGuaranteedStopDistance: null,
        marginRequirement: null,
        scalingFactor: 1
      };
    }
    const data = await this.igJson<Record<string, unknown>>(
      `/markets/${encodeURIComponent(epic)}`,
      "GET",
      "3"
    );
    const snapshot = (data.snapshot ?? {}) as Record<string, unknown>;
    const dealing = (data.dealingRules ?? {}) as Record<string, unknown>;
    const instrument = (data.instrument ?? {}) as Record<string, unknown>;
    const minDeal = Number((dealing.minDealSize as { value?: number })?.value ?? 0.1);
    const increment = Number(
      (dealing.dealSizeIncrement as { value?: number })?.value ??
        (dealing.minDealSize as { value?: number })?.value ??
        0.1
    );
    const minStop = (dealing.minNormalStopOrLimitDistance as { value?: number })?.value;
    const minGStop = (dealing.minControlledRiskStopDistance as { value?: number })?.value;
    const margin =
      (instrument.marginDepositBands as Array<{ margin?: number }> | undefined)?.[0]?.margin ??
      null;
    return {
      epic,
      instrumentName: String(instrument.name ?? "Spot Gold"),
      instrumentType: instrument.type != null ? String(instrument.type) : null,
      expiry: instrument.expiry != null ? String(instrument.expiry) : null,
      marketStatus: mapMarketStatus(String(snapshot.marketStatus ?? "UNKNOWN")),
      bid: Number(snapshot.bid ?? 0),
      offer: Number(snapshot.offer ?? 0),
      high: snapshot.high != null ? Number(snapshot.high) : null,
      low: snapshot.low != null ? Number(snapshot.low) : null,
      netChange: snapshot.netChange != null ? Number(snapshot.netChange) : null,
      percentageChange:
        snapshot.percentageChange != null ? Number(snapshot.percentageChange) : null,
      updateTime: String(snapshot.updateTime ?? new Date().toISOString()),
      minDealSize: minDeal,
      dealSizeIncrement: increment,
      valueOfOnePip: Number(instrument.valueOfOnePip ?? 1),
      currencyCode: String(
        (Array.isArray(instrument.currencies) &&
          instrument.currencies[0] &&
          typeof instrument.currencies[0] === "object" &&
          (instrument.currencies[0] as { code?: string }).code) ||
          "EUR"
      ),
      guaranteedStopAvailable: Boolean(instrument.guaranteedStopsAllowed ?? false),
      minNormalStopDistance: minStop != null ? Number(minStop) : null,
      minGuaranteedStopDistance: minGStop != null ? Number(minGStop) : null,
      marginRequirement: margin != null ? Number(margin) : null,
      scalingFactor: Number(instrument.scalingFactor ?? 1)
    };
  }

  async getOpenPositions(): Promise<IgOpenPosition[]> {
    this.requireConnected();
    if (this.dryRun) return [];
    const data = await this.igJson<{ positions: Array<Record<string, unknown>> }>(
      "/positions",
      "GET",
      "2"
    );
    return (data.positions ?? []).map((row) => {
      const position = (row.position ?? row) as Record<string, unknown>;
      const market = (row.market ?? {}) as Record<string, unknown>;
      return {
        dealId: String(position.dealId ?? ""),
        dealReference: position.dealReference ? String(position.dealReference) : null,
        epic: String(market.epic ?? position.epic ?? ""),
        instrumentName: String(market.instrumentName ?? "Spot Gold"),
        direction: String(position.direction) === "SELL" ? "SELL" : "BUY",
        size: Number(position.size ?? 0),
        level: Number(position.level ?? 0),
        stopLevel: position.stopLevel != null ? Number(position.stopLevel) : null,
        limitLevel: position.limitLevel != null ? Number(position.limitLevel) : null,
        guaranteedStop: Boolean(position.controlledRisk ?? position.guaranteedStop),
        currency: String(position.currency ?? "EUR"),
        createdDate: String(position.createdDate ?? new Date().toISOString()),
        upl: position.upl != null ? Number(position.upl) : null
      };
    });
  }

  async placeMarketOrder(request: IgOrderRequest): Promise<IgOrderResult> {
    this.requireConnected();
    this.assertDealingAllowed();
    this.assertLiveExecutionAllowed();

    if (this.dryRun) {
      return {
        accepted: false,
        dealReference: request.dealReference,
        dealId: null,
        status: "REJECTED",
        reason: "IG adapter is in dry-run scaffolding mode; no order sent.",
        rawRedacted: { dryRun: true }
      };
    }

    const payload = {
      epic: request.epic,
      expiry: "-",
      direction: request.direction,
      size: request.size,
      orderType: "MARKET",
      timeInForce: "FILL_OR_KILL",
      level: null,
      guaranteedStop: request.guaranteedStop,
      stopLevel: request.stopLevel,
      stopDistance: null,
      trailingStop: false,
      limitLevel: request.limitLevel,
      limitDistance: null,
      quoteId: null,
      currencyCode: request.currencyCode,
      forceOpen: true,
      dealReference: request.dealReference
    };

    try {
      const data = await this.igJson<{ dealReference?: string }>(
        "/positions/otc",
        "POST",
        "2",
        payload
      );
      const dealReference = String(data.dealReference ?? request.dealReference);
      return {
        accepted: true,
        dealReference,
        dealId: null,
        status: "ACCEPTED",
        reason: null,
        rawRedacted: redactSecrets({ dealReference, status: "SUBMITTED" })
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "IG_ORDER_FAILED";
      if (message === "IG_HTTP_TIMEOUT") {
        return {
          accepted: false,
          dealReference: request.dealReference,
          dealId: null,
          status: "UNKNOWN",
          reason: "HTTP timeout after submit — reconciliation required; do not retry blindly.",
          rawRedacted: { status: "UNKNOWN" }
        };
      }
      return {
        accepted: false,
        dealReference: request.dealReference,
        dealId: null,
        status: "REJECTED",
        reason: message,
        rawRedacted: redactSecrets({ status: "REJECTED", reason: message })
      };
    }
  }

  async confirmDeal(dealReference: string): Promise<IgDealConfirmation> {
    this.requireConnected();
    if (this.dryRun) {
      return {
        dealReference,
        dealId: null,
        status: "UNKNOWN",
        reason: "dry-run",
        level: null,
        size: null,
        stopLevel: null,
        limitLevel: null
      };
    }
    const data = await this.igJson<Record<string, unknown>>(
      `/confirms/${encodeURIComponent(dealReference)}`,
      "GET",
      "1"
    );
    const dealStatus = String(data.dealStatus ?? "UNKNOWN").toUpperCase();
    const status =
      dealStatus === "ACCEPTED" || dealStatus === "REJECTED" ? dealStatus : "UNKNOWN";
    return {
      dealReference,
      dealId: data.dealId != null ? String(data.dealId) : null,
      status,
      reason: data.reason != null ? String(data.reason) : null,
      level: data.level != null ? Number(data.level) : null,
      size: data.size != null ? Number(data.size) : null,
      stopLevel: data.stopLevel != null ? Number(data.stopLevel) : null,
      limitLevel: data.limitLevel != null ? Number(data.limitLevel) : null
    };
  }

  async closePosition(dealId: string): Promise<IgOrderResult> {
    this.requireConnected();
    this.assertDealingAllowed();
    this.assertLiveExecutionAllowed();
    if (this.dryRun) {
      return {
        accepted: false,
        dealReference: dealId,
        dealId,
        status: "REJECTED",
        reason: "dry-run",
        rawRedacted: { dryRun: true }
      };
    }
    const data = await this.igJson<{ dealReference?: string }>(
      `/positions/otc/${encodeURIComponent(dealId)}`,
      "DELETE",
      "1",
      { orderType: "MARKET" }
    );
    return {
      accepted: true,
      dealReference: String(data.dealReference ?? dealId),
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
    this.assertDealingAllowed();
    this.assertLiveExecutionAllowed();
    if (this.dryRun) {
      return {
        accepted: false,
        dealReference: dealId,
        dealId,
        status: "REJECTED",
        reason: "dry-run",
        rawRedacted: { dryRun: true }
      };
    }
    await this.igJson(`/positions/otc/${encodeURIComponent(dealId)}`, "PUT", "2", patch);
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
    // Guaranteed stops assumed available until market rules say otherwise
    return true;
  }

  private assertDealingAllowed(): void {
    if (!DEMO_ORDER_SUBMISSION_ENABLED) {
      throw new Error("DEMO_ORDER_SUBMISSION_DISABLED");
    }
  }

  private assertLiveExecutionAllowed(): void {
    if (this.environment === "LIVE" && !LIVE_EXECUTION_FEATURE_FLAG) {
      throw new Error("LIVE_EXECUTION_FEATURE_DISABLED");
    }
  }

  private requireConnected(): void {
    if (!this.connected || !this.session) throw new Error("NOT_CONNECTED");
  }

  private async igJson<T>(
    path: string,
    method: string,
    version: string,
    body?: unknown
  ): Promise<T> {
    if (!this.credentials || !this.session) throw new Error("NOT_CONNECTED");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await this.fetchImpl(`${this.baseUrl()}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          Accept: "application/json; charset=UTF-8",
          "X-IG-API-KEY": this.credentials.apiKey,
          CST: this.session.cst,
          "X-SECURITY-TOKEN": this.session.securityToken,
          Version: version
        },
        body: body != null ? JSON.stringify(body) : undefined
      });
      if (!res.ok) {
        const text = await res.text();
        logger.warn("IG HTTP error", {
          status: res.status,
          path,
          body: redactSecrets({ text: text.slice(0, 200) })
        });
        throw new Error(`IG_HTTP_${res.status}`);
      }
      if (res.status === 204) return {} as T;
      return (await res.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("IG_HTTP_TIMEOUT");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function mapMarketStatus(status: string): IgMarketDetails["marketStatus"] {
  const s = status.toUpperCase();
  if (s === "OPEN" || s === "TRADEABLE") return s as "OPEN" | "TRADEABLE";
  if (s === "CLOSED") return "CLOSED";
  return "UNKNOWN";
}

/** Exported for architecture docs / tests — LIVE host isolation. */
export const IG_ENDPOINTS = {
  DEMO: IG_DEMO_BASE,
  LIVE: IG_LIVE_BASE
} as const;
