/**
 * Review-only fixtures for premium Market Report PNG visual QA.
 * Never used as production defaults — labelled fixture values only.
 */

import { chartExampleIntradayPlanFixture } from "./intradayPlanFixture";
import type { IntradayPlan } from "../types/intradayPlan";
import type { BuildSnapshotInput } from "../lib/promoSnapshot";
import type { MarketReportContext } from "../lib/marketReportModel";
import { deriveTimeframeAlignment } from "../lib/planDisplay";

function synthCandles(
  mid: number,
  decision: "WAIT" | "BUY" | "SELL",
  count = 32
): Array<{ open: number; high: number; low: number; close: number }> {
  const bars = [];
  let price = mid - (decision === "BUY" ? 8 : decision === "SELL" ? -8 : 2);
  for (let i = 0; i < count; i++) {
    const drift =
      decision === "BUY" ? 0.35 : decision === "SELL" ? -0.35 : Math.sin(i / 3) * 0.4;
    const open = price;
    const close = open + drift + (Math.sin(i * 1.7) * 0.55);
    const high = Math.max(open, close) + 0.55 + (i % 3) * 0.15;
    const low = Math.min(open, close) - 0.55 - (i % 2) * 0.12;
    bars.push({ open, high, low, close });
    price = close;
  }
  return bars;
}

function contextFromPlan(
  plan: IntradayPlan,
  extras: {
    atrLabel?: string;
    positionVsPoc?: string;
    regime?: string;
    livePrice: number;
    poc: number;
    vah: number;
    val: number;
    decision: "WAIT" | "BUY" | "SELL";
    localCityLabel?: string;
    secondaryCityLabel?: string;
    localClock?: string;
    secondaryClock?: string;
  }
): MarketReportContext {
  const tf = deriveTimeframeAlignment(plan);
  const tp = plan.tradePlan;
  const entryNum =
    tp.entryZone != null && Number.isFinite(Number(tp.entryZone)) ? Number(tp.entryZone) : null;
  return {
    directionBias: plan.directionBias,
    marketType: plan.marketType,
    oneSentence: plan.oneSentence,
    whyNotReady: plan.whyNotReady,
    actionLabel: plan.actionLabel,
    nearestSupport: plan.zones.nearestSupport,
    nearestResistance: plan.zones.nearestResistance,
    setupItems: plan.setupProgress.items.map((i) => ({
      id: i.id,
      label: i.label,
      complete: i.complete,
      detail: i.detail,
      mark: i.mark
    })),
    confirmationLabel: plan.confirmation5m?.label ?? null,
    confirmationMeaningful: plan.confirmation5m?.meaningful ?? null,
    timeframes: tf.cells.map((c) => ({
      timeframe: c.timeframe,
      direction: c.direction ?? "—",
      tone: c.tone
    })),
    atrLabel: extras.atrLabel ?? "NORMAL",
    atrValue: 12.4,
    positionVsPoc: extras.positionVsPoc ?? plan.valueLocation ?? null,
    regime: extras.regime ?? plan.marketType,
    reasonCodes:
      extras.decision === "WAIT" ? ["CONFIRMATION_INCOMPLETE"] : ["VALIDATED_SETUP"],
    bullishScenario: {
      label: plan.bullishScenario.label,
      trigger: plan.bullishScenario.trigger
    },
    bearishScenario: {
      label: plan.bearishScenario.label,
      trigger: plan.bearishScenario.trigger
    },
    tradePlanActionable: tp.actionable,
    tradePlanDirection: tp.direction,
    tradePlanEntry: entryNum,
    tradePlanStop: tp.stopLoss,
    tradePlanTp1: tp.tp1,
    tradePlanTp2: tp.tp2,
    tradePlanTp3: tp.tp3,
    tradePlanRR:
      typeof tp.riskReward === "number"
        ? tp.riskReward
        : tp.riskReward && /^\d+(\.\d+)?$/.test(String(tp.riskReward))
          ? Number(tp.riskReward)
          : extras.decision === "BUY" || extras.decision === "SELL"
            ? 1.5
            : null,
    marketStatus: "OPEN",
    candles: synthCandles(extras.livePrice, extras.decision),
    chartTimeframe: "15M",
    localCityLabel: extras.localCityLabel ?? "Dublin",
    secondaryCityLabel: extras.secondaryCityLabel ?? "New York",
    localClock: extras.localClock ?? "22:01",
    secondaryClock: extras.secondaryClock ?? "17:01",
    poc: extras.poc,
    vah: extras.vah,
    val: extras.val
  };
}

