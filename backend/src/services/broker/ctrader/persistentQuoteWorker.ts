/**
 * Always-on Pepperstone XAUUSD quote worker.
 *
 * Cloud Functions HTTP handlers open a Spotware WebSocket per request and close
 * it in `finally` — that is NOT a continuous quote stream.
 *
 * This worker holds a long-lived Open API connection, applies every relevant
 * ProtoOASpotEvent into the authoritative Firestore quote store, and exposes a
 * tiny health HTTP endpoint for Cloud Run / local process supervision.
 *
 * Run via: `npx tsx scripts/runPersistentQuoteWorker.ts`
 * Deploy target: always-on runtime (Cloud Run min instances ≥ 1, or equivalent).
 * Live order submission remains hard-locked elsewhere.
 */

import http from "node:http";
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { getConnection } from "./connectionStore";
import { ensureFreshAccessToken, assertBrokerUser } from "./connectionService";
import {
  buildAuthoritativeQuote,
  loadLiveQuoteThresholds,
  type AuthoritativeQuote
} from "./liveQuote";
import { nextQuoteSequence, saveAuthoritativeQuote, getStoredAuthoritativeQuote } from "./quoteStore";
import {
  marketStatusFromSchedule,
  parseScheduleIntervals
} from "./marketSchedule";
import {
  assertAccountAllowlisted,
  requireLiveAllowlist
} from "./accountAllowlist";
import { acquireWorkerLock, type WorkerLockHandle } from "./workerLock";

const DEMO_HOST = "demo.ctraderapi.com";
const LIVE_HOST = "live.ctraderapi.com";
const PORT = 5035;
const SPOT_PRICE_SCALE = 100_000;
const DEFAULT_PERSIST_MIN_MS = 250;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
const LOCK_RENEW_MS = 15_000;

export type PersistentWorkerStatus = {
  running: boolean;
  ownerUid: string | null;
  environment: "DEMO" | "LIVE" | null;
  symbolId: string | null;
  symbolName: string | null;
  connected: boolean;
  lastQuote: AuthoritativeQuote | null;
  lastError: string | null;
  startedAt: string | null;
  reconnectAttempts: number;
  lockHeld: boolean;
  lastHeartbeatAt: string | null;
  /** True only while the Spotware WS is open and subscribed. */
  websocketPersistent: true;
};

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function spotPriceFromRelative(value: unknown): number | null {
  const n = asNumber(value);
  if (n == null) return null;
  return n / SPOT_PRICE_SCALE;
}

function clientCreds(source = process.env) {
  return {
    clientId: (source.CTRADER_CLIENT_ID ?? "").trim(),
    clientSecret: (source.CTRADER_CLIENT_SECRET ?? "").trim()
  };
}

export class PersistentXauUsdQuoteWorker {
  private connection: InstanceType<typeof CTraderConnection> | null = null;
  private stopping = false;
  private persistMinMs = DEFAULT_PERSIST_MIN_MS;
  private lastPersistAt = 0;
  private lock: WorkerLockHandle | null = null;
  private lockRenewTimer: ReturnType<typeof setInterval> | null = null;
  private status: PersistentWorkerStatus = {
    running: false,
    ownerUid: null,
    environment: null,
    symbolId: null,
    symbolName: null,
    connected: false,
    lastQuote: null,
    lastError: null,
    startedAt: null,
    reconnectAttempts: 0,
    lockHeld: false,
    lastHeartbeatAt: null,
    websocketPersistent: true
  };

  getStatus(): PersistentWorkerStatus {
    return { ...this.status, lastQuote: this.status.lastQuote };
  }

  async start(ownerUid: string): Promise<void> {
    assertBrokerUser(ownerUid);
    this.stopping = false;
    this.status.running = true;
    this.status.ownerUid = ownerUid;
    this.status.startedAt = new Date().toISOString();
    const persistEnv = Number(process.env.CTRADER_QUOTE_PERSIST_MIN_MS ?? "");
    if (Number.isFinite(persistEnv) && persistEnv >= 0) {
      this.persistMinMs = persistEnv;
    }

    // Startup reconciliation — surface last stored quote immediately in health.
    try {
      const stored = await getStoredAuthoritativeQuote(ownerUid);
      if (stored) this.status.lastQuote = stored;
    } catch {
      /* best-effort */
    }

    this.lock = await acquireWorkerLock(ownerUid);
    if (!this.lock) {
      throw new Error("CTRADER_QUOTE_WORKER_LOCK_HELD");
    }
    this.status.lockHeld = true;
    this.status.lastHeartbeatAt = new Date().toISOString();
    this.lockRenewTimer = setInterval(() => {
      void this.lock?.renew().then((ok) => {
        if (ok) this.status.lastHeartbeatAt = new Date().toISOString();
        else {
          this.status.lockHeld = false;
          this.status.lastError = "CTRADER_QUOTE_WORKER_LOCK_LOST";
        }
      });
    }, LOCK_RENEW_MS);

    await this.loop(ownerUid);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.status.running = false;
    this.status.connected = false;
    if (this.lockRenewTimer) {
      clearInterval(this.lockRenewTimer);
      this.lockRenewTimer = null;
    }
    await this.closeConnection();
    if (this.lock) {
      await this.lock.release().catch(() => undefined);
      this.lock = null;
      this.status.lockHeld = false;
    }
  }

