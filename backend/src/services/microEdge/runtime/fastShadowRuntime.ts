/**
 * Dedicated GOLD_HUNTER FAST live-shadow runtime.
 *
 * Design (separate from Core + normal Micro collector):
 * - Own Cloud Run service / process (Dockerfile.gold-hunter-fast-shadow)
 * - Own persistent Spotware WS: spots + depth for XAUUSD
 * - Own ordered FAST engine queue + GCS durable sink
 * - Does NOT share process with Core AutoTrade or quote-worker
 * - SCOPE_VIEW only; MICRO_BROKER_EXECUTION_ENABLED=false
 * - ShadowExecutionAdapter only; mutationSurface=NONE
 * - Frozen soak config (no threshold retuning)
 *
 * This module intentionally has ZERO imports from Core broker/order paths.
 */
import http from "node:http";
import { join } from "node:path";
import {
  MICRO_BROKER_EXECUTION_ENABLED,
  MICRO_SHADOW_ONLY
} from "../config";
import type { MicroCTraderCredentials } from "../marketData/microCTraderAuth";
import { MicroLiveMarketSession } from "../marketData/liveSession";
import {
  createMicroMarketDataStore,
  MemoryMicroMarketDataStore,
  type MicroMarketDataStore
} from "../marketData/marketDataStore";
import { microLog } from "../marketData/microLog";
import {
  credentialsFromVault,
  refreshVaultTokensIfNeeded
} from "../marketData/oauthService";
import { createMicroTokenVault } from "../marketData/tokenVault";
import { isDeployedMicroRuntime } from "../marketData/storageMode";
import {
  GoldHunterFastLiveBridge,
  getFrozenGhFastIdentity,
  computeSetupStats,
  computeActivityStats,
  categorizeTrades,
  groupTradesBySession,
  verifyReplayParityFromLocalChunks,
  type GhFastRuntimeHealth
} from "../goldHunter/fast";

export type FastShadowRuntimeOptions = {
  store?: MicroMarketDataStore;
  credentials?: MicroCTraderCredentials;
  vaultUid?: string;
  healthPort?: number;
  allowLocalInjectedCredentials?: boolean;
  collectDir?: string;
  nowMs?: () => number;
  replayVerifyEveryMs?: number;
};

export type FastShadowSoakHealth = {
  service: "gold-hunter-fast-shadow";
  serviceHealthy: boolean;
  soakLabel: string;
  engineVersion: string;
  configSha256: string;
  tuningAllowed: false;
  shadowOnly: true;
  brokerExecutionEnabled: false;
  mutationSurface: "NONE";
  permissionScope: "SCOPE_VIEW";
  environment: string | null;
  spotSubscribed: boolean;
  depthSubscribed: boolean;
  fast: GhFastRuntimeHealth | null;
  rejections: Record<string, number>;
  setupDetections: Record<string, number>;
  setupStats: ReturnType<typeof computeSetupStats>[];
  activity: ReturnType<typeof computeActivityStats> | null;
  sessionTradeCounts: Record<string, number>;
  winLossCategories: ReturnType<typeof categorizeTrades> | null;
  replayParity: {
    code: string;
    ok: boolean;
    comparedEvents: number;
    firstDivergence: unknown;
  } | null;
  targetCompletedTrades: number;
  completedShadowTrades: number;
  brokerRequests: 0;
  brokerOrders: 0;
};

export class GoldHunterFastShadowRuntime {
  readonly mutationSurface = "NONE" as const;
  private session: MicroLiveMarketSession | null = null;
  private bridge: GoldHunterFastLiveBridge | null = null;
  private readonly store: MicroMarketDataStore;
  private readonly frozen = getFrozenGhFastIdentity();
  private readonly nowMs: () => number;
  private readonly collectDir: string;
  private running = false;
  private stopping = false;
  private healthServer: http.Server | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private replayTimer: ReturnType<typeof setInterval> | null = null;
  private startedAtMs = 0;
  private lastReplay: FastShadowSoakHealth["replayParity"] = null;
  private readonly replayEveryMs: number;

  constructor(private readonly opts: FastShadowRuntimeOptions = {}) {
    // Prefer isolated memory market store for FAST so we do not contend with
    // the main Micro collector Firestore write path unless explicitly shared.
    this.store =
      opts.store ??
      (isDeployedMicroRuntime()
        ? createMicroMarketDataStore()
        : new MemoryMicroMarketDataStore());
    this.nowMs = opts.nowMs ?? (() => Date.now());
    this.collectDir =
      opts.collectDir ??
      join(process.cwd(), ".gold-hunter-data", "fast-soak", this.frozen.configSha256.slice(0, 12));
    this.replayEveryMs = opts.replayVerifyEveryMs ?? 15 * 60_000;
    void createMicroTokenVault();
  }

  getBridge(): GoldHunterFastLiveBridge | null {
    return this.bridge;
  }