const waitPlan: IntradayPlan = {
  ...structuredClone(chartExampleIntradayPlanFixture),
  oneSentence:
    "No confirmed entry yet. Price is above session POC with supportive trend, but structure confirmation is still incomplete.",
  whyNotReady: "Waiting for market structure confirmation and a valid entry trigger.",
  session: "NEW_YORK",
  directionBias: "SLIGHTLY_BULLISH",
  marketType: "RANGE",
  zones: {
    ...chartExampleIntradayPlanFixture.zones,
    valueLocation: "ABOVE_VALUE",
    nearestSupport: 4339.09,
    nearestResistance: 4343.46
  },
  bullishScenario: {
    ...chartExampleIntradayPlanFixture.bullishScenario,
    trigger: "Break / confirm above 4343.46",
    triggerPrice: 4343.46
  },
  bearishScenario: {
    ...chartExampleIntradayPlanFixture.bearishScenario,
    trigger: "Loss of support at 4339.09",
    triggerPrice: 4339.09
  },
  timeframeAlignment: {
    cells: [
      { timeframe: "1H", direction: "Bullish", label: "Main bias", tone: "buy" },
      { timeframe: "15M", direction: "Bullish", label: "Plan structure", tone: "buy" },
      { timeframe: "5M", direction: "Waiting", label: "Entry confirm", tone: "wait" }
    ],
    conclusion: "Higher timeframes lean bullish; 5M confirmation is still waiting."
  }
};

const buyPlan: IntradayPlan = {
  ...structuredClone(waitPlan),
  action: "BUY_NOW",
  actionLabel: "BUY NOW",
  oneSentence:
    "Buy plan is active with confirmation — manage risk manually; AutoTrade stays OFF.",
  whyNotReady: null,
  directionBias: "BULLISH",
  marketType: "BREAKOUT",
  session: "NEW_YORK",
  confidence: 72,
  valueLocation: "INSIDE_VALUE",
  setupProgress: {
    complete: 6,
    total: 6,
    label: "6 of 6 conditions complete",
    items: waitPlan.setupProgress.items.map((i) => ({
      ...i,
      complete: true,
      detail: i.id === "confirmation" ? "Classification BREAKOUT" : i.detail
    }))
  },
  zones: {
    ...waitPlan.zones,
    valueLocation: "INSIDE_VALUE",
    nearestSupport: 4338.2,
    nearestResistance: 4348.6
  },
  confirmation5m: {
    state: "BREAKOUT_CONFIRMED",
    label: "Breakout confirmed",
    meaningful: true,
    detail: "5M close held above the buy trigger."
  },
  timeframeAlignment: {
    cells: [
      { timeframe: "1H", direction: "Bullish", label: "Main bias", tone: "buy" },
      { timeframe: "15M", direction: "Bullish", label: "Plan structure", tone: "buy" },
      { timeframe: "5M", direction: "Confirmed", label: "Entry confirm", tone: "buy" }
    ],
    conclusion: "Higher timeframes and 5M confirmation align for a manual buy plan."
  },
  tradePlan: {
    ...waitPlan.tradePlan,
    cardKind: "ACTIVE_PLAN",
    title: "Manual trade plan",
    actionable: true,
    direction: "BUY",
    entryZone: "4341.20",
    stopLoss: 4334.5,
    tp1: 4348.6,
    tp2: 4354.0,
    tp3: 4360.2,
    riskReward: "1.10",
    orderingValid: true,
    orderingNote: null,
    bullishConditional: null,
    bearishConditional: null
  },
  bullishScenario: {
    ...waitPlan.bullishScenario,
    trigger: "Hold above 4341.20 with continuation",
    triggerPrice: 4341.2
  },
  bearishScenario: {
    ...waitPlan.bearishScenario,
    trigger: "Break and hold below 4338.20",
    triggerPrice: 4338.2
  },
  planStatus: "CONFIRMED"
};

