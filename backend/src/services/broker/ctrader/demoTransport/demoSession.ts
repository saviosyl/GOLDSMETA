/**
 * Demo-only Open API session for FAST qualification / execution.
 *
 * One authenticated Demo connection is reused for expected margin,
 * authoritative snapshot, NewOrder, and immediate reconcile.
 * Live transport is never created.
 */

import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { withBoundedOp } from "./boundedOp";
import type { OrderTransportPort } from "./orderTransport";
import {
  parseReconcileSnapshot,
  type ReconcileSnapshot
} from "./orderReconcile";
import {
  computeAuthoritativeMarginSnapshot,
  parseExpectedMarginEntries,
  selectSideExpectedMargin
} from "../authoritativeMargin";
import {
  moneyFromDigitsSafe,
  safeInteger,
  safeWireAccountId
} from "../openApiNumeric";
import type {
  AuthoritativeMarginSnapshotResult,
  ExpectedMarginResult
} from "../openApiClient";

const DEMO_HOST = "demo.ctraderapi.com";
const DEMO_PORT = 5035;
const HEARTBEAT_MS = 10_000;
const COMMAND_TIMEOUT_MS = 12_000;
const AUTH_TIMEOUT_MS = 12_000;

export type FastDemoSessionCreds = {
  accessToken: string;
  clientId: string;
  clientSecret: string;
  ctidTraderAccountId: string;
};

export type FastDemoSessionStats = {
  connectionsCreated: number;
  commandsSent: number;
  reconnects: number;
  lastHeartbeatAt: number | null;
  authenticated: boolean;
};

type Queued<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

export class FastDemoSession implements OrderTransportPort {
  private connection: InstanceType<typeof CTraderConnection> | null = null;
  private authenticated = false;
  private dead = false;
  private opening: Promise<void> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly queue: Queued<unknown>[] = [];
  private draining = false;
  private readonly listeners = new Set<
    (event: { name: string; payload: Record<string, unknown> }) => void
  >();
  private eventHooks: string[] = [];
  readonly stats: FastDemoSessionStats = {
    connectionsCreated: 0,
    commandsSent: 0,
    reconnects: 0,
    lastHeartbeatAt: null,
    authenticated: false
  };

  constructor(private readonly creds: FastDemoSessionCreds) {}