  async start(): Promise<void> {
    if (MICRO_BROKER_EXECUTION_ENABLED !== false) {
      throw new Error("FAST_SHADOW_REFUSING_EXECUTION_FLAG");
    }
    if (!MICRO_SHADOW_ONLY) {
      throw new Error("FAST_SHADOW_REFUSING_NON_SHADOW");
    }
    if (this.frozen.tuningAllowed !== false) {
      throw new Error("FAST_SHADOW_REFUSING_TUNING");
    }
    process.env.GOLD_HUNTER_FAST_SHADOW_ENABLED = "true";
    this.running = true;
    this.stopping = false;
    this.startedAtMs = this.nowMs();
    await this.connectOnce();
    this.startReplayLoop();
    if (this.opts.healthPort != null) {
      await this.listenHealth(this.opts.healthPort);
    }
    microLog("MICRO_COLLECTOR_STARTED", {
      service: "gold-hunter-fast-shadow",
      engineVersion: this.frozen.engineVersion,
      configSha256: this.frozen.configSha256,
      mutationSurface: "NONE",
      soak: true
    });
  }

  private async resolveCredentials(): Promise<MicroCTraderCredentials | null> {
    if (this.opts.credentials && this.opts.allowLocalInjectedCredentials) {
      return this.opts.credentials;
    }
    const vaultUid =
      this.opts.vaultUid ?? (process.env.MICRO_COLLECTOR_VAULT_UID ?? "").trim();
    if (!vaultUid) return null;
    await refreshVaultTokensIfNeeded(vaultUid);
    return credentialsFromVault(vaultUid);
  }

  private async connectOnce(): Promise<void> {
    const creds = await this.resolveCredentials();
    if (!creds) {
      microLog("MICRO_COLLECTOR_OAUTH_MISSING", { service: "fast-shadow" });
      return;
    }
    this.session = new MicroLiveMarketSession({
      store: this.store,
      credentials: creds,
      nowMs: this.nowMs
    });
    try {
      await this.session.connect();
      this.bridge = new GoldHunterFastLiveBridge({
        enabled: true,
        enableCollector: true,
        collectDir: this.collectDir,
        useFrozenSoakConfig: true
      });
      this.bridge.attach(this.session);
      await this.bridge.refreshSessionFlags(this.session);
      microLog("MICRO_COLLECTOR_CONNECTED", {
        service: "gold-hunter-fast-shadow",
        environment: creds.environment,
        configSha256: this.frozen.configSha256
      });
    } catch (e) {
      this.bridge?.detach();
      this.bridge?.markStale();
      microLog("MICRO_COLLECTOR_CONNECT_FAILED", {
        service: "fast-shadow",
        code: (e as { code?: string }).code ?? "transport_disconnected"
      });
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopping || !this.running || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, 2000);
  }

  private async reconnect(): Promise<void> {
    this.bridge?.detach();
    this.bridge?.markStale();
    if (!this.session) {
      await this.connectOnce();
      return;
    }
    const ok = await this.session.boundedReconnect();
    if (ok) {
      if (!this.bridge) {
        this.bridge = new GoldHunterFastLiveBridge({
          enabled: true,
          enableCollector: true,
          collectDir: this.collectDir,
          useFrozenSoakConfig: true
        });
      }
      this.bridge.attach(this.session);
      await this.bridge.refreshSessionFlags(this.session);
    } else {
      this.scheduleReconnect();
    }
  }

  private startReplayLoop(): void {
    this.replayTimer = setInterval(() => {
      void this.runReplayCheck();
    }, this.replayEveryMs);
  }

