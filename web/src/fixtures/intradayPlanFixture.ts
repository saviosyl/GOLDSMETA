import type { IntradayPlan } from "../types/intradayPlan";

/**
 * Labelled Issue #50 chart-example fixture for UI/tests only.
 * Prices mirror the attached TradingView screenshot for UX review — never used as production defaults.
 */
export const chartExampleIntradayPlanFixture: IntradayPlan = {
  schemaVersion: "1.0",
  action: "PREPARE",
  actionLabel: "PREPARE — SETUP FORMING",
  oneSentence:
    "Price is testing nearby support; wait for confirmation before a manual entry. (LABELLED FIXTURE — not live market data)",
  trigger: "Bullish rejection near VAL / support 4037.31",
  triggerPrice: 4037.31,
  distanceToTriggerPoints: 2.5,
  entryConfirmation: [
    "Confirmed rejection candle (touch and fall back from sellers, or bounce from floor)",
    "Hold above nearest support on a closed 5-minute candle"
  ],
  invalidation: "Break and hold below 4028.60",
  nextTarget: "4045.10",
  whyNotReady: "Structure is present but candle confirmation is incomplete — 3 of 6 conditions ready.",
  setupProgress: {
    complete: 3,
    total: 6,
    label: "3 of 6 conditions complete",
    items: [
      {
        id: "structure",
        label: "Complete market structure (POC/VAH/VAL)",
        complete: true,
        detail: "Verified complete strategy signal present"
      },
      {
        id: "fresh-quote",
        label: "Fresh live / last price",
        complete: true,
        detail: "Price 4034.82"
      },
      {
        id: "bias",
        label: "Clear directional bias",
        complete: false,
        detail: "Range / neutral bias — prepare both scenarios"
      },
      {
        id: "confirmation",
        label: "Entry confirmation candle",
        complete: false,
        detail: "No breakout/rejection/retest confirmation yet"
      },
      {
        id: "plan",
        label: "Trade plan levels (entry/stop/targets)",
        complete: true,
        detail: "Stop and targets available from complete signal"
      },
      {
        id: "space",
        label: "Room to next target vs stop",
        complete: false,
        detail: "Waiting for confirmation before measuring R:R"
      }
    ]
  },
  directionBias: "NEUTRAL",
  marketType: "RANGE",
  session: "LONDON",
  confidence: 55,
  expectedRange: {
    probableLow: 4037.31,
    probableHigh: 4049.63,
    stretchLow: 4022.32,
    stretchHigh: 4062.32,
    currentPrice: 4034.82,
    remainingAbovePoints: 14.81,
    remainingBelowPoints: -2.49,
    remainingAbovePercent: 0.37,
    remainingBelowPercent: -0.06,
    confidence: 72,
    reasons: [
      "Probable range anchored to verified VAL → VAH value area",
      "Stretch targets use approximately one ATR beyond the probable range"
    ],
    invalidation:
      "Recalculate when a new complete strategy signal arrives, when price leaves the stretch band, or when market-structure mode becomes MISMATCH.",
    estimateDisclaimer:
      "Probable and stretch prices are estimates only — never guarantees. Markets can move beyond any projected range."
  },
  bullishScenario: {
    label: "If price rises",
    trigger: "Break and hold above 4037.31 (ceiling) or rejection bounce from floor",
    firstTarget: "4045.10",
    secondTarget: "4049.63",
    invalidation: "Break and hold below 4028.60"
  },
  bearishScenario: {
    label: "If price falls",
    trigger: "Break and hold below 4037.31 (floor) or rejection from resistance",
    firstTarget: "4028.60",
    secondTarget: "4022.32",
    invalidation: "Break and hold above 4049.63"
  },
  zones: {
    bestBuyZone: "4037.31–4045.09",
    bestSellZone: "4045.09–4049.63",
    noTradeZone: "Avoid chasing mid-range near 4045.09 without confirmation",
    nearestSupport: 4037.31,
    nearestResistance: 4049.63
  },
  importantLevels: [
    {
      id: "lvl-vah",
      side: "UPSIDE",
      kind: "RESISTANCE",
      price: 4049.63,
      zoneLow: null,
      zoneHigh: null,
      strength: "STRONG",
      distancePoints: 14.81,
      distancePercent: 0.37,
      shortMeaning: "Value-area high — nearest ceiling above value",
      reasons: [
        {
          code: "VAH",
          label: "Value Area High (VAH)",
          explanation:
            "VAH marks the upper edge of the value area where most volume traded. Acts as a ceiling until broken and held.",
          sourceTimeframe: "15"
        }
      ],
      whatToWatch: ["Rejection (touch and fall back) near VAH", "Break and hold above VAH"],
      ifHolds: "Price may stall or reverse lower from this ceiling.",
      ifBreaks: "A break and hold above VAH can open higher upside targets.",
      confirmationRequired: ["Confirmed candle close above VAH for breakout"],
      nextLevelId: "lvl-tp2",
      riskWarning: "Levels can fail quickly in fast gold markets. Size manually and use a stop.",
      simpleExplanation:
        "Think of VAH as a ceiling built from where most trading happened. Price often pauses here.",
      confidence: 78
    },
    {
      id: "lvl-val",
      side: "DOWNSIDE",
      kind: "SUPPORT",
      price: 4037.31,
      zoneLow: null,
      zoneHigh: null,
      strength: "STRONG",
      distancePoints: 2.49,
      distancePercent: 0.06,
      shortMeaning: "Value-area low — nearest floor under value",
      reasons: [
        {
          code: "VAL",
          label: "Value Area Low (VAL)",
          explanation:
            "VAL marks the lower edge of the value area. Acts as a floor until broken and held.",
          sourceTimeframe: "15"
        }
      ],
      whatToWatch: ["Rejection near VAL", "Break and hold below VAL"],
      ifHolds: "Price may bounce from this floor back toward POC/VAH.",
      ifBreaks: "A break and hold below VAL can open lower downside targets.",
      confirmationRequired: ["Confirmed candle close below VAL for breakdown"],
      nextLevelId: "lvl-stop",
      riskWarning: "Levels can fail quickly in fast gold markets. Size manually and use a stop.",
      simpleExplanation:
        "Think of VAL as a floor built from where most trading happened. Price often pauses here.",
      confidence: 78
    },
    {
      id: "lvl-stop",
      side: "DOWNSIDE",
      kind: "BREAKDOWN",
      price: 4028.6,
      zoneLow: null,
      zoneHigh: null,
      strength: "MAJOR",
      distancePoints: -6.22,
      distancePercent: -0.15,
      shortMeaning: "Plan invalidation / stop region",
      reasons: [
        {
          code: "PLAN_STOP",
          label: "Trade-plan stop / invalidation",
          explanation:
            "Stop comes from the latest valid complete strategy signal. A sustained break invalidates the plan.",
          sourceTimeframe: "15"
        }
      ],
      whatToWatch: ["Close through stop region"],
      ifHolds: "Plan may still be valid if price holds above invalidation.",
      ifBreaks: "Manual plan is invalidated — do not average down.",
      confirmationRequired: ["Confirmed close beyond stop for invalidation"],
      nextLevelId: null,
      riskWarning: "If invalidated, stand aside. Do not average down.",
      simpleExplanation: "If price breaks and holds beyond this area, the trade idea is wrong.",
      confidence: 80
    }
  ],
  tradePlan: {
    actionable: false,
    direction: "NONE",
    entryZone: null,
    stopLoss: 4028.6,
    tp1: 4045.1,
    tp2: 4049.8,
    tp3: 4053.7,
    riskReward: null,
    maxCashRiskNote: "Use the Risk planner for max cash risk — never risk more than you set.",
    positionSizeNote: "Position size requires your account inputs in the Risk planner.",
    invalidation: "Break and hold below 4028.60",
    management: "If entered manually after confirmation, consider moving stop to breakeven after TP1."
  },
  freshness: {
    quoteAgeSeconds: 30,
    signalAgeSeconds: 120,
    marketStructureMode: "COMPLETE",
    sourceLabel: "TEST_FIXTURE",
    dataQuality: "GOOD"
  },
  safety: {
    autoTrade: "OFF",
    demoOrderSubmission: false,
    liveTrading: false,
    analysisOnly: true
  },
  disclaimer:
    "GoldMeta is analysis-only manual assistance for adult traders. AutoTrade stays OFF. No broker orders are submitted. This payload is a labelled Issue #50 chart fixture for UI/tests only."
};
