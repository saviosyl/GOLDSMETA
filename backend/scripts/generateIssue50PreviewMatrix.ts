/**
 * Temporary non-production Issue #50 preview matrix generator.
 * Outputs labelled fixtures for ui-review — never production defaults.
 */
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import {
  buildChartExampleIntradayFixture,
  buildIntradayPlan
} from "../src/services/decision/intradayPlan";
import type { DecisionRecord } from "../src/models/types";
import type { MarketStructureMode } from "../src/services/decision/strategySignal";

function dec(over: Partial<DecisionRecord> & { atr?: number | null } = {}): DecisionRecord {
  const { atr, ...rest } = over;
  const base = {
    decisionId: "preview_dec",
    userId: "preview",
    decision: "WAIT",
    lastKnownPrice: 4040,
    ohlcv: { open: 4036, high: 4048, low: 4032, close: 4040, volume: 10 },
    currentSession: "LONDON",
    dataSourceLabel: "TEST",
    isTestDecision: true,
    environment: "TEST",
    generatedAt: new Date().toISOString(),
    marketDataTime: new Date().toISOString(),
    confidence: 0.62,
    timeframe: "15",
    dataQuality: "GOOD",
    reasonCodes: ["PREVIEW_FIXTURE"],
    marketStructure: {
      trend: "RANGE",
      poc: 4045.087,
      vah: 4049.633,
      val: 4037.308,
      confirmationClassification: "NONE"
    },
    entry: { price: null },
    stopLoss: { price: null },
    takeProfits: [],
    ...rest
  } as DecisionRecord;
  if (atr === null) {
    delete (base as { atr?: number }).atr;
  } else if (typeof atr === "number") {
    (base as { atr?: number }).atr = atr;
  } else if (atr === undefined && !("atr" in rest)) {
    (base as { atr?: number }).atr = 12.5;
  }
  return base;
}

type CasePack = {
  id: string;
  title: string;
  mode: MarketStructureMode;
  quoteAgeSeconds: number | null;
  signalAgeSeconds: number | null;
  decision: DecisionRecord;
  structure: DecisionRecord | null;
  plan: ReturnType<typeof buildIntradayPlan>;
};

function buildCase(args: {
  id: string;
  title: string;
  mode: MarketStructureMode;
  quote: DecisionRecord;
  structure: DecisionRecord | null;
  quoteAgeSeconds?: number | null;
  signalAgeSeconds?: number | null;
  planPatch?: Partial<ReturnType<typeof buildIntradayPlan>>;
}): CasePack {
  const plan = {
    ...buildIntradayPlan({
      mode: args.mode,
      quote: args.quote,
      structure: args.structure,
      quoteAgeSeconds: args.quoteAgeSeconds ?? 20,
      signalAgeSeconds: args.signalAgeSeconds ?? 90
    }),
    ...args.planPatch
  };
  plan.oneSentence = `${plan.oneSentence} (LABELLED PREVIEW — ${args.id})`;
  plan.freshness = {
    ...plan.freshness,
    sourceLabel: plan.freshness.sourceLabel.includes("TEST")
      ? plan.freshness.sourceLabel
      : "TEST_PREVIEW"
  };
  plan.disclaimer = `${plan.disclaimer} Preview fixture ${args.id} — not live market data.`;
  return {
    id: args.id,
    title: args.title,
    mode: args.mode,
    quoteAgeSeconds: args.quoteAgeSeconds ?? 20,
    signalAgeSeconds: args.signalAgeSeconds ?? 90,
    decision: args.quote,
    structure: args.structure,
    plan
  };
}

const structureBase = {
  poc: 4045.087,
  vah: 4049.633,
  val: 4037.308
};

