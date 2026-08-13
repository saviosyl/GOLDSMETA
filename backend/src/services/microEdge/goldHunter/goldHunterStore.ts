/**
 * Operational GOLD_HUNTER store — recent live state, forecasts, shadow trades,
 * daily summaries, model metadata. Large datasets live in compactStorage.
 */
import type {
  GhDailySummary,
  GhForecast,
  GhModelArtifact,
  GhShadowTrade,
  GhDataQualityReport
} from "./types";
import type { ShadowEngineState } from "./shadowEngine";
import { createShadowEngine } from "./shadowEngine";
import { GOLD_HUNTER_STRATEGY_VERSION } from "./config";

export type GoldHunterLiveStatus = {
  huntState: ShadowEngineState["status"];
  forecast: GhForecast | null;
  openTrade: ShadowEngineState["openTrade"];
  openPnl: number | null;
  strategyVersion: string;
  modelVersion: string;
  qualificationStatus: GhModelArtifact["qualificationStatus"];
  shadowOnly: true;
  brokerExecutionEnabled: false;
  mutationSurface: "NONE";
  evaluationIntervalMs: 1000;
  brokerRequestsPerEval: 0;
  accountBalance: {
    balance: number | null;
    depositCurrency: string | null;
    available: boolean;
  };
  researchModel: boolean;
  updatedAtMs: number;
};

export class MemoryGoldHunterStore {
  private forecast: GhForecast | null = null;
  private shadow: ShadowEngineState = createShadowEngine();
  private trades: GhShadowTrade[] = [];
  private daily = new Map<string, GhDailySummary>();
  private artifact: GhModelArtifact | null = null;
  private dataQuality: GhDataQualityReport | null = null;
  private accountBalance: GoldHunterLiveStatus["accountBalance"] = {
    balance: null,
    depositCurrency: null,
    available: false
  };
  private openPnl: number | null = null;

  setForecast(f: GhForecast): void {
    this.forecast = f;
  }

  getForecast(): GhForecast | null {
    return this.forecast;
  }

  setShadowState(s: ShadowEngineState): void {
    this.shadow = s;
    // Append newly completed trades
    for (const t of s.completedTrades) {
      if (!this.trades.some((x) => x.tradeId === t.tradeId)) {
        this.trades.push(t);
      }
    }
  }

  getShadowState(): ShadowEngineState {
    return this.shadow;
  }

  setOpenPnl(v: number | null): void {
    this.openPnl = v;
  }

  listTrades(opts?: {
    date?: string;
    strategyVersion?: string;
    limit?: number;
  }): GhShadowTrade[] {
    let out = [...this.trades];
    if (opts?.strategyVersion) {
      out = out.filter((t) => t.strategyVersion === opts.strategyVersion);
    } else {
      out = out.filter((t) => t.strategyVersion === GOLD_HUNTER_STRATEGY_VERSION);
    }
    if (opts?.date) {
      out = out.filter((t) => t.date === opts.date);
    }
    out.sort((a, b) => b.entryTimestampMs - a.entryTimestampMs);
    if (opts?.limit) out = out.slice(0, opts.limit);
    return out;
  }

  upsertDaily(summary: GhDailySummary): void {
    this.daily.set(`${summary.strategyVersion}:${summary.date}`, summary);
  }

  getDaily(date: string, strategyVersion = GOLD_HUNTER_STRATEGY_VERSION): GhDailySummary | null {
    return this.daily.get(`${strategyVersion}:${date}`) ?? null;
  }

  listDailyDates(strategyVersion = GOLD_HUNTER_STRATEGY_VERSION): string[] {
    return [...this.daily.keys()]
      .filter((k) => k.startsWith(`${strategyVersion}:`))
      .map((k) => k.split(":")[1]!)
      .sort();
  }

  setArtifact(a: GhModelArtifact): void {
    this.artifact = a;
  }

  getArtifact(): GhModelArtifact | null {
    return this.artifact;
  }

  setDataQuality(r: GhDataQualityReport): void {
    this.dataQuality = r;
  }

  getDataQuality(): GhDataQualityReport | null {
    return this.dataQuality;
  }

  setAccountBalance(b: GoldHunterLiveStatus["accountBalance"]): void {
    this.accountBalance = b;
  }

  getStatus(): GoldHunterLiveStatus {
    const art = this.artifact;
    return {
      huntState: this.shadow.status,
      forecast: this.forecast,
      openTrade: this.shadow.openTrade,
      openPnl: this.openPnl,
      strategyVersion: this.shadow.strategyVersion,
      modelVersion: this.shadow.modelVersion,
      qualificationStatus: art?.qualificationStatus ?? "NOT_TRAINED",
      shadowOnly: true,
      brokerExecutionEnabled: false,
      mutationSurface: "NONE",
      evaluationIntervalMs: 1000,
      brokerRequestsPerEval: 0,
      accountBalance: this.accountBalance,
      researchModel:
        !art ||
        art.qualificationStatus === "TRAINED_RESEARCH" ||
        art.qualificationStatus === "NOT_TRAINED" ||
        art.qualificationStatus === "INSUFFICIENT_DATA",
      updatedAtMs: Date.now()
    };
  }
}

let singleton: MemoryGoldHunterStore | null = null;

export function getGoldHunterStore(): MemoryGoldHunterStore {
  if (!singleton) singleton = new MemoryGoldHunterStore();
  return singleton;
}

export function resetGoldHunterStoreForTests(): void {
  singleton = new MemoryGoldHunterStore();
}