  onEvent(
    listener: (event: { name: string; payload: Record<string, unknown> }) => void
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async sendNewOrder(payload: Record<string, unknown>): Promise<{
    confirmedSent: boolean;
    response: Record<string, unknown>;
  }> {
    const response = await this.sendCommand("ProtoOANewOrderReq", payload);
    return { confirmedSent: true, response };
  }

  async sendCommand(
    name: string,
    payload: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    return this.enqueue(async () => {
      await this.ensureAuthenticated();
      this.stats.commandsSent += 1;
      return (await withBoundedOp(name, COMMAND_TIMEOUT_MS, () =>
        this.connection!.sendCommand(name, payload)
      )) as Record<string, unknown>;
    });
  }

  async expectedMargin(args: {
    symbolId: string;
    volume: number;
    side: "BUY" | "SELL";
  }): Promise<ExpectedMarginResult> {
    const accountId = safeWireAccountId(this.creds.ctidTraderAccountId);
    const symbolId = safeWireAccountId(args.symbolId);
    const volume = safeInteger(args.volume);
    if (accountId == null || symbolId == null || volume == null || !(volume > 0)) {
      return { ok: false, notes: ["accountId/symbolId/volume unsafe"] };
    }
    try {
      const res = (await this.sendCommand("ProtoOAExpectedMarginReq", {
        ctidTraderAccountId: accountId,
        symbolId,
        volume: [volume]
      })) as Record<string, unknown>;
      const moneyDigits = safeInteger(res.moneyDigits);
      if (moneyDigits == null) {
        return { ok: false, notes: ["ExpectedMargin moneyDigits missing"] };
      }
      const quotes = parseExpectedMarginEntries({
        margins: res.margin ?? res.margins,
        moneyDigits
      });
      const expected = selectSideExpectedMargin({
        side: args.side,
        protocolVolume: volume,
        quotes
      });
      const match = quotes.find((q) => q.volume === volume);
      if (expected == null || !match) {
        return { ok: false, notes: [`No ${args.side} margin for volume ${volume}`] };
      }
      return {
        ok: true,
        expectedMargin: expected,
        buyMargin: match.buyMargin,
        sellMargin: match.sellMargin,
        volume,
        moneyDigits
      };
    } catch (err) {
      return {
        ok: false,
        notes: [
          err instanceof Error
            ? `ProtoOAExpectedMarginReq failed: ${err.message}`
            : "ProtoOAExpectedMarginReq failed"
        ]
      };
    }
  }

  async authoritativeSnapshot(): Promise<AuthoritativeMarginSnapshotResult> {
    const accountId = safeWireAccountId(this.creds.ctidTraderAccountId);
    if (accountId == null) {
      return { ok: false, notes: ["ctidTraderAccountId unsafe"] };
    }
    try {
      const traderRes = (await this.sendCommand("ProtoOATraderReq", {
        ctidTraderAccountId: accountId
      })) as Record<string, unknown>;
      const t = (traderRes.trader ?? traderRes) as Record<string, unknown>;
      const moneyDigits = safeInteger(t.moneyDigits) ?? 2;
      const balance = moneyFromDigitsSafe(t.balance, moneyDigits);
      const recon = (await this.sendCommand("ProtoOAReconcileReq", {
        ctidTraderAccountId: accountId
      })) as Record<string, unknown>;
      const snapshot = parseReconcileSnapshot(recon);
      let unrealisedRows:
        | { positionId: string; netUnrealisedPnl: number | null }[]
        | null = null;
      if (snapshot.positions.length > 0) {
        try {
          const pnlRes = (await this.sendCommand(
            "ProtoOAGetPositionUnrealizedPnLReq",
            { ctidTraderAccountId: accountId }
          )) as Record<string, unknown>;
          const pnlDigits = safeInteger(pnlRes.moneyDigits) ?? moneyDigits;
          const rows = Array.isArray(pnlRes.positionUnrealizedPnL)
            ? pnlRes.positionUnrealizedPnL
            : [];
          unrealisedRows = rows.map((item) => {
            const row = (item ?? {}) as Record<string, unknown>;
            return {
              positionId: String(row.positionId ?? ""),
              netUnrealisedPnl: moneyFromDigitsSafe(
                row.netUnrealizedPnL ?? row.netUnrealisedPnl,
                pnlDigits
              )
            };
          });
        } catch {
          unrealisedRows = null;
        }
      }
      const computed = computeAuthoritativeMarginSnapshot({
        balance,
        moneyDigits,
        leverage:
          typeof t.leverageInCents === "number" ? t.leverageInCents / 100 : null,
        openPositionCount: snapshot.positions.length,
        reconcileOk: true,
        positionsUsedMargin: snapshot.positions.map((p) => ({
          positionId: p.positionId,
          usedMargin: p.usedMargin ?? null
        })),
        unrealisedRows
      });
      if (!computed.ok) return { ok: false, notes: computed.notes };
      return { ok: true, snapshot: computed.snapshot };
    } catch (err) {
      return {
        ok: false,
        notes: [
          err instanceof Error
            ? err.message
            : "authoritative snapshot failed"
        ]
      };
    }
  }

  async reconcile(): Promise<ReconcileSnapshot> {
    const accountId = safeWireAccountId(this.creds.ctidTraderAccountId);
    if (accountId == null) return { orders: [], positions: [] };
    const recon = (await this.sendCommand("ProtoOAReconcileReq", {
      ctidTraderAccountId: accountId
    })) as Record<string, unknown>;
    return parseReconcileSnapshot(recon);
  }

  markDead(): void {
    this.dead = true;
    this.authenticated = false;
    this.stats.authenticated = false;
    this.stopHeartbeat();
    try {
      this.connection?.close();
    } catch {
      /* ignore */
    }
    this.connection = null;
  }

  dispose(): void {
    this.markDead();
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        run: run as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject
      });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;
      try {
        item.resolve(await item.run());
      } catch (err) {
        item.reject(err);
      }
    }
    this.draining = false;
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.authenticated && this.connection && !this.dead) return;
    if (this.opening) {
      await this.opening;
      return;
    }
    this.opening = this.connectAndAuth();
    try {
      await this.opening;
    } finally {
      this.opening = null;
    }
  }

  private async connectAndAuth(): Promise<void> {
    if (this.connection) {
      this.stats.reconnects += 1;
      this.markDead();
      this.dead = false;
    }
    const connection = new CTraderConnection({
      host: DEMO_HOST,
      port: DEMO_PORT
    });
    this.stats.connectionsCreated += 1;
    await withBoundedOp("DEMO_OPEN", AUTH_TIMEOUT_MS, () => connection.open());
    this.connection = connection;
    this.attachPushEvents(connection);
    await withBoundedOp("DEMO_APP_AUTH", AUTH_TIMEOUT_MS, () =>
      connection.sendCommand("ProtoOAApplicationAuthReq", {
        clientId: this.creds.clientId,
        clientSecret: this.creds.clientSecret
      })
    );
    await withBoundedOp("DEMO_ACCOUNT_AUTH", AUTH_TIMEOUT_MS, () =>
      connection.sendCommand("ProtoOAAccountAuthReq", {
        accessToken: this.creds.accessToken,
        ctidTraderAccountId: Number(this.creds.ctidTraderAccountId)
      })
    );
    this.authenticated = true;
    this.dead = false;
    this.stats.authenticated = true;
    this.startHeartbeat();
  }

  private attachPushEvents(connection: InstanceType<typeof CTraderConnection>): void {
    const names = [
      "ProtoOAExecutionEvent",
      "ProtoOAOrderErrorEvent",
      "ProtoOAErrorRes",
      "ProtoErrorRes"
    ];
    for (const hook of this.eventHooks) {
      try {
        connection.removeEventListener(hook);
      } catch {
        /* ignore */
      }
    }
    this.eventHooks = [];
    for (const name of names) {
      try {
        const id = connection.on(name, (event: unknown) => {
          const row = (event ?? {}) as {
            descriptor?: Record<string, unknown>;
          } & Record<string, unknown>;
          const payload = {
            ...row,
            ...((row.descriptor ?? {}) as Record<string, unknown>)
          };
          for (const listener of this.listeners) {
            listener({ name, payload });
          }
        });
        if (typeof id === "string") this.eventHooks.push(id);
      } catch {
        /* payload type may be missing */
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.connection || this.dead) return;
      try {
        this.connection.sendHeartbeat();
        this.stats.lastHeartbeatAt = Date.now();
      } catch {
        this.markDead();
      }
    }, HEARTBEAT_MS);
    if (typeof this.heartbeatTimer === "object" && "unref" in this.heartbeatTimer) {
      this.heartbeatTimer.unref();
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

const pool = new Map<string, FastDemoSession>();

function poolKey(creds: FastDemoSessionCreds): string {
  return `${creds.ctidTraderAccountId}`;
}

export function acquireFastDemoSession(creds: FastDemoSessionCreds): FastDemoSession {
  const key = poolKey(creds);
  const existing = pool.get(key);
  if (existing && existing.stats.authenticated) return existing;
  const session = existing ?? new FastDemoSession(creds);
  pool.set(key, session);
  return session;
}

export function resetFastDemoSessionsForTests(): void {
  for (const session of pool.values()) session.dispose();
  pool.clear();
}

export function fastDemoSessionPoolSize(): number {
  return pool.size;
}

export async function withFastDemoSession<T>(
  creds: FastDemoSessionCreds,
  fn: (session: FastDemoSession) => Promise<T>
): Promise<T> {
  const session = acquireFastDemoSession(creds);
  return fn(session);
}