const cases: CasePack[] = [
  (() => {
    const fixture = buildChartExampleIntradayFixture();
    return {
      id: "below-val",
      title: "Price below VAL",
      mode: "COMPLETE" as const,
      quoteAgeSeconds: 30,
      signalAgeSeconds: 120,
      decision: dec({
        lastKnownPrice: 4034.815,
        ohlcv: { open: 4036, high: 4041.2, low: 4031.1, close: 4034.815, volume: 1 },
        atr: 12.5,
        marketStructure: { ...structureBase, trend: "RANGE", confirmationClassification: "NONE" },
        stopLoss: { price: 4028.6 },
        takeProfits: [
          { label: "TP1", price: 4045.1 },
          { label: "TP2", price: 4049.8 },
          { label: "TP3", price: 4053.7 }
        ]
      }),
      structure: dec({
        lastKnownPrice: 4034.815,
        ohlcv: { open: 4036, high: 4041.2, low: 4031.1, close: 4034.815, volume: 1 },
        atr: 12.5,
        marketStructure: { ...structureBase, trend: "RANGE", confirmationClassification: "NONE" },
        stopLoss: { price: 4028.6 },
        takeProfits: [
          { label: "TP1", price: 4045.1 },
          { label: "TP2", price: 4049.8 },
          { label: "TP3", price: 4053.7 }
        ]
      }),
      plan: fixture
    };
  })(),
  buildCase({
    id: "inside-value",
    title: "Price inside VAL–VAH",
    mode: "COMPLETE",
    quote: dec({
      lastKnownPrice: 4042.5,
      ohlcv: { open: 4040, high: 4048, low: 4036, close: 4042.5, volume: 1 },
      atr: 12.5,
      marketStructure: { ...structureBase, trend: "RANGE", confirmationClassification: "NONE" }
    }),
    structure: dec({
      lastKnownPrice: 4042.5,
      ohlcv: { open: 4040, high: 4048, low: 4036, close: 4042.5, volume: 1 },
      atr: 12.5,
      marketStructure: { ...structureBase, trend: "RANGE", confirmationClassification: "NONE" }
    })
  }),
  buildCase({
    id: "above-vah",
    title: "Price above VAH",
    mode: "COMPLETE",
    quote: dec({
      lastKnownPrice: 4052.4,
      ohlcv: { open: 4050, high: 4055, low: 4048, close: 4052.4, volume: 1 },
      atr: 12.5,
      marketStructure: { ...structureBase, trend: "BULL", confirmationClassification: "NONE" }
    }),
    structure: dec({
      lastKnownPrice: 4052.4,
      ohlcv: { open: 4050, high: 4055, low: 4048, close: 4052.4, volume: 1 },
      atr: 12.5,
      marketStructure: { ...structureBase, trend: "BULL", confirmationClassification: "NONE" }
    })
  }),
  buildCase({
    id: "buy-confirmed",
    title: "Confirmed BUY plan",
    mode: "COMPLETE",
    quote: dec({
      decision: "BUY",
      lastKnownPrice: 4042,
      ohlcv: { open: 4040, high: 4048, low: 4036, close: 4042, volume: 1 },
      atr: 10,
      marketStructure: {
        trend: "BULL",
        poc: 4045,
        vah: 4050,
        val: 4038,
        confirmationClassification: "BREAKOUT"
      }
    }),
    structure: dec({
      decision: "BUY",
      lastKnownPrice: 4042,
      ohlcv: { open: 4040, high: 4048, low: 4036, close: 4042, volume: 1 },
      atr: 10,
      marketStructure: {
        trend: "BULL",
        poc: 4045,
        vah: 4050,
        val: 4038,
        confirmationClassification: "BREAKOUT"
      },
      entry: { price: 4040 },
      stopLoss: { price: 4030 },
      takeProfits: [
        { label: "TP1", price: 4050 },
        { label: "TP2", price: 4055 },
        { label: "TP3", price: 4060 }
      ],
      riskReward: { tp1: 1, tp2: 1.5, tp3: 2 }
    })
  }),
  buildCase({
    id: "sell-confirmed",
    title: "Confirmed SELL plan",
    mode: "COMPLETE",
    quote: dec({
      decision: "SELL",
      lastKnownPrice: 4042,
      ohlcv: { open: 4044, high: 4048, low: 4038, close: 4042, volume: 1 },
      atr: 10,
      marketStructure: {
        trend: "BEAR",
        poc: 4045,
        vah: 4050,
        val: 4038,
        confirmationClassification: "REJECTION"
      }
    }),
    structure: dec({
      decision: "SELL",
      lastKnownPrice: 4042,
      ohlcv: { open: 4044, high: 4048, low: 4038, close: 4042, volume: 1 },
      atr: 10,
      marketStructure: {
        trend: "BEAR",
        poc: 4045,
        vah: 4050,
        val: 4038,
        confirmationClassification: "REJECTION"
      },
      entry: { price: 4042 },
      stopLoss: { price: 4052 },
      takeProfits: [
        { label: "TP1", price: 4032 },
        { label: "TP2", price: 4026 },
        { label: "TP3", price: 4020 }
      ]
    })
  }),
  buildCase({
    id: "range-conditional",
    title: "RANGE / conditional scenarios",
    mode: "COMPLETE",
    quote: dec({
      decision: "WAIT",
      lastKnownPrice: 4043,
      ohlcv: { open: 4041, high: 4047, low: 4039, close: 4043, volume: 1 },
      atr: 11,
      marketStructure: {
        trend: "RANGE",
        poc: 4045.087,
        vah: 4049.633,
        val: 4037.308,
        confirmationClassification: "NONE"
      }
    }),
    structure: dec({
      decision: "WAIT",
      lastKnownPrice: 4043,
      ohlcv: { open: 4041, high: 4047, low: 4039, close: 4043, volume: 1 },
      atr: 11,
      marketStructure: {
        trend: "RANGE",
        poc: 4045.087,
        vah: 4049.633,
        val: 4037.308,
        confirmationClassification: "NONE"
      }
    })
  }),
  buildCase({
    id: "mismatch",
    title: "MISMATCH",
    mode: "MISMATCH",
    quote: dec({
      lastKnownPrice: 2408,
      ohlcv: { open: 2400, high: 2412, low: 2396, close: 2408, volume: 1 },
      dataQuality: "CONFLICTED",
      marketStructure: { trend: "RANGE", poc: 2408, vah: 2415, val: 2400, confirmationClassification: "NONE" }
    }),
    structure: dec({
      lastKnownPrice: 4045.17,
      ohlcv: { open: 4044, high: 4048, low: 4042, close: 4045.17, volume: 1 },
      marketStructure: {
        trend: "RANGE",
        poc: 4050.951,
        vah: 4052.975,
        val: 4047.193,
        confirmationClassification: "NONE"
      }
    })
  }),
  buildCase({
    id: "live-range-only",
    title: "LIVE_RANGE_ONLY / OHLC-only",
    mode: "LIVE_RANGE_ONLY",
    quote: dec({
      lastKnownPrice: 4034.8,
      ohlcv: { open: 4036, high: 4041.2, low: 4031.1, close: 4034.8, volume: 1 },
      marketStructure: null as unknown as DecisionRecord["marketStructure"]
    }),
    structure: null
  }),
  buildCase({
    id: "missing-atr",
    title: "Missing ATR",
    mode: "COMPLETE",
    quote: dec({
      atr: null,
      lastKnownPrice: 4034.815,
      ohlcv: { open: 4036, high: 4041.2, low: 4031.1, close: 4034.815, volume: 1 },
      marketStructure: { ...structureBase, trend: "RANGE", confirmationClassification: "NONE" }
    }),
    structure: dec({
      atr: null,
      lastKnownPrice: 4034.815,
      ohlcv: { open: 4036, high: 4041.2, low: 4031.1, close: 4034.815, volume: 1 },
      marketStructure: { ...structureBase, trend: "RANGE", confirmationClassification: "NONE" }
    })
  }),
  buildCase({
    id: "missing-structure",
    title: "Missing POC, VAH or VAL",
    mode: "COMPLETE",
    quote: dec({
      lastKnownPrice: 4034.815,
      ohlcv: { open: 4036, high: 4041.2, low: 4031.1, close: 4034.815, volume: 1 },
      atr: 12.5,
      marketStructure: {
        trend: "RANGE",
        poc: null,
        vah: null,
        val: null,
        confirmationClassification: "NONE"
      } as unknown as DecisionRecord["marketStructure"]
    }),
    structure: dec({
      lastKnownPrice: 4034.815,
      ohlcv: { open: 4036, high: 4041.2, low: 4031.1, close: 4034.815, volume: 1 },
      atr: 12.5,
      marketStructure: {
        trend: "RANGE",
        poc: null,
        vah: null,
        val: null,
        confirmationClassification: "NONE"
      } as unknown as DecisionRecord["marketStructure"]
    })
  }),
  buildCase({
    id: "stale-signal-fresh-quote",
    title: "Stale strategy signal with a fresh quote",
    mode: "COMPLETE",
    quoteAgeSeconds: 15,
    signalAgeSeconds: 3600,
    quote: dec({
      lastKnownPrice: 4036.2,
      ohlcv: { open: 4035, high: 4040, low: 4030, close: 4036.2, volume: 1 },
      atr: 12.5,
      marketDataTime: new Date().toISOString(),
      generatedAt: new Date(Date.now() - 3600_000).toISOString(),
      marketStructure: { ...structureBase, trend: "RANGE", confirmationClassification: "NONE" }
    }),
    structure: dec({
      lastKnownPrice: 4034.8,
      ohlcv: { open: 4036, high: 4041.2, low: 4031.1, close: 4034.8, volume: 1 },
      atr: 12.5,
      generatedAt: new Date(Date.now() - 3600_000).toISOString(),
      marketStructure: { ...structureBase, trend: "RANGE", confirmationClassification: "NONE" },
      stopLoss: { price: 4028.6 },
      takeProfits: [
        { label: "TP1", price: 4045.1 },
        { label: "TP2", price: 4049.8 }
      ]
    })
  })
];

