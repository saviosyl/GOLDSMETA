/**
 * Dedicated Micro Edge live market-data collector process.
 * Deployed mode uses Firestore vault + market store + status (shared with API).
 * NOT DEPLOYED by this PR — readiness + health only.
 */
import http from "node:http";
import {
  MICRO_BROKER_EXECUTION_ENABLED,
  MICRO_QUOTE_SAMPLE_INTERVAL_MS,
  MICRO_SHADOW_ONLY
} from "../config";
import type { MicroCTraderCredentials } from "../marketData/microCTraderAuth";
import { MicroLiveMarketSession } from "../marketData/liveSession";
import {
  createMicroMarketDataStore,
  type MicroMarketDataStore
} from "../marketData/marketDataStore";
import { computeLabelReadyDiagnostics } from "../marketData/historicalTicks";
import { microLog } from "../marketData/microLog";
import {
  credentialsFromVault,
  refreshVaultTokensIfNeeded
} from "../marketData/oauthService";
import { createMicroTokenVault, getMicroTokenVault } from "../marketData/tokenVault";
import {
  createMicroCollectorStatusStore,
  MICRO_COLLECTOR_VERSION,
  type MicroCollectorStatusStore,
  type MicroPersistentCollectorStatus
} from "../marketData/collectorStatusStore";
import { assertMicroRuntimeReadyForPersistentCollection } from "../marketData/runtimeReady";
import { isDeployedMicroRuntime, resolveMicroStorageMode } from "../marketData/storageMode";

export type LiveCollectorWorkerOptions = {
  store?: MicroMarketDataStore;
  statusStore?: MicroCollectorStatusStore;
  credentials?: MicroCTraderCredentials;
  vaultUid?: string;
  healthPort?: number;
  quoteSampleIntervalMs?: number;
  barPollIntervalMs?: number;
  nowMs?: () => number;
  /** When true, skip deployed fail-closed checks (unit tests). */
  allowLocalInjectedCredentials?: boolean;
};

export type LiveCollectorHealthPayload = {
  serviceHealthy: boolean;
  connectionState: string;
  oauthStatus: string;
  accountAuthorized: boolean | null;
  environment: string | null;
  symbolResolved: boolean;
  spotSubscribed: boolean;
  lastSpotEventAt: string | null;
  lastValidQuoteAt: string | null;
  quoteAgeMs: number | null;
  lastCompletedM1: string | null;
  lastCompletedM5: string | null;
  lastCompletedM15: string | null;
  lastHeartbeat: string | null;
  reconnectAttempts: number;
  barObservationCounts: { M1: number; M5: number; M15: number };
  quoteSampleCount: number;
  boundaryQuoteCount: number;
  labelReadyMinutes: number;
  historicalBackfillState: Record<string, unknown>;
  mutationSurface: "NONE";
  shadowOnly: true;
  brokerExecutionEnabled: false;
  modelStatus: "DATA COLLECTION / NOT TRAINED ON REAL DATA";
  storageMode: string;
};

export class MicroLiveCollectorWorker {
  readonly mutationSurface = "NONE" as const;
  private session: MicroLiveMarketSession | null = null;
  private readonly store: MicroMarketDataStore;
  private readonly statusStore: MicroCollectorStatusStore;
  private running = false;
  private stopping = false;
  private healthServer: http.Server | null = null;
  private barTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHealth: LiveCollectorHealthPayload | null = null;
  private readonly nowMs: () => number;

  constructor(private readonly opts: LiveCollectorWorkerOptions = {}) {
    this.store = opts.store ?? createMicroMarketDataStore();
    this.statusStore = opts.statusStore ?? createMicroCollectorStatusStore();
    this.nowMs = opts.nowMs ?? (() => Date.now());
    // Ensure vault factory is initialized in same storage mode.
    void createMicroTokenVault();
  }

  getSession(): MicroLiveMarketSession | null {
    return this.session;
  }

  async resolveCredentials(): Promise<MicroCTraderCredentials | null> {
    if (this.opts.credentials && this.opts.allowLocalInjectedCredentials) {
      return this.opts.credentials;
    }
    const vaultUid =
      this.opts.vaultUid ?? (process.env.MICRO_COLLECTOR_VAULT_UID ?? "").trim();
    if (!vaultUid) {
      if (isDeployedMicroRuntime()) {
        throw Object.assign(new Error("MICRO_COLLECTOR_VAULT_UID_MISSING"), {
          code: "MICRO_COLLECTOR_VAULT_UID_MISSING"
        });
      }
      return null;
    }
    await refreshVaultTokensIfNeeded(vaultUid);
    return credentialsFromVault(vaultUid);
  }

