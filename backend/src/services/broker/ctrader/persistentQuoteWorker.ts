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
 * Health is based on LAST SUCCESSFUL VALID QUOTE / PERSIST — not lock heartbeat
 * alone. A live heartbeat with a stalled quote stream triggers reconnect.
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
  parseScheduleIntervals,
  type ScheduleInterval
} from "./marketSchedule";
import {
  assertAccountAllowlisted,
  requireLiveAllowlist
} from "./accountAllowlist";
import { acquireWorkerLock, type WorkerLockHandle } from "./workerLock";
import {
  markGoldHunterDepthAttached,
  markGoldHunterSpotAttached,
  notifyGoldHunterResync,
  onGoldHunterDepthEvent,
  onGoldHunterSpotEvent
} from "../../goldHunterAdmin/marketFeedHook";
import {
  enqueueGoldHunterReconcilePass,
  maybeEnqueueStaleCloseRequestedWatchdog,
  runGoldHunterReconcilePass
} from "../../goldHunterAdmin/reconciliationRuntime";
import {
  DEFAULT_QUOTE_STALL_MS,
  DEFAULT_QUOTE_STALL_MS_MARKET_CLOSED,
  evaluateQuoteStreamHealth,
  isQuoteWorkerHealthy
} from "./quoteStreamHealth";
import { brokerSymbolFromProtoOASymbolById } from "./brokerSymbolFromProtoOASymbolById";
import {
  invalidateWorkerSymbolMetadataCache,
  putWorkerSymbolMetadata
} from "./workerSymbolMetadataCache";

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
  /** Epoch ms of last accepted valid bid+ask spot. */
  lastValidQuoteAtMs: number | null;
  /** Epoch ms of last successful Firestore quote persist. */
  lastPersistedQuoteAtMs: number | null;
  marketStatus: AuthoritativeQuote["marketStatus"] | null;
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

function logWorker(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...fields, ts: new Date().toISOString() }));
}

function stallAfterMsFor(
  marketStatus: AuthoritativeQuote["marketStatus"] | null
): number {
  const openEnv = Number(process.env.CTRADER_QUOTE_INACTIVITY_MS ?? "");
  const closedEnv = Number(process.env.CTRADER_QUOTE_INACTIVITY_MS_CLOSED ?? "");
  if (marketStatus === "CLOSED") {
    return Number.isFinite(closedEnv) && closedEnv >= 5_000
      ? closedEnv
      : DEFAULT_QUOTE_STALL_MS_MARKET_CLOSED;
  }
  return Number.isFinite(openEnv) && openEnv >= 5_000
    ? openEnv
    : DEFAULT_QUOTE_STALL_MS;
}

/**
 * Recompute market status from the schedule cached at worker connect.
 * Uses marketStatusFromSchedule — no second hours implementation, no Spotware
 * metadata round-trip. Call on every spot/persist so CLOSED↔OPEN flips while
 * the WebSocket stays up (no reconnect required for status transitions).
 */
export function resolveCachedScheduleMarketStatus(args: {
  schedule: ScheduleInterval[];
  timeZone?: string | null;
  now?: Date;
}): AuthoritativeQuote["marketStatus"] {
  if (!args.schedule.length) return "UNKNOWN";
  return marketStatusFromSchedule({
    schedule: args.schedule,
    timeZone: args.timeZone,
    now: args.now
  });
}