const outDir = resolve(__dirname, "../../web/src/fixtures");
mkdirSync(outDir, { recursive: true });

const slim = cases.map((c) => ({
  id: c.id,
  title: c.title,
  mode: c.mode,
  quoteAgeSeconds: c.quoteAgeSeconds,
  signalAgeSeconds: c.signalAgeSeconds,
  livePrice: c.decision.lastKnownPrice,
  decisionCode: c.decision.decision,
  plan: c.plan,
  decision: {
    lastKnownPrice: c.decision.lastKnownPrice,
    ohlcv: c.decision.ohlcv,
    marketStructure: c.decision.marketStructure,
    decision: c.decision.decision,
    dataQuality: c.decision.dataQuality,
    dataSourceLabel: c.decision.dataSourceLabel,
    isTestDecision: c.decision.isTestDecision,
    generatedAt: c.decision.generatedAt,
    marketDataTime: c.decision.marketDataTime,
    currentSession: c.decision.currentSession
  }
}));

const ts = `import type { IntradayPlan } from "../types/intradayPlan";

/** Labelled Issue #50 preview matrix — non-production ui-review only. */
export type Issue50PreviewCase = {
  id: string;
  title: string;
  mode: "COMPLETE" | "LIVE_RANGE_ONLY" | "MISMATCH" | "UNAVAILABLE";
  quoteAgeSeconds: number | null;
  signalAgeSeconds: number | null;
  livePrice: number | null | undefined;
  decisionCode: string;
  plan: IntradayPlan;
  decision: {
    lastKnownPrice: number | null | undefined;
    ohlcv: { open: number; high: number; low: number; close: number; volume: number } | null | undefined;
    marketStructure: Record<string, unknown> | null | undefined;
    decision: string;
    dataQuality: string | null | undefined;
    dataSourceLabel: string | null | undefined;
    isTestDecision: boolean | null | undefined;
    generatedAt: string | null | undefined;
    marketDataTime: string | null | undefined;
    currentSession: string | null | undefined;
  };
};

export const issue50PreviewCases: Issue50PreviewCase[] = ${JSON.stringify(slim, null, 2)} as Issue50PreviewCase[];

export function getIssue50PreviewCase(id: string): Issue50PreviewCase | undefined {
  return issue50PreviewCases.find((c) => c.id === id);
}
`;