  async start(): Promise<void> {
    if (MICRO_BROKER_EXECUTION_ENABLED !== false) {
      throw new Error("MICRO_COLLECTOR_REFUSING_EXECUTION_FLAG");
    }
    if (!MICRO_SHADOW_ONLY) {
      throw new Error("MICRO_COLLECTOR_REFUSING_NON_SHADOW");
    }

    const ready = assertMicroRuntimeReadyForPersistentCollection();
    if (!ready.ok && isDeployedMicroRuntime()) {
      throw Object.assign(new Error(ready.message), { code: ready.code });
    }
    if (isDeployedMicroRuntime() && !this.opts.vaultUid && !(process.env.MICRO_COLLECTOR_VAULT_UID ?? "").trim()) {
      throw Object.assign(new Error("MICRO_COLLECTOR_VAULT_UID_MISSING"), {
        code: "MICRO_COLLECTOR_VAULT_UID_MISSING"
      });
    }

    this.running = true;
    this.stopping = false;
    await this.connectLoop();
    this.startBarPolling();
    this.startHeartbeatLoop();
    if (this.opts.healthPort != null) {
      await this.listenHealth(this.opts.healthPort);
    }
  }

  private async connectLoop(): Promise<void> {
    let creds: MicroCTraderCredentials | null = null;
    try {
      creds = await this.resolveCredentials();
    } catch (e) {
      microLog("MICRO_COLLECTOR_OAUTH_MISSING", {
        code: (e as { code?: string }).code ?? "oauth_missing"
      });
      await this.persistNotConnected("oauth_missing");
      return;
    }
    if (!creds) {
      microLog("MICRO_COLLECTOR_OAUTH_MISSING", {});
      await this.persistNotConnected("oauth_missing");
      return;
    }
    this.session = new MicroLiveMarketSession({
      store: this.store,
      credentials: creds,
      quoteSampleIntervalMs:
        this.opts.quoteSampleIntervalMs ?? MICRO_QUOTE_SAMPLE_INTERVAL_MS,
      nowMs: this.nowMs
    });
    try {
      await this.session.connect();
      microLog("MICRO_COLLECTOR_CONNECTED", {
        environment: creds.environment
      });
      await this.persistFromSession();
    } catch (e) {
      microLog("MICRO_COLLECTOR_CONNECT_FAILED", {
        code: (e as { code?: string }).code ?? "transport_disconnected"
      });
      await this.persistNotConnected(
        (e as { code?: string }).code ?? "transport_disconnected"
      );
      this.scheduleReconnect();
    }
    await this.refreshHealth();
  }

  private startBarPolling(): void {
    const interval = this.opts.barPollIntervalMs ?? 30_000;
    this.barTimer = setInterval(() => {
      void this.pollBarsOnce();
    }, interval);
  }

  private startHeartbeatLoop(): void {
    this.heartbeatTimer = setInterval(() => {
      void this.persistFromSession();
    }, 10_000);
  }