/** Build an authoritative quote using current schedule evaluation (test + worker path). */
export function buildAuthoritativeQuoteFromCachedSchedule(args: {
  symbolId: string;
  symbolName: string;
  digits?: number | null;
  pipPosition?: number | null;
  bid: number;
  ask: number;
  brokerTimestamp: string;
  quoteSequence: number;
  environment: "DEMO" | "LIVE";
  schedule: ScheduleInterval[];
  scheduleTimeZone?: string | null;
  nowMs: number;
  source?: "LIVE" | "CACHED";
}): AuthoritativeQuote {
  const marketStatus = resolveCachedScheduleMarketStatus({
    schedule: args.schedule,
    timeZone: args.scheduleTimeZone,
    now: new Date(args.nowMs)
  });
  return buildAuthoritativeQuote({
    symbolId: args.symbolId,
    symbolName: args.symbolName,
    digits: args.digits,
    pipPosition: args.pipPosition,
    bid: args.bid,
    ask: args.ask,
    brokerTimestamp: args.brokerTimestamp,
    quoteSequence: args.quoteSequence,
    marketStatus,
    environment: args.environment,
    source: args.source ?? "LIVE",
    nowMs: args.nowMs,
    thresholds: loadLiveQuoteThresholds()
  });
}

export class PersistentXauUsdQuoteWorker {
  private connection: InstanceType<typeof CTraderConnection> | null = null;
  private stopping = false;
  private persistMinMs = DEFAULT_PERSIST_MIN_MS;
  private lastPersistAt = 0;
  private lock: WorkerLockHandle | null = null;
  private lockRenewTimer: ReturnType<typeof setInterval> | null = null;
  /** Bounded Gold Hunter reconcile — never rapid-fire. */
  private ghReconcileTimer: ReturnType<typeof setInterval> | null = null;
  /** Broker symbol schedule fetched once per WS session — recomputed over time. */
  private cachedSchedule: ScheduleInterval[] = [];
  private cachedScheduleTimeZone = "UTC";
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
    lastValidQuoteAtMs: null,
    lastPersistedQuoteAtMs: null,
    marketStatus: null,
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

    logWorker("quote_worker_started", {
      ownerUidHash: ownerUid.slice(0, 6) + "…"
    });

