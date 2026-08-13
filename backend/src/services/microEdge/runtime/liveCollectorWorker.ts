/**
 * Dedicated Micro Edge live market-data collector process.
 *
 * DO NOT run the persistent cTrader socket inside a normal API request.
 * This worker is designed for an isolated persistent service (e.g. Cloud Run).
 *
 * NOT DEPLOYED by this PR — readiness + health only.
 *
 * Responsibilities:
 * - load Micro token (vault / env)
 * - refresh if needed
 * - connect → app auth → account-list → account auth
 * - resolve XAUUSD
 * - subscribe spots once
 * - sample quotes, poll completed bars
 * - reconnect fail-closed
 *
 * mutationSurface = NONE always.
 */
import http from "node:http";
import {
  MICRO_BROKER_EXECUTION_ENABLED,
  MICRO_QUOTE_SAMPLE_INTERVAL_MS,
  MICRO_SHADOW_ONLY
} from "../config";
import {
  loadMicroCTraderCredentials,
  type MicroCTraderCredentials
} from "../marketData/microCTraderAuth";
import { MicroLiveMarketSession } from "../marketData/liveSession";
import {
  MemoryMicroMarketDataStore,
  type MicroMarketDataStore
} from "../marketData/marketDataStore";
import { computeLabelReadyDiagnostics } from "../marketData/historicalTicks";
import { microLog } from "../marketData/microLog";
import {
  credentialsFromVault,
  refreshVaultTokensIfNeeded
} from "../marketData/oauthService";
import { getMicroTokenVault } from "../marketData/tokenVault";

export type LiveCollectorWorkerOptions = {
  store?: MicroMarketDataStore;
  credentials?: MicroCTraderCredentials;
  /** When set, load/refresh tokens from Micro vault for this uid. */
  vaultUid?: string;
  healthPort?: number;
  quoteSampleIntervalMs?: number;
  barPollIntervalMs?: number;
  nowMs?: () => number;
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
};

export class MicroLiveCollectorWorker {
  readonly mutationSurface = "NONE" as const;
  private session: MicroLiveMarketSession | null = null;
  private readonly store: MicroMarketDataStore;
  private running = false;
  private stopping = false;
  private healthServer: http.Server | null = null;
  private barTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHealth: LiveCollectorHealthPayload | null = null;
  private readonly nowMs: () => number;

  constructor(private readonly opts: LiveCollectorWorkerOptions = {}) {
    this.store = opts.store ?? new MemoryMicroMarketDataStore();
    this.nowMs = opts.nowMs ?? (() => Date.now());
  }

  getSession(): MicroLiveMarketSession | null {
    return this.session;
  }

  async resolveCredentials(): Promise<MicroCTraderCredentials | null> {
    if (this.opts.credentials) return this.opts.credentials;
    if (this.opts.vaultUid) {
      await refreshVaultTokensIfNeeded(this.opts.vaultUid);
      return credentialsFromVault(this.opts.vaultUid);
    }
    const loaded = loadMicroCTraderCredentials();
    return loaded.ok ? loaded.credentials : null;
  }

  async start(): Promise<void> {
    if (MICRO_BROKER_EXECUTION_ENABLED !== false) {
      throw new Error("MICRO_COLLECTOR_REFUSING_EXECUTION_FLAG");
    }
    if (!MICRO_SHADOW_ONLY) {
      throw new Error("MICRO_COLLECTOR_REFUSING_NON_SHADOW");
    }
    this.running = true;
    this.stopping = false;
    await this.connectLoop();
    this.startBarPolling();
    if (this.opts.healthPort != null) {
      await this.listenHealth(this.opts.healthPort);
    }
  }

  private async connectLoop(): Promise<void> {
    const creds = await this.resolveCredentials();
    if (!creds) {
      microLog("MICRO_COLLECTOR_OAUTH_MISSING", {});
      await this.refreshHealth();
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
    } catch (e) {
      microLog("MICRO_COLLECTOR_CONNECT_FAILED", {
        code: (e as { code?: string }).code ?? "transport_disconnected"
      });
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

  private async pollBarsOnce(): Promise<void> {
    if (!this.session || this.stopping) return;
    try {
      if (!this.session.isLiveConnected()) {
        // Still try poll if socket up — getState is authoritative for health.
      }
      await this.session.pollCompletedBars("M1", 5);
      await this.session.pollCompletedBars("M5", 3);
      await this.session.pollCompletedBars("M15", 2);
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
    if (!this.session) return;
    // Immediately mark not connected before retry.
    await this.refreshHealth();
    const ok = await this.session.boundedReconnect();
    if (!ok) {
      microLog("MICRO_COLLECTOR_RECONNECT_EXHAUSTED", {});
    }
    await this.refreshHealth();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.running = false;
    if (this.barTimer) clearInterval(this.barTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.barTimer = null;
    this.reconnectTimer = null;
    if (this.session) {
      await this.session.disconnect();
      this.session = null;
    }
    if (this.healthServer) {
      await new Promise<void>((resolve) => this.healthServer!.close(() => resolve()));
      this.healthServer = null;
    }
    await this.refreshHealth();
  }

  async buildHealth(): Promise<LiveCollectorHealthPayload> {
    const state = this.session ? await this.session.getState() : null;
    const vaultStatus = this.opts.vaultUid
      ? await getMicroTokenVault().getPublicStatus(this.opts.vaultUid)
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

    const serviceHealthy = Boolean(state?.liveConnected);

    return {
      serviceHealthy,
      connectionState: state?.connectionState ?? "LIVE_NOT_CONNECTED",
      oauthStatus: vaultStatus?.status ?? (state?.credentialsConfigured ? "CONNECTED" : "AWAITING_USER_AUTHORIZATION"),
      accountAuthorized: state?.configuredAccountAuthorized ?? null,
      environment: state?.symbol?.environment ?? vaultStatus?.environment ?? null,
      symbolResolved: Boolean(state?.symbol),
      spotSubscribed: Boolean(state?.spotSubscribed),
      lastSpotEventAt: state?.lastSpotEventAt ?? null,
      lastValidQuoteAt: state?.lastQuoteTs ?? null,
      quoteAgeMs: state?.quoteAgeMs ?? null,
      lastCompletedM1: state?.lastCompletedM1Ts ?? null,
      lastCompletedM5: state?.lastCompletedM5Ts ?? null,
      lastCompletedM15: state?.lastCompletedM15Ts ?? null,
      lastHeartbeat: state?.collectorHeartbeatAt ?? null,
      reconnectAttempts: state?.reconnectAttempts ?? 0,
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
      modelStatus: "DATA COLLECTION / NOT TRAINED ON REAL DATA"
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
    this.healthServer = http.createServer((req, res) => {
      void (async () => {
        try {
          void req;
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

/** Entrypoint helper for `tsx scripts/microEdge/runLiveCollectorWorker.ts`. */
export async function runMicroLiveCollectorWorkerMain(): Promise<void> {
  const port = Number(process.env.MICRO_COLLECTOR_HEALTH_PORT ?? 8089);
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
    deployed: false
  });
}