  private async pollBarsOnce(): Promise<void> {
    if (!this.session || this.stopping) return;
    try {
      await this.session.pollCompletedBars("M1", 5);
      await this.session.pollCompletedBars("M5", 3);
      await this.session.pollCompletedBars("M15", 2);
      await this.persistFromSession();
      await this.refreshHealth();
    } catch (e) {
      microLog("MICRO_COLLECTOR_BAR_POLL_FAILED", {
        code: (e as { code?: string }).code ?? "bar_poll_failed"
      });
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopping || !this.running) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnectFailClosed();
    }, 1000);
  }

  private async reconnectFailClosed(): Promise<void> {
    await this.persistNotConnected("transport_disconnected");
    if (!this.session) return;
    const ok = await this.session.boundedReconnect();
    if (!ok) {
      microLog("MICRO_COLLECTOR_RECONNECT_EXHAUSTED", {});
      await this.persistNotConnected("transport_disconnected");
    } else {
      await this.persistFromSession();
    }
    await this.refreshHealth();
  }

  private async persistNotConnected(reason: string): Promise<void> {
    const now = new Date(this.nowMs()).toISOString();
    const status: MicroPersistentCollectorStatus = {
      connectionState: "LIVE_NOT_CONNECTED",
      oauthStatus: reason,
      accountAuthorized: false,
      environment: null,
      broker: null,
      brokerVerified: null,
      symbolId: null,
      symbolName: null,
      spotSubscribed: false,
      lastSpotEventAt: null,
      lastValidQuoteAt: null,
      lastQuoteBrokerTimestamp: null,
      lastQuoteBid: null,
      lastQuoteAsk: null,
      lastCompletedM1: null,
      lastCompletedM5: null,
      lastCompletedM15: null,
      heartbeatAt: now,
      reconnectAttempts: this.session
        ? (await this.session.getState()).reconnectAttempts
        : 0,
      collectorVersion: MICRO_COLLECTOR_VERSION,
      permissionScope: null,
      mutationSurface: "NONE",
      updatedAt: now
    };
    await this.statusStore.save(status);
  }

  private async persistFromSession(): Promise<void> {
    if (!this.session) return;
    const state = await this.session.getState();
    const vaultUid =
      this.opts.vaultUid ?? (process.env.MICRO_COLLECTOR_VAULT_UID ?? "").trim();
    const oauth = vaultUid
      ? await getMicroTokenVault().getPublicStatus(vaultUid)
      : null;
    const now = new Date(this.nowMs()).toISOString();
    const live = state.liveConnected;
    const status: MicroPersistentCollectorStatus = {
      connectionState: live ? "LIVE_CONNECTED" : "LIVE_NOT_CONNECTED",
      oauthStatus: oauth?.status ?? (state.credentialsConfigured ? "CONNECTED" : "AWAITING_USER_AUTHORIZATION"),
      accountAuthorized: state.configuredAccountAuthorized,
      environment: state.symbol?.environment ?? oauth?.environment ?? null,
      broker: "Pepperstone",
      brokerVerified: oauth?.brokerVerified ?? null,
      symbolId: state.symbol?.symbolId ?? null,
      symbolName: state.symbol?.symbolName ?? null,
      spotSubscribed: state.spotSubscribed,
      lastSpotEventAt: state.lastSpotEventAt,
      lastValidQuoteAt: state.lastQuoteTs,
      lastQuoteBrokerTimestamp: state.lastQuote?.brokerTimestamp ?? null,
      lastQuoteBid: state.lastQuote?.bid ?? null,
      lastQuoteAsk: state.lastQuote?.ask ?? null,
      lastCompletedM1: state.lastCompletedM1Ts,
      lastCompletedM5: state.lastCompletedM5Ts,
      lastCompletedM15: state.lastCompletedM15Ts,
      heartbeatAt: now,
      reconnectAttempts: state.reconnectAttempts,
      collectorVersion: MICRO_COLLECTOR_VERSION,
      permissionScope: "SCOPE_VIEW",
      mutationSurface: "NONE",
      updatedAt: now
    };
    // LIVE_CONNECTED only when session says so AND oauth healthy.
    if (
      status.connectionState === "LIVE_CONNECTED" &&
      (oauth?.status === "TOKEN_REFRESH_FAILED" ||
        oauth?.status === "TOKEN_REFRESH_PERSIST_FAILED" ||
        oauth?.permissionScope !== "SCOPE_VIEW")
    ) {
      status.connectionState = "LIVE_NOT_CONNECTED";
    }
    await this.statusStore.save(status);
    await this.store.saveCollectorHeartbeat(now, {
      connectionState: status.connectionState,
      symbolId: status.symbolId
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.running = false;
    if (this.barTimer) clearInterval(this.barTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.barTimer = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    if (this.session) {
      await this.session.disconnect();
      this.session = null;
    }
    await this.persistNotConnected("stopped");
    if (this.healthServer) {
      await new Promise<void>((resolve) => this.healthServer!.close(() => resolve()));
      this.healthServer = null;
    }
    await this.refreshHealth();
  }

  async buildHealth(): Promise<LiveCollectorHealthPayload> {
    const state = this.session ? await this.session.getState() : null;
    const persistent = await this.statusStore.get();
    const vaultUid =
      this.opts.vaultUid ?? (process.env.MICRO_COLLECTOR_VAULT_UID ?? "").trim();
    const vaultStatus = vaultUid
      ? await getMicroTokenVault().getPublicStatus(vaultUid)
      : null;
    const m1 = await this.store.countBars("M1");
    const m5 = await this.store.countBars("M5");
    const m15 = await this.store.countBars("M15");
    const quoteSampleCount = await this.store.countQuotes();
    const boundaryQuoteCount = await this.store.countBoundaryQuotes();
    const boundaries = await this.store.listBoundaryQuotes(50_000);
    const labelReady = computeLabelReadyDiagnostics(boundaries);
    const cpM1 = await this.store.getCheckpoint("M1");
    const cpM5 = await this.store.getCheckpoint("M5");
    const cpM15 = await this.store.getCheckpoint("M15");
    const cpBq = await this.store.getBoundaryCheckpoint();

    const connectionState =
      persistent?.connectionState ?? state?.connectionState ?? "LIVE_NOT_CONNECTED";
    const serviceHealthy = connectionState === "LIVE_CONNECTED";
    const quoteTs =
      persistent?.lastQuoteBrokerTimestamp ?? state?.lastQuoteTs ?? null;
    const quoteAgeMs = quoteTs ? this.nowMs() - Date.parse(quoteTs) : null;

    return {
      serviceHealthy,
      connectionState,
      oauthStatus: vaultStatus?.status ?? persistent?.oauthStatus ?? "AWAITING_USER_AUTHORIZATION",
      accountAuthorized:
        persistent?.accountAuthorized ?? state?.configuredAccountAuthorized ?? null,
      environment:
        persistent?.environment ??
        state?.symbol?.environment ??
        vaultStatus?.environment ??
        null,
      symbolResolved: Boolean(persistent?.symbolId ?? state?.symbol),
      spotSubscribed: Boolean(persistent?.spotSubscribed ?? state?.spotSubscribed),
      lastSpotEventAt: persistent?.lastSpotEventAt ?? state?.lastSpotEventAt ?? null,
      lastValidQuoteAt: quoteTs,
      quoteAgeMs,
      lastCompletedM1: persistent?.lastCompletedM1 ?? state?.lastCompletedM1Ts ?? null,
      lastCompletedM5: persistent?.lastCompletedM5 ?? state?.lastCompletedM5Ts ?? null,
      lastCompletedM15:
        persistent?.lastCompletedM15 ?? state?.lastCompletedM15Ts ?? null,
      lastHeartbeat: persistent?.heartbeatAt ?? state?.collectorHeartbeatAt ?? null,
      reconnectAttempts:
        persistent?.reconnectAttempts ?? state?.reconnectAttempts ?? 0,
      barObservationCounts: { M1: m1, M5: m5, M15: m15 },
      quoteSampleCount,
      boundaryQuoteCount,
      labelReadyMinutes: labelReady.labelReadyMinutes,
      historicalBackfillState: {
        M1: cpM1?.status ?? "IDLE",
        M5: cpM5?.status ?? "IDLE",
        M15: cpM15?.status ?? "IDLE",
        BOUNDARY_QUOTES: cpBq?.status ?? "IDLE"
      },
      mutationSurface: "NONE",
      shadowOnly: true,
      brokerExecutionEnabled: false,
      modelStatus: "DATA COLLECTION / NOT TRAINED ON REAL DATA",
      storageMode: resolveMicroStorageMode()
    };
  }

  async refreshHealth(): Promise<LiveCollectorHealthPayload> {
    this.lastHealth = await this.buildHealth();
    return this.lastHealth;
  }

  getLastHealth(): LiveCollectorHealthPayload | null {
    return this.lastHealth;
  }

  private async listenHealth(port: number): Promise<void> {
    this.healthServer = http.createServer((_req, res) => {
      void (async () => {
        try {
          const health = await this.refreshHealth();
          const body = JSON.stringify(health);
          res.writeHead(health.serviceHealthy ? 200 : 503, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          });
          res.end(body);
        } catch {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ serviceHealthy: false, mutationSurface: "NONE" })
          );
        }
      })();
    });
    await new Promise<void>((resolve, reject) => {
      this.healthServer!.listen(port, "0.0.0.0", () => resolve());
      this.healthServer!.on("error", reject);
    });
    microLog("MICRO_COLLECTOR_HEALTH_LISTEN", { port });
  }
}

export async function runMicroLiveCollectorWorkerMain(): Promise<void> {
  // Cloud Run injects PORT; MICRO_COLLECTOR_HEALTH_PORT remains for local/dev.
  const port = Number(
    process.env.PORT ?? process.env.MICRO_COLLECTOR_HEALTH_PORT ?? 8080
  );
  const vaultUid = (process.env.MICRO_COLLECTOR_VAULT_UID ?? "").trim() || undefined;
  const worker = new MicroLiveCollectorWorker({
    healthPort: port,
    vaultUid
  });

  const shutdown = async (signal: string) => {
    microLog("MICRO_COLLECTOR_SHUTDOWN", { signal });
    await worker.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await worker.start();
  microLog("MICRO_COLLECTOR_STARTED", {
    healthPort: port,
    mutationSurface: "NONE",
    deployed: isDeployedMicroRuntime(),
    storageMode: resolveMicroStorageMode(),
    quoteSampleIntervalMs: MICRO_QUOTE_SAMPLE_INTERVAL_MS
  });
}