    // Startup reconciliation — surface last stored quote immediately in health.
    try {
      const stored = await getStoredAuthoritativeQuote(ownerUid);
      if (stored) {
        this.status.lastQuote = stored;
        const received = Date.parse(stored.receivedAt);
        if (Number.isFinite(received)) {
          this.status.lastValidQuoteAtMs = received;
          this.status.lastPersistedQuoteAtMs = received;
        }
      }
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
      void this.lock
        ?.renew({
          lastSuccessfulQuoteAt: this.status.lastPersistedQuoteAtMs
            ? new Date(this.status.lastPersistedQuoteAtMs).toISOString()
            : null
        })
        .then((ok) => {
          if (ok) this.status.lastHeartbeatAt = new Date().toISOString();
          else {
            this.status.lockHeld = false;
            this.status.lastError = "CTRADER_QUOTE_WORKER_LOCK_LOST";
            logWorker("quote_worker_lock_lost", {
              ownerUidHash: ownerUid.slice(0, 6) + "…"
            });
          }
        });
    }, LOCK_RENEW_MS);

    // Gold Hunter lifecycle reconcile on worker startup (force once).
    void runGoldHunterReconcilePass({ ownerUid, force: true }).catch(() => {
      /* GH reconcile is best-effort; quote worker must stay up */
    });
    if (this.ghReconcileTimer) clearInterval(this.ghReconcileTimer);
    this.ghReconcileTimer = setInterval(() => {
      void maybeEnqueueStaleCloseRequestedWatchdog(ownerUid).catch(() => {
        /* watchdog is best-effort */
      });
      enqueueGoldHunterReconcilePass(ownerUid, false);
    }, 30_000);

    await this.loop(ownerUid);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.status.running = false;
    if (this.status.ownerUid) {
      invalidateWorkerSymbolMetadataCache({
        ownerUid: this.status.ownerUid,
        reason: "worker_stop"
      });
    }
    if (this.ghReconcileTimer) {
      clearInterval(this.ghReconcileTimer);
      this.ghReconcileTimer = null;
    }
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
        // connectAndSubscribe resolves when the socket ends or stream stalls.
        this.status.connected = false;
        if (!this.status.lastError) {
          this.status.lastError = "CTRADER_WS_DISCONNECTED";
        }
      } catch (e) {
        this.status.connected = false;
        this.status.lastError =
          e instanceof Error ? e.message : "CTRADER_WORKER_ERROR";
        logWorker("quote_worker_connect_failed", {
          error: this.status.lastError,
          reconnectAttempts: this.status.reconnectAttempts
        });
      }
      if (this.stopping) break;
      const delay = Math.min(
        RECONNECT_BASE_MS * Math.pow(2, Math.min(6, this.status.reconnectAttempts)),
        RECONNECT_MAX_MS
      );
      this.status.reconnectAttempts += 1;
      logWorker("quote_worker_reconnect_scheduled", {
        delayMs: delay,
        reconnectAttempts: this.status.reconnectAttempts,
        lastError: this.status.lastError
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  private async connectAndSubscribe(ownerUid: string): Promise<void> {
    // Invalidate prior session metadata before (re)connect — account/symbol/env may change.
    invalidateWorkerSymbolMetadataCache({
      ownerUid,
      reason: "worker_reconnect"
    });

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
    logWorker("quote_worker_ctrader_connected", {
      environment: this.status.environment,
      symbolId: this.status.symbolId
    });

    this.cachedSchedule = [];
    this.cachedScheduleTimeZone = "UTC";
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
      this.cachedSchedule = parseScheduleIntervals(detail.schedule);
      this.cachedScheduleTimeZone =
        typeof detail.scheduleTimeZone === "string" && detail.scheduleTimeZone.trim()
          ? detail.scheduleTimeZone.trim()
          : "UTC";
      marketStatus = resolveCachedScheduleMarketStatus({
        schedule: this.cachedSchedule,
        timeZone: this.cachedScheduleTimeZone
      });
      if (typeof detail.symbolName === "string" && detail.symbolName.trim()) {
        this.status.symbolName = detail.symbolName.trim();
      }

      // Authoritative sizing metadata for Gold Hunter — same parse path as discoverXauUsd.
      const env: "DEMO" | "LIVE" = isLive ? "LIVE" : "DEMO";
      const brokerSymbol = brokerSymbolFromProtoOASymbolById({
        detail,
        symbolId: fresh.symbolId!,
        symbolName: this.status.symbolName ?? fresh.symbolName ?? "XAUUSD",
        baseAsset: "XAU",
        quoteAsset: "USD",
        environment: env
      });
      if (brokerSymbol) {
        putWorkerSymbolMetadata({
          ownerUid,
          ctidTraderAccountId: String(fresh.selectedAccountId),
          environment: env,
          symbol: brokerSymbol,
          source: "CTRADER_WORKER_SYMBOL_BY_ID"
        });
      } else {
        logWorker("quote_worker_symbol_metadata_parse_failed", {
          symbolId: fresh.symbolId
        });
      }
    } catch {
      this.cachedSchedule = [];
      this.cachedScheduleTimeZone = "UTC";
      marketStatus = "UNKNOWN";
    }
    this.status.marketStatus = marketStatus;

    await connection.sendCommand("ProtoOASubscribeSpotsReq", {
      ctidTraderAccountId: Number(fresh.selectedAccountId),
      symbolId: [Number(fresh.symbolId)],
      subscribeToSpotTimestamp: true
    });

    // Register handlers before Depth subscribe so the initial book snapshot is not missed.
    connection.on("ProtoOASpotEvent", (event: { descriptor?: Record<string, unknown> }) => {
      void this.onSpot(event?.descriptor ?? {}, {
        ownerUid,
        symbolId: fresh.symbolId!,
        symbolName: this.status.symbolName ?? "XAUUSD",
        digits: fresh.symbolDigits ?? null,
        pipPosition: fresh.symbolPipPosition ?? null,
        environment: isLive ? "LIVE" : "DEMO"
      }).catch((err) => {
        this.status.lastError =
          err instanceof Error ? err.message : "CTRADER_SPOT_HANDLE_FAILED";
      });
    });

    connection.on("ProtoOADepthEvent", (event: { descriptor?: Record<string, unknown> }) => {
      void onGoldHunterDepthEvent(
        {
          ownerUid,
          symbolId: fresh.symbolId!,
          environment: isLive ? "LIVE" : "DEMO"
        },
        event?.descriptor ?? {}
      ).catch(() => {
        /* GH depth feed is best-effort; quote worker must stay up */
      });
    });

    await notifyGoldHunterResync(ownerUid);
    await markGoldHunterSpotAttached(ownerUid, true);
    // After reconnect / resync — force a safe GH reconcile pass (no order retry).
    enqueueGoldHunterReconcilePass(ownerUid, true);

    // Gold Hunter Level-II (additive) — does not change Spot quote persist path.
    try {
      await connection.sendCommand("ProtoOASubscribeDepthQuotesReq", {
        ctidTraderAccountId: Number(fresh.selectedAccountId),
        symbolId: [Number(fresh.symbolId)]
      });
      await markGoldHunterDepthAttached(ownerUid, true);
      logWorker("quote_worker_depth_subscribed", {
        symbolId: this.status.symbolId
      });
    } catch (depthErr) {
      logWorker("quote_worker_depth_subscribe_failed", {
        error:
          depthErr instanceof Error ? depthErr.message : "DEPTH_SUBSCRIBE_FAILED"
      });
    }
    logWorker("quote_worker_xauusd_subscribed", {
      symbolId: this.status.symbolId,
      symbolName: this.status.symbolName,
      marketStatus,
      scheduleIntervalCount: this.cachedSchedule.length,
      scheduleTimeZone: this.cachedScheduleTimeZone
    });

    this.status.connected = true;
    this.status.reconnectAttempts = 0;
    this.status.lastError = null;
    // New session must prove stream health with fresh spots/persists.
    // Keep lastQuote for partial bid/ask carry-forward only.
    this.status.lastValidQuoteAtMs = null;
    this.status.lastPersistedQuoteAtMs = null;
    const sessionStartedAtMs = Date.now();

    // Spotware requires protocol heartbeats. Stream health uses valid quotes only.
    // Market-status flips do NOT force reconnect — only a stalled quote stream does.
    const HEARTBEAT_MS = 10_000;
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
        const nowMs = Date.now();
        // Keep worker health aligned with the current schedule window.
        const liveStatus = this.resolveSessionMarketStatus(nowMs);
        if (liveStatus !== this.status.marketStatus) {
          logWorker("quote_worker_market_status_transition", {
            from: this.status.marketStatus,
            to: liveStatus,
            reconnectRequired: false
          });
          this.status.marketStatus = liveStatus;
        }
        const stallAfterMs = stallAfterMsFor(liveStatus);
        // Grace window after subscribe for the first valid tick.
        if (nowMs - sessionStartedAtMs < stallAfterMs) return;
        const health = evaluateQuoteStreamHealth({
          nowMs,
          lastValidQuoteAtMs: this.status.lastValidQuoteAtMs,
          lastPersistedQuoteAtMs: this.status.lastPersistedQuoteAtMs,
          marketStatus: liveStatus,
          stallAfterMs
        });
        if (health.stalled) {
          this.status.lastError = `CTRADER_QUOTE_STREAM_STALLED:${health.reason}`;
          logWorker("quote_stream_stalled", {
            reason: health.reason,
            ageMs: health.ageMs,
            stallAfterMs: health.stallAfterMs,
            marketStatus: liveStatus,
            lastValidQuoteAtMs: this.status.lastValidQuoteAtMs,
            lastPersistedQuoteAtMs: this.status.lastPersistedQuoteAtMs
          });
          logWorker("quote_worker_reconnect_attempt", {
            cause: health.reason
          });
          clearInterval(heartbeat);
          clearInterval(watch);
          resolve();
        }
      }, 1_000);
    });

    await this.closeConnection();
    this.status.connected = false;
  }

  /** Current market status from the schedule cached for this WS session. */
  private resolveSessionMarketStatus(nowMs: number = Date.now()): AuthoritativeQuote["marketStatus"] {
    return resolveCachedScheduleMarketStatus({
      schedule: this.cachedSchedule,
      timeZone: this.cachedScheduleTimeZone,
      now: new Date(nowMs)
    });
  }

  private async onSpot(
    spot: Record<string, unknown>,
    meta: {
      ownerUid: string;
      symbolId: string;
      symbolName: string;
      digits: number | null;
      pipPosition: number | null;
      environment: "DEMO" | "LIVE";
    }
  ): Promise<void> {
    if (
      asNumber(spot.symbolId) != null &&
      asNumber(spot.symbolId) !== Number(meta.symbolId)
    ) {
      return;
    }
    // Spotware may omit an unchanged side — carry forward last valid prices.
    let bid = spotPriceFromRelative(spot.bid);
    let ask = spotPriceFromRelative(spot.ask);
    if (bid == null && this.status.lastQuote) bid = this.status.lastQuote.bid;
    if (ask == null && this.status.lastQuote) ask = this.status.lastQuote.ask;
    if (bid == null || ask == null || !(ask >= bid)) {
      // Do NOT treat incomplete/empty spot events as stream activity.
      return;
    }

    const now = Date.now();
    this.status.lastValidQuoteAtMs = now;
    // Recompute from cached broker schedule on every accepted spot so a worker
    // that connected during rollover flips to OPEN without reconnecting.
    const marketStatus = this.resolveSessionMarketStatus(now);
    if (marketStatus !== this.status.marketStatus) {
      logWorker("quote_worker_market_status_transition", {
        from: this.status.marketStatus,
        to: marketStatus,
        reconnectRequired: false
      });
    }
    this.status.marketStatus = marketStatus;

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
        marketStatus,
        environment: meta.environment,
        source: "LIVE",
        nowMs: now,
        thresholds: loadLiveQuoteThresholds()
      });
      void onGoldHunterSpotEvent(
        {
          ownerUid: meta.ownerUid,
          symbolId: meta.symbolId,
          environment: meta.environment
        },
        spot
      ).catch(() => undefined);
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
      marketStatus,
      environment: meta.environment,
      source: "LIVE",
      nowMs: now,
      thresholds: loadLiveQuoteThresholds()
    });
    await saveAuthoritativeQuote(meta.ownerUid, quote);
    this.lastPersistAt = now;
    this.status.lastPersistedQuoteAtMs = now;
    this.status.lastQuote = quote;

    // Forward normalized Spot into Gold Hunter selector (best-effort).
    void onGoldHunterSpotEvent(
      {
        ownerUid: meta.ownerUid,
        symbolId: meta.symbolId,
        environment: meta.environment
      },
      spot
    ).catch(() => undefined);
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
      const stream = evaluateQuoteStreamHealth({
        nowMs: Date.now(),
        lastValidQuoteAtMs: status.lastValidQuoteAtMs,
        lastPersistedQuoteAtMs: status.lastPersistedQuoteAtMs,
        marketStatus: status.marketStatus
      });
      const ok = isQuoteWorkerHealthy({
        running: status.running,
        lockHeld: status.lockHeld,
        stream
      });
      const lastQuoteAgeMs =
        status.lastPersistedQuoteAtMs != null
          ? Date.now() - status.lastPersistedQuoteAtMs
          : null;
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
          marketStatus: status.marketStatus,
          reconnectAttempts: status.reconnectAttempts,
          startedAt: status.startedAt,
          lastHeartbeatAt: status.lastHeartbeatAt,
          lastError: status.lastError,
          websocketPersistent: status.websocketPersistent,
          quoteStream: {
            stalled: stream.stalled,
            reason: stream.reason,
            ageMs: stream.ageMs,
            stallAfterMs: stream.stallAfterMs,
            lastValidQuoteAtMs: status.lastValidQuoteAtMs,
            lastPersistedQuoteAtMs: status.lastPersistedQuoteAtMs,
            lastSuccessfulQuoteAgeMs: lastQuoteAgeMs
          },
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