writeFileSync(resolve(outDir, "issue50PreviewMatrix.ts"), ts);

// Also write JSON report seed for validation script
const reportSeed = cases.map((c) => ({
  id: c.id,
  title: c.title,
  mode: c.mode,
  action: c.plan.action,
  actionLabel: c.plan.actionLabel,
  valueLocation: c.plan.valueLocation,
  triggerPrice: c.plan.triggerPrice,
  nextTargetPrice: c.plan.nextTargetPrice,
  bull: {
    trigger: c.plan.bullishScenario.triggerPrice,
    t1: c.plan.bullishScenario.firstTargetPrice,
    t2: c.plan.bullishScenario.secondTargetPrice,
    firstTarget: c.plan.bullishScenario.firstTarget
  },
  bear: {
    trigger: c.plan.bearishScenario.triggerPrice,
    t1: c.plan.bearishScenario.firstTargetPrice,
    t2: c.plan.bearishScenario.secondTargetPrice,
    firstTarget: c.plan.bearishScenario.firstTarget
  },
  range: c.plan.expectedRange,
  tradePlanKind: c.plan.tradePlan.cardKind,
  tradePlanDirection: c.plan.tradePlan.direction,
  autoTrade: c.plan.safety.autoTrade,
  quoteAgeSeconds: c.quoteAgeSeconds,
  signalAgeSeconds: c.signalAgeSeconds,
  plan: {
    importantLevels: c.plan.importantLevels.map((l) => ({
      id: l.id,
      price: l.price,
      roleAtCurrentPrice: l.roleAtCurrentPrice,
      proximity: l.proximity
    })),
    bullishScenario: c.plan.bullishScenario,
    bearishScenario: c.plan.bearishScenario,
    whyNotReady: c.plan.whyNotReady,
    freshness: c.plan.freshness
  }
}));
mkdirSync(resolve(__dirname, "../../web/scripts"), { recursive: true });
writeFileSync(
  resolve(__dirname, "../../web/scripts/tmp/issue50-preview-seed.json"),
  JSON.stringify(reportSeed, null, 2)
);

console.log(`Generated ${cases.length} preview cases`);
for (const c of reportSeed) {
  console.log(
    `- ${c.id}: ${c.action} loc=${c.valueLocation} bull ${c.bull.trigger}->${c.bull.t1} bear ${c.bear.trigger}->${c.bear.t1}`
  );
}