const sellPlan: IntradayPlan = {
  ...structuredClone(waitPlan),
  action: "SELL_NOW",
  actionLabel: "SELL NOW",
  oneSentence:
    "Sell plan is active with confirmation — manage risk manually; AutoTrade stays OFF.",
  whyNotReady: null,
  directionBias: "BEARISH",
  marketType: "BREAKOUT",
  session: "LONDON",
  confidence: 70,
  valueLocation: "ABOVE_VALUE",
  setupProgress: {
    complete: 6,
    total: 6,
    label: "6 of 6 conditions complete",
    items: waitPlan.setupProgress.items.map((i) => ({
      ...i,
      complete: true,
      detail: i.id === "confirmation" ? "Classification REJECTION" : i.detail
    }))
  },
  zones: {
    ...waitPlan.zones,
    valueLocation: "ABOVE_VALUE",
    nearestSupport: 4335.4,
    nearestResistance: 4345.8
  },
  confirmation5m: {
    state: "REJECTION_CONFIRMED",
    label: "Rejection confirmed",
    meaningful: true,
    detail: "5M rejection held below resistance."
  },
  timeframeAlignment: {
    cells: [
      { timeframe: "1H", direction: "Bearish", label: "Main bias", tone: "sell" },
      { timeframe: "15M", direction: "Bearish", label: "Plan structure", tone: "sell" },
      { timeframe: "5M", direction: "Confirmed", label: "Entry confirm", tone: "sell" }
    ],
    conclusion: "Higher timeframes and 5M confirmation align for a manual sell plan."
  },
  tradePlan: {
    ...waitPlan.tradePlan,
    cardKind: "ACTIVE_PLAN",
    title: "Manual trade plan",
    actionable: true,
    direction: "SELL",
    entryZone: "4342.80",
    stopLoss: 4349.5,
    tp1: 4335.4,
    tp2: 4329.0,
    tp3: 4322.5,
    riskReward: "1.10",
    orderingValid: true,
    orderingNote: null,
    bullishConditional: null,
    bearishConditional: null
  },
  bullishScenario: {
    ...waitPlan.bullishScenario,
    trigger: "Reclaim and hold above 4345.80",
    triggerPrice: 4345.8
  },
  bearishScenario: {
    ...waitPlan.bearishScenario,
    trigger: "Hold below 4342.80 with continuation",
    triggerPrice: 4342.8
  },
  planStatus: "CONFIRMED"
};

function scoreFor(decision: "WAIT" | "BUY" | "SELL") {
  if (decision === "WAIT") {
    return {
      total: 64,
      components: [
        { label: "Trend", score: 12, max: 12, reason: "Directional context supportive." },
        { label: "Market Structure", score: 4, max: 12, reason: "Structure incomplete." },
        { label: "Volume Profile", score: 12, max: 12, reason: "Above session POC." },
        { label: "Confirmation", score: 3, max: 12, reason: "Confirmation incomplete." },
        { label: "ATR", score: 8, max: 10, reason: "Below preferred condition." },
        { label: "Session", score: 6, max: 8, reason: "Acceptable session context." }
      ]
    };
  }
  if (decision === "BUY") {
    return {
      total: 82,
      components: [
        { label: "Trend", score: 12, max: 12, reason: "Bullish bias aligned." },
        { label: "Market Structure", score: 11, max: 12, reason: "Structure confirmed." },
        { label: "Volume Profile", score: 11, max: 12, reason: "Inside value." },
        { label: "Confirmation", score: 11, max: 12, reason: "Breakout confirmed." },
        { label: "ATR", score: 9, max: 10, reason: "Normal volatility." },
        { label: "Session", score: 7, max: 8, reason: "New York session active." }
      ]
    };
  }
  return {
    total: 79,
    components: [
      { label: "Trend", score: 11, max: 12, reason: "Bearish bias aligned." },
      { label: "Market Structure", score: 11, max: 12, reason: "Structure confirmed." },
      { label: "Volume Profile", score: 10, max: 12, reason: "Above value rejection." },
      { label: "Confirmation", score: 11, max: 12, reason: "Rejection confirmed." },
      { label: "ATR", score: 9, max: 10, reason: "Normal volatility." },
      { label: "Session", score: 7, max: 8, reason: "London session active." }
    ]
  };
}

export type MarketReportReviewCase = {
  id: "WAIT" | "BUY" | "SELL";
  filename: string;
  input: BuildSnapshotInput;
};