  async runReplayCheck(): Promise<void> {
    try {
      const result = await verifyReplayParityFromLocalChunks({
        chunkDir: this.collectDir,
        maxEvents: 20_000
      });
      this.lastReplay = {
        code: result.code,
        ok: result.ok,
        comparedEvents: result.comparedEvents,
        firstDivergence: result.firstDivergence
      };
      if (!result.ok && result.code === "LIVE_REPLAY_DIVERGENCE") {
        microLog("MICRO_COLLECTOR_BAR_POLL_FAILED", {
          code: "LIVE_REPLAY_DIVERGENCE",
          firstDivergence: result.firstDivergence
        });
      }
    } catch (e) {
      this.lastReplay = {
        code: "LIVE_REPLAY_DIVERGENCE",
        ok: false,
        comparedEvents: 0,
        firstDivergence: {
          seq: -1,
          field: "exception",
          live: null,
          replay: e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120)
        }
      };
    }
  }

  async buildHealth(): Promise<FastShadowSoakHealth> {
    const state = this.session ? await this.session.getState() : null;
    const fast = this.bridge?.health() ?? null;
    if (this.bridge && this.session) {
      await this.bridge.refreshSessionFlags(this.session);
    }
    const engine = this.bridge?.engine;
    const runtimeMs = Math.max(1, this.nowMs() - this.startedAtMs);
    const closed = engine?.closed ?? [];
    const detections = engine?.setupDetections ?? {
      A_MOMENTUM_IGNITION: 0,
      B_FAST_BREAKOUT: 0,
      C_PULLBACK_REACCEL: 0
    };
    const entriesBySetup = {
      A_MOMENTUM_IGNITION: closed.filter((t) => t.setup === "A_MOMENTUM_IGNITION").length,
      B_FAST_BREAKOUT: closed.filter((t) => t.setup === "B_FAST_BREAKOUT").length,
      C_PULLBACK_REACCEL: closed.filter((t) => t.setup === "C_PULLBACK_REACCEL").length
    };
    // Prefer entryTimestamps for entries; detections from engine counter
    const setupStats = (
      ["A_MOMENTUM_IGNITION", "B_FAST_BREAKOUT", "C_PULLBACK_REACCEL", "ALL"] as const
    ).map((s) =>
      computeSetupStats(
        s,
        closed,
        s === "ALL"
          ? detections.A_MOMENTUM_IGNITION +
              detections.B_FAST_BREAKOUT +
              detections.C_PULLBACK_REACCEL
          : detections[s],
        s === "ALL"
          ? engine?.entryTimestampsMs.length ?? 0
          : entriesBySetup[s]
      )
    );
    const activity = engine
      ? computeActivityStats({
          marketEvents: fast?.eventsReceived ?? 0,
          decisions: engine.decisions.length,
          signals:
            detections.A_MOMENTUM_IGNITION +
            detections.B_FAST_BREAKOUT +
            detections.C_PULLBACK_REACCEL,
          entryTimestampsMs: engine.entryTimestampsMs,
          completedTrades: closed.length,
          runtimeMs
        })
      : null;
    const bySession = groupTradesBySession(closed);
    const sessionTradeCounts: Record<string, number> = {};
    for (const [k, v] of Object.entries(bySession)) {
      sessionTradeCounts[k] = v.length;
    }

    const healthy =
      Boolean(state?.liveConnected) &&
      Boolean(fast?.fastAttached) &&
      Boolean(state?.depthSubscribed) &&
      (this.lastReplay?.code !== "LIVE_REPLAY_DIVERGENCE");

    return {
      service: "gold-hunter-fast-shadow",
      serviceHealthy: healthy,
      soakLabel: this.frozen.soakLabel,
      engineVersion: this.frozen.engineVersion,
      configSha256: this.frozen.configSha256,
      tuningAllowed: false,
      shadowOnly: true,
      brokerExecutionEnabled: false,
      mutationSurface: "NONE",
      permissionScope: "SCOPE_VIEW",
      environment: state?.symbol?.environment ?? null,
      spotSubscribed: Boolean(state?.spotSubscribed),
      depthSubscribed: Boolean(state?.depthSubscribed),
      fast,
      rejections: engine?.rejections.snapshot() ?? {},
      setupDetections: { ...detections },
      setupStats,
      activity,
      sessionTradeCounts,
      winLossCategories: closed.length ? categorizeTrades(closed) : null,
      replayParity: this.lastReplay,
      targetCompletedTrades: Number(
        process.env.GOLD_HUNTER_FAST_SOAK_TARGET_TRADES ?? 250
      ),
      completedShadowTrades: closed.length,
      brokerRequests: 0,
      brokerOrders: 0
    };
  }

  private async listenHealth(port: number): Promise<void> {
    this.healthServer = http.createServer((_req, res) => {
      void (async () => {
        try {
          const health = await this.buildHealth();
          res.writeHead(health.serviceHealthy ? 200 : 503, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          });
          res.end(JSON.stringify(health));
        } catch {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              serviceHealthy: false,
              mutationSurface: "NONE",
              brokerOrders: 0
            })
          );
        }
      })();
    });
    await new Promise<void>((resolve, reject) => {
      this.healthServer!.listen(port, "0.0.0.0", () => resolve());
      this.healthServer!.on("error", reject);
    });
    microLog("MICRO_COLLECTOR_HEALTH_LISTEN", {
      port,
      service: "gold-hunter-fast-shadow"
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.running = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.replayTimer) clearInterval(this.replayTimer);
    this.bridge?.detach();
    this.bridge?.markStale();
    try {
      await this.bridge?.drainForTests();
    } catch {
      /* best-effort flush on shutdown */
    }
    if (this.session) await this.session.disconnect();
    this.session = null;
    if (this.healthServer) {
      await new Promise<void>((resolve) => this.healthServer!.close(() => resolve()));
      this.healthServer = null;
    }
  }
}

export async function runGoldHunterFastShadowRuntimeMain(): Promise<void> {
  const port = Number(
    process.env.PORT ?? process.env.GOLD_HUNTER_FAST_HEALTH_PORT ?? 8080
  );
  const vaultUid = (process.env.MICRO_COLLECTOR_VAULT_UID ?? "").trim() || undefined;
  const runtime = new GoldHunterFastShadowRuntime({
    healthPort: port,
    vaultUid
  });
  const shutdown = async (signal: string) => {
    microLog("MICRO_COLLECTOR_SHUTDOWN", {
      signal,
      service: "gold-hunter-fast-shadow"
    });
    await runtime.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  await runtime.start();
}