  private async closeConnection(): Promise<void> {
    const conn = this.connection;
    this.connection = null;
    if (!conn) return;
    try {
      void conn.close();
    } catch {
      /* ignore */
    }
  }

  private async loop(ownerUid: string): Promise<void> {
    while (!this.stopping) {
      try {
        await this.connectAndSubscribe(ownerUid);
        // connectAndSubscribe resolves when the socket ends unexpectedly.
        this.status.connected = false;
        this.status.lastError = "CTRADER_WS_DISCONNECTED";
      } catch (e) {
        this.status.connected = false;
        this.status.lastError =
          e instanceof Error ? e.message : "CTRADER_WORKER_ERROR";
      }
      if (this.stopping) break;
      const delay = Math.min(
        RECONNECT_BASE_MS * Math.pow(2, Math.min(6, this.status.reconnectAttempts)),
        RECONNECT_MAX_MS
      );
      this.status.reconnectAttempts += 1;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  private async connectAndSubscribe(ownerUid: string): Promise<void> {
    const stored = await getConnection(ownerUid);
    if (!stored?.selectedAccountId || !stored.symbolId) {
      throw new Error("CTRADER_ACCOUNT_OR_SYMBOL_REQUIRED");
    }
    assertAccountAllowlisted(String(stored.selectedAccountId));
    if (requireLiveAllowlist() && !stored.selectedAccountIsLive) {
      throw new Error("CTRADER_QUOTE_LIVE_ACCOUNT_REQUIRED");
    }
    const { accessToken, connection: fresh } = await ensureFreshAccessToken(stored);
    const { clientId, clientSecret } = clientCreds();
    if (!clientId || !clientSecret) {
      throw new Error("CTRADER_CREDENTIALS_MISSING");
    }

    const isLive = Boolean(fresh.selectedAccountIsLive);
    const host = isLive ? LIVE_HOST : DEMO_HOST;
    this.status.environment = isLive ? "LIVE" : "DEMO";
    this.status.symbolId = fresh.symbolId;
    this.status.symbolName = fresh.symbolName ?? "XAUUSD";

    const connection = new CTraderConnection({ host, port: PORT });
    this.connection = connection;
    await connection.open();

    await connection.sendCommand("ProtoOAApplicationAuthReq", {
      clientId,
      clientSecret
    });
    await connection.sendCommand("ProtoOAAccountAuthReq", {
      accessToken,
      ctidTraderAccountId: Number(fresh.selectedAccountId)
    });

    let marketStatus: AuthoritativeQuote["marketStatus"] = "UNKNOWN";
    try {
      const detailRes = (await connection.sendCommand("ProtoOASymbolByIdReq", {
        ctidTraderAccountId: Number(fresh.selectedAccountId),
        symbolId: [Number(fresh.symbolId)]
      })) as { symbol?: Array<Record<string, unknown>> | Record<string, unknown> };
      const detailList = Array.isArray(detailRes.symbol)
        ? detailRes.symbol
        : detailRes.symbol
          ? [detailRes.symbol]
          : [];
      const detail = detailList[0] ?? {};
      marketStatus = marketStatusFromSchedule({
        schedule: parseScheduleIntervals(detail.schedule),
        timeZone:
          typeof detail.scheduleTimeZone === "string"
            ? detail.scheduleTimeZone
            : "UTC"
      });
      if (typeof detail.symbolName === "string" && detail.symbolName.trim()) {
        this.status.symbolName = detail.symbolName.trim();
      }
    } catch {
      marketStatus = "UNKNOWN";
    }

    await connection.sendCommand("ProtoOASubscribeSpotsReq", {
      ctidTraderAccountId: Number(fresh.selectedAccountId),
      symbolId: [Number(fresh.symbolId)],
      subscribeToSpotTimestamp: true
    });

    this.status.connected = true;
    this.status.reconnectAttempts = 0;
    this.status.lastError = null;
    let lastSpotAt = Date.now();

    connection.on("ProtoOASpotEvent", (event: { descriptor?: Record<string, unknown> }) => {
      lastSpotAt = Date.now();
      void this.onSpot(event?.descriptor ?? {}, {
        ownerUid,
        symbolId: fresh.symbolId!,
        symbolName: this.status.symbolName ?? "XAUUSD",
        digits: fresh.symbolDigits ?? null,
        pipPosition: fresh.symbolPipPosition ?? null,
        marketStatus,
        environment: isLive ? "LIVE" : "DEMO"
      }).catch((err) => {
        this.status.lastError =
          err instanceof Error ? err.message : "CTRADER_SPOT_HANDLE_FAILED";
      });
    });

    // Spotware requires heartbeats. Library #onClose is silent — use inactivity.
    const HEARTBEAT_MS = 10_000;
    const INACTIVITY_MS = Number(process.env.CTRADER_QUOTE_INACTIVITY_MS ?? 45_000);
    await new Promise<void>((resolve) => {
      const heartbeat = setInterval(() => {
        try {
          connection.sendHeartbeat();
        } catch {
          /* ignore */
        }
      }, HEARTBEAT_MS);
      const watch = setInterval(() => {
        if (this.stopping) {
          clearInterval(heartbeat);
          clearInterval(watch);
          resolve();
          return;
        }
        if (Date.now() - lastSpotAt > INACTIVITY_MS) {
          this.status.lastError = "CTRADER_SPOT_INACTIVITY";
          clearInterval(heartbeat);
          clearInterval(watch);
          resolve();
        }
      }, 1_000);
    });

    await this.closeConnection();
    this.status.connected = false;
  }

  private async onSpot(
    spot: Record<string, unknown>,
    meta: {
      ownerUid: string;
      symbolId: string;
      symbolName: string;
      digits: number | null;
      pipPosition: number | null;
      marketStatus: AuthoritativeQuote["marketStatus"];
      environment: "DEMO" | "LIVE";
    }
  ): Promise<void> {
    if (
      asNumber(spot.symbolId) != null &&
      asNumber(spot.symbolId) !== Number(meta.symbolId)
    ) {
      return;
    }
    const bid = spotPriceFromRelative(spot.bid);
    const ask = spotPriceFromRelative(spot.ask);
    if (bid == null || ask == null || !(ask >= bid)) return;

    const now = Date.now();
    if (now - this.lastPersistAt < this.persistMinMs && this.status.lastQuote) {
      // Still update in-memory last quote for health, throttle Firestore writes.
      const tsMs = asNumber(spot.timestamp);
      const brokerTimestamp = tsMs
        ? new Date(tsMs).toISOString()
        : new Date(now).toISOString();
      this.status.lastQuote = buildAuthoritativeQuote({
        symbolId: meta.symbolId,
        symbolName: meta.symbolName,
        digits: meta.digits,
        pipPosition: meta.pipPosition,
        bid,
        ask,
        brokerTimestamp,
        quoteSequence: this.status.lastQuote.quoteSequence,
        marketStatus: meta.marketStatus,
        environment: meta.environment,
        source: "LIVE",
        nowMs: now,
        thresholds: loadLiveQuoteThresholds()
      });
      return;
    }

    const tsMs = asNumber(spot.timestamp);
    const brokerTimestamp = tsMs
      ? new Date(tsMs).toISOString()
      : new Date(now).toISOString();
    const sequence = await nextQuoteSequence(meta.ownerUid);
    const quote = buildAuthoritativeQuote({
      symbolId: meta.symbolId,
      symbolName: meta.symbolName,
      digits: meta.digits,
      pipPosition: meta.pipPosition,
      bid,
      ask,
      brokerTimestamp,
      quoteSequence: sequence,
      marketStatus: meta.marketStatus,
      environment: meta.environment,
      source: "LIVE",
      nowMs: now,
      thresholds: loadLiveQuoteThresholds()
    });
    await saveAuthoritativeQuote(meta.ownerUid, quote);
    this.lastPersistAt = now;
    this.status.lastQuote = quote;
  }
}

/** Minimal health server for Cloud Run / process monitors. */
export function startWorkerHealthServer(
  worker: PersistentXauUsdQuoteWorker,
  port = Number(process.env.PORT ?? 8080)
): http.Server {
  const server = http.createServer((req, res) => {
    const path = (req.url || "/").split("?")[0];
    if (
      path === "/healthz" ||
      path === "/" ||
      path === "/v1/ctrader/worker-health"
    ) {
      const status = worker.getStatus();
      const ok = status.running && status.connected;
      res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok,
          running: status.running,
          connected: status.connected,
          lockHeld: status.lockHeld,
          environment: status.environment,
          symbolId: status.symbolId,
          symbolName: status.symbolName,
          reconnectAttempts: status.reconnectAttempts,
          startedAt: status.startedAt,
          lastHeartbeatAt: status.lastHeartbeatAt,
          lastError: status.lastError,
          websocketPersistent: status.websocketPersistent,
          lastQuote: status.lastQuote
            ? {
                bid: status.lastQuote.bid,
                ask: status.lastQuote.ask,
                mid: status.lastQuote.mid,
                freshness: status.lastQuote.freshness,
                quoteSequence: status.lastQuote.quoteSequence,
                brokerTimestamp: status.lastQuote.brokerTimestamp,
                receivedAt: status.lastQuote.receivedAt,
                marketStatus: status.lastQuote.marketStatus,
                environment: status.lastQuote.environment
              }
            : null,
          // Never expose tokens.
          secretsPresent: Boolean(
            (process.env.CTRADER_CLIENT_ID ?? "").trim() &&
              (process.env.CTRADER_CLIENT_SECRET ?? "").trim()
          )
        })
      );
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  server.listen(port, "0.0.0.0");
  return server;
}