export function buildMarketReportReviewCases(): MarketReportReviewCase[] {
  const waitPrice = 4341.52;
  const buyPrice = 4342.1;
  const sellPrice = 4341.9;

  const waitScore = scoreFor("WAIT");
  const buyScore = scoreFor("BUY");
  const sellScore = scoreFor("SELL");

  const waitCtx = contextFromPlan(waitPlan, {
    decision: "WAIT",
    livePrice: waitPrice,
    poc: 4339.8,
    vah: 4346.2,
    val: 4335.1,
    atrLabel: "LOW",
    positionVsPoc: "ABOVE_POC",
    regime: "RANGE",
    localCityLabel: "Dublin",
    secondaryCityLabel: "New York",
    localClock: "22:01",
    secondaryClock: "17:01"
  });
  // Keep structure ladder / key levels on the same price regime as live price.
  waitCtx.nearestResistance = 4343.46;
  waitCtx.nearestSupport = 4339.09;

  const buyCtx = contextFromPlan(buyPlan, {
    decision: "BUY",
    livePrice: buyPrice,
    poc: 4340.5,
    vah: 4349.0,
    val: 4336.0,
    atrLabel: "NORMAL",
    positionVsPoc: "ABOVE_POC",
    regime: "TREND",
    localCityLabel: "Dublin",
    secondaryCityLabel: "New York",
    localClock: "17:12",
    secondaryClock: "12:12"
  });

  const sellCtx = contextFromPlan(sellPlan, {
    decision: "SELL",
    livePrice: sellPrice,
    poc: 4344.0,
    vah: 4350.2,
    val: 4338.5,
    atrLabel: "NORMAL",
    positionVsPoc: "BELOW_POC",
    regime: "TREND",
    localCityLabel: "Dublin",
    secondaryCityLabel: "New York",
    localClock: "15:40",
    secondaryClock: "10:40"
  });

  return [
    {
      id: "WAIT",
      filename: "01-WAIT-Report.png",
      input: {
        decision: "WAIT",
        scoreTotal: waitScore.total,
        livePrice: waitPrice,
        sessionLabel: "New York",
        compactTime: "22:01",
        timeZone: "Europe/Dublin",
        utcSecondary: "21:01 UTC",
        ladder: {
          livePrice: waitPrice,
          poc: waitCtx.poc,
          vah: waitCtx.vah,
          val: waitCtx.val,
          dataSourceLabel: "LIVE",
          isUiReviewFixture: true,
          marketStatus: "OPEN"
        },
        scoreComponents: waitScore.components,
        reportContext: waitCtx
      }
    },
    {
      id: "BUY",
      filename: "02-BUY-Report.png",
      input: {
        decision: "BUY",
        scoreTotal: buyScore.total,
        livePrice: buyPrice,
        sessionLabel: "New York",
        compactTime: "17:12",
        timeZone: "Europe/Dublin",
        utcSecondary: "16:12 UTC",
        ladder: {
          livePrice: buyPrice,
          poc: buyCtx.poc,
          vah: buyCtx.vah,
          val: buyCtx.val,
          dataSourceLabel: "LIVE",
          isUiReviewFixture: true,
          marketStatus: "OPEN"
        },
        plan: {
          direction: "BUY",
          status: "ACTIVE_SHADOW",
          levels: {
            entryPrice: 4341.2,
            stopLoss: 4334.5,
            tp1: 4348.6,
            tp2: 4354.0,
            tp3: 4360.2
          }
        },
        scoreComponents: buyScore.components,
        reportContext: buyCtx
      }
    },
    {
      id: "SELL",
      filename: "03-SELL-Report.png",
      input: {
        decision: "SELL",
        scoreTotal: sellScore.total,
        livePrice: sellPrice,
        sessionLabel: "London",
        compactTime: "15:40",
        timeZone: "Europe/Dublin",
        utcSecondary: "14:40 UTC",
        ladder: {
          livePrice: sellPrice,
          poc: sellCtx.poc,
          vah: sellCtx.vah,
          val: sellCtx.val,
          dataSourceLabel: "LIVE",
          isUiReviewFixture: true,
          marketStatus: "OPEN"
        },
        plan: {
          direction: "SELL",
          status: "ACTIVE_SHADOW",
          levels: {
            entryPrice: 4342.8,
            stopLoss: 4349.5,
            tp1: 4335.4,
            tp2: 4329.0,
            tp3: 4322.5
          }
        },
        scoreComponents: sellScore.components,
        reportContext: sellCtx
      }
    }
  ];
}
