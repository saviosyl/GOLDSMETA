import type { IntradayPlan } from "../types/intradayPlan";

/**
 * Labelled Issue #50 chart-example fixture (price BELOW value).
 * Generated from backend buildChartExampleIntradayFixture — never production defaults.
 */
export const chartExampleIntradayPlanFixture = {
  "schemaVersion": "1.1",
  "action": "PREPARE",
  "actionLabel": "PREPARE — SETUP FORMING",
  "oneSentence": "Price is below value. VAL 4037.308 is the first reclaim/overhead resistance. A bullish plan requires a reclaim and hold above VAL; a failed reclaim may support bearish continuation. (LABELLED FIXTURE — not live market data)",
  "trigger": "Reclaim and hold above VAL 4037.308",
  "triggerPrice": 4037.308,
  "distanceToTriggerPoints": 2.49,
  "entryConfirmation": [
    "Confirmed close above VAL for bullish reclaim",
    "Or rejection/failed reclaim for bearish continuation",
    "Do not treat VAL as a floor while it remains above price"
  ],
  "invalidation": "Break and hold below 4031.1 ends the immediate reclaim attempt",
  "nextTarget": "VAH 4049.633 after successful reclaim",
  "whyNotReady": "Price is below the value area — wait for reclaim-and-hold or a confirmed breakdown from genuine support below.",
  "valueLocation": "BELOW_VALUE",
  "setupProgress": {
    "complete": 4,
    "total": 6,
    "label": "4 of 6 conditions complete",
    "items": [
      {
        "id": "structure",
        "label": "Complete market structure (POC/VAH/VAL)",
        "complete": true,
        "detail": "Verified complete strategy signal present"
      },
      {
        "id": "fresh-quote",
        "label": "Fresh live / last price",
        "complete": true,
        "detail": "Price 4034.815"
      },
      {
        "id": "bias",
        "label": "Directional bias readable",
        "complete": true,
        "detail": "Decision WAIT"
      },
      {
        "id": "confirmation",
        "label": "Entry confirmation candle",
        "complete": false,
        "detail": "Classification NONE"
      },
      {
        "id": "plan",
        "label": "Entry / stop / targets available",
        "complete": false,
        "detail": "No actionable plan levels"
      },
      {
        "id": "alignment",
        "label": "Price sources aligned",
        "complete": true,
        "detail": "Sources OK"
      }
    ]
  },
  "directionBias": "NEUTRAL",
  "marketType": "RANGE",
  "session": "LONDON",
  "confidence": 55,
  "expectedRange": {
    "rangeAvailable": true,
    "unavailableReason": null,
    "valueLocation": "BELOW_VALUE",
    "probableLow": 4031.1,
    "probableHigh": 4037.31,
    "stretchLow": 4022.32,
    "stretchHigh": 4047.32,
    "currentPrice": 4034.815,
    "remainingAbovePoints": 2.49,
    "remainingBelowPoints": 3.72,
    "remainingAbovePercent": 0.06,
    "remainingBelowPercent": 0.09,
    "confidence": 58,
    "reasons": [
      "Below value: probable low from verified bar/ATR support at or below price; probable high is VAL reclaim resistance",
      "Stretch targets use approximately one ATR beyond current price / probable bounds"
    ],
    "invalidation": "Recalculate when a new complete strategy signal arrives, when price leaves the stretch band, or when market-structure mode becomes MISMATCH.",
    "estimateDisclaimer": "Probable and stretch prices are estimates only — never guarantees. Markets can move beyond any projected range."
  },
  "bullishScenario": {
    "label": "If price rises",
    "trigger": "Reclaim and hold above VAL 4037.308",
    "triggerPrice": 4037.308,
    "firstTarget": "4037.31",
    "firstTargetPrice": 4037.31,
    "secondTarget": "4049.633",
    "secondTargetPrice": 4049.633,
    "invalidation": "Break and hold below 4031.1",
    "invalidationPrice": 4031.1
  },
  "bearishScenario": {
    "label": "If price falls",
    "trigger": "Breakdown and hold below support 4031.1",
    "triggerPrice": 4031.1,
    "firstTarget": "4031.1",
    "firstTargetPrice": 4031.1,
    "secondTarget": "4022.32",
    "secondTargetPrice": 4022.32,
    "invalidation": "Reclaim and hold above 4037.308",
    "invalidationPrice": 4037.308
  },
  "zones": {
    "valueLocation": "BELOW_VALUE",
    "bestBuyZone": "Conditional reclaim-and-hold above 4037.308 (not an immediate buy zone)",
    "bestBuyImmediate": false,
    "bestBuyConfirmation": "Confirmed close and hold above VAL 4037.308",
    "bestBuyInvalidation": "Break and hold below 4031.1",
    "bestSellZone": "Failed reclaim / rejection at VAL 4037.308",
    "bestSellImmediate": false,
    "bestSellConfirmation": "Rejection candle at VAL after a touch from below",
    "bestSellInvalidation": "Reclaim and hold above 4037.308",
    "noTradeZone": "Avoid chasing into mid-value near 4045.087 before reclaim",
    "nearestSupport": 4031.1,
    "nearestResistance": 4037.308
  },
  "importantLevels": [
    {
      "id": "lvl-tp3",
      "side": "UPSIDE",
      "kind": "STRETCH",
      "roleAtCurrentPrice": "TARGET",
      "proximity": "ABOVE",
      "price": 4053.7,
      "zoneLow": null,
      "zoneHigh": null,
      "strength": "MAJOR",
      "distancePoints": 18.88,
      "distancePercent": 0.47,
      "shortMeaning": "Stretch upside target (TP3)",
      "reasons": [
        {
          "code": "PLAN_TARGET",
          "label": "Trade-plan target TP3",
          "explanation": "TP3 is the stretch target from the verified strategy plan.",
          "sourceTimeframe": "15"
        }
      ],
      "whatToWatch": [
        "Momentum continuation"
      ],
      "ifHolds": "Reaching TP3 often marks an extended move where profit-taking is common.",
      "ifBreaks": "Stretch target only — uncommon to reach every session.",
      "confirmationRequired": [
        "Strong trend continuation"
      ],
      "nextLevelId": null,
      "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
      "simpleExplanation": "TP3 is an optimistic stretch target, not a promise.",
      "confidence": 55
    },
    {
      "id": "lvl-tp2",
      "side": "UPSIDE",
      "kind": "TARGET",
      "roleAtCurrentPrice": "TARGET",
      "proximity": "ABOVE",
      "price": 4049.8,
      "zoneLow": null,
      "zoneHigh": null,
      "strength": "STRONG",
      "distancePoints": 14.99,
      "distancePercent": 0.37,
      "shortMeaning": "Take-profit 2 — extended upside target",
      "reasons": [
        {
          "code": "PLAN_TARGET",
          "label": "Trade-plan target TP2",
          "explanation": "TP2 from the latest valid complete strategy signal.",
          "sourceTimeframe": "15"
        }
      ],
      "whatToWatch": [
        "Extension after TP1"
      ],
      "ifHolds": "Holding near TP2 can mean momentum is slowing after the extension.",
      "ifBreaks": "May allow further manual scaling out.",
      "confirmationRequired": [
        "Valid entry first"
      ],
      "nextLevelId": "lvl-tp3",
      "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
      "simpleExplanation": "TP2 is a further planned profit area if the move continues.",
      "confidence": 65
    },
    {
      "id": "lvl-vah",
      "side": "UPSIDE",
      "kind": "RESISTANCE",
      "roleAtCurrentPrice": "RESISTANCE",
      "proximity": "ABOVE",
      "price": 4049.633,
      "zoneLow": null,
      "zoneHigh": null,
      "strength": "STRONG",
      "distancePoints": 14.82,
      "distancePercent": 0.37,
      "shortMeaning": "Value-area high — ceiling above value",
      "reasons": [
        {
          "code": "VAH",
          "label": "Value Area High (VAH)",
          "explanation": "VAH is the upper edge of the value area. While price is at or below VAH, it can act as a ceiling (resistance).",
          "sourceTimeframe": "15"
        }
      ],
      "whatToWatch": [
        "Rejection at VAH",
        "Break and hold above VAH"
      ],
      "ifHolds": "Price may stall or reverse lower from this ceiling.",
      "ifBreaks": "A break and hold above VAH can open higher upside targets.",
      "confirmationRequired": [
        "Confirmed close above VAH for breakout",
        "Or rejection wick for fade"
      ],
      "nextLevelId": null,
      "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
      "simpleExplanation": "VAH is the upper edge of the value area. While price is at or below VAH, it can act as a ceiling (resistance).",
      "confidence": 78
    },
    {
      "id": "lvl-atr-high",
      "side": "UPSIDE",
      "kind": "STRETCH",
      "roleAtCurrentPrice": "STRETCH_ESTIMATE",
      "proximity": "ABOVE",
      "price": 4047.32,
      "zoneLow": null,
      "zoneHigh": null,
      "strength": "MINOR",
      "distancePoints": 12.51,
      "distancePercent": 0.31,
      "shortMeaning": "ATR stretch high (estimate)",
      "reasons": [
        {
          "code": "ATR_PROJECTION",
          "label": "ATR projection",
          "explanation": "Projected roughly one ATR (12.5) above the current verified price. Estimate only.",
          "sourceTimeframe": "15"
        }
      ],
      "whatToWatch": [
        "Whether momentum can extend a full ATR"
      ],
      "ifHolds": "Holding near the ATR stretch often means an extended session move is stalling.",
      "ifBreaks": "Stretch estimates are frequently not reached.",
      "confirmationRequired": [
        "Strong directional continuation"
      ],
      "nextLevelId": null,
      "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
      "simpleExplanation": "An ATR stretch is a statistical reach estimate, not a guaranteed high.",
      "confidence": 45
    },
    {
      "id": "lvl-tp1",
      "side": "UPSIDE",
      "kind": "TARGET",
      "roleAtCurrentPrice": "TARGET",
      "proximity": "ABOVE",
      "price": 4045.1,
      "zoneLow": null,
      "zoneHigh": null,
      "strength": "MODERATE",
      "distancePoints": 10.28,
      "distancePercent": 0.25,
      "shortMeaning": "Take-profit 1 — first upside target",
      "reasons": [
        {
          "code": "PLAN_TARGET",
          "label": "Trade-plan target TP1",
          "explanation": "TP1 from the latest valid complete strategy signal.",
          "sourceTimeframe": "15"
        }
      ],
      "whatToWatch": [
        "Progress toward TP1 after a confirmed entry"
      ],
      "ifHolds": "Reaching TP1 often invites partial profit-taking.",
      "ifBreaks": "Beyond TP1, next target or stretch may become relevant.",
      "confirmationRequired": [
        "Valid entry first",
        "Plan still active"
      ],
      "nextLevelId": "lvl-tp2",
      "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
      "simpleExplanation": "TP1 is the first planned take-profit — not a guarantee.",
      "confidence": 70
    },
    {
      "id": "lvl-poc",
      "side": "UPSIDE",
      "kind": "MAGNET",
      "roleAtCurrentPrice": "MAGNET",
      "proximity": "ABOVE",
      "price": 4045.087,
      "zoneLow": null,
      "zoneHigh": null,
      "strength": "MAJOR",
      "distancePoints": 10.27,
      "distancePercent": 0.25,
      "shortMeaning": "POC — overhead magnet / decision resistance",
      "reasons": [
        {
          "code": "POC",
          "label": "Point of Control (POC)",
          "explanation": "POC is the busiest traded price — currently above price, acting as an overhead magnet.",
          "sourceTimeframe": "15"
        }
      ],
      "whatToWatch": [
        "Acceptance through POC",
        "Rejection away from POC"
      ],
      "ifHolds": "Price may rotate back toward value around POC.",
      "ifBreaks": "Acceptance through POC can continue toward VAH or beyond.",
      "confirmationRequired": [
        "Confirmed close through POC"
      ],
      "nextLevelId": "lvl-vah",
      "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
      "simpleExplanation": "POC is the busiest traded price — currently above price, acting as an overhead magnet.",
      "confidence": 82
    },
    {
      "id": "lvl-bar-high",
      "side": "UPSIDE",
      "kind": "RESISTANCE",
      "roleAtCurrentPrice": "RESISTANCE",
      "proximity": "ABOVE",
      "price": 4041.2,
      "zoneLow": null,
      "zoneHigh": null,
      "strength": "MODERATE",
      "distancePoints": 6.38,
      "distancePercent": 0.16,
      "shortMeaning": "Recent bar high — short-term ceiling",
      "reasons": [
        {
          "code": "SESSION_HIGH",
          "label": "Recent bar / session high",
          "explanation": "The latest verified bar high marks a nearby short-term reference until broken and held.",
          "sourceTimeframe": "15"
        }
      ],
      "whatToWatch": [
        "Break and hold above the high",
        "Rejection back into the range"
      ],
      "ifHolds": "Sellers may defend this short-term ceiling when it is still overhead.",
      "ifBreaks": "Break and hold can extend toward the next upside level.",
      "confirmationRequired": [
        "Confirmed close beyond the high"
      ],
      "nextLevelId": "lvl-vah",
      "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
      "simpleExplanation": "The recent high is a nearby reference until buyers or sellers prove control.",
      "confidence": 60
    },
    {
      "id": "lvl-val",
      "side": "UPSIDE",
      "kind": "RECLAIM",
      "roleAtCurrentPrice": "RECLAIM_LEVEL",
      "proximity": "ABOVE",
      "price": 4037.308,
      "zoneLow": null,
      "zoneHigh": null,
      "strength": "STRONG",
      "distancePoints": 2.49,
      "distancePercent": 0.06,
      "shortMeaning": "VAL — first reclaim / overhead resistance until recovered",
      "reasons": [
        {
          "code": "VAL",
          "label": "Value Area Low (VAL)",
          "explanation": "Price is currently below VAL. VAL is previous support that now acts as a reclaim/resistance level until price closes above and holds.",
          "sourceTimeframe": "15"
        }
      ],
      "whatToWatch": [
        "Reclaim and hold above VAL",
        "Failed reclaim / rejection back below VAL"
      ],
      "ifHolds": "As resistance overhead, a hold below VAL keeps price outside value.",
      "ifBreaks": "A reclaim and hold above VAL can reopen the value area toward POC/VAH.",
      "confirmationRequired": [
        "Confirmed close above VAL",
        "Hold on a subsequent bar"
      ],
      "nextLevelId": "lvl-poc",
      "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
      "simpleExplanation": "Price is currently below VAL. VAL is previous support that now acts as a reclaim/resistance level until price closes above and holds.",
      "confidence": 78
    },
    {
      "id": "lvl-bar-low",
      "side": "DOWNSIDE",
      "kind": "SUPPORT",
      "roleAtCurrentPrice": "SUPPORT",
      "proximity": "BELOW",
      "price": 4031.1,
      "zoneLow": null,
      "zoneHigh": null,
      "strength": "MODERATE",
      "distancePoints": -3.72,
      "distancePercent": -0.09,
      "shortMeaning": "Recent bar low — nearest verified support",
      "reasons": [
        {
          "code": "SESSION_LOW",
          "label": "Recent bar / session low",
          "explanation": "The latest verified bar low marks a nearby short-term floor or reclaim reference.",
          "sourceTimeframe": "15"
        }
      ],
      "whatToWatch": [
        "Hold above the low",
        "Break and hold below the low"
      ],
      "ifHolds": "Buyers may defend this short-term floor when it is still below price.",
      "ifBreaks": "Break and hold can extend toward the next downside level.",
      "confirmationRequired": [
        "Confirmed close beyond the low"
      ],
      "nextLevelId": "lvl-stop",
      "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
      "simpleExplanation": "The recent low is the nearest verified support when it sits at or below current price.",
      "confidence": 60
    },
    {
      "id": "lvl-stop",
      "side": "DOWNSIDE",
      "kind": "INVALIDATION",
      "roleAtCurrentPrice": "INVALIDATION",
      "proximity": "BELOW",
      "price": 4028.6,
      "zoneLow": null,
      "zoneHigh": null,
      "strength": "MAJOR",
      "distancePoints": -6.22,
      "distancePercent": -0.15,
      "shortMeaning": "Plan invalidation / stop region",
      "reasons": [
        {
          "code": "PLAN_STOP",
          "label": "Trade-plan stop / invalidation",
          "explanation": "Stop comes from the latest valid complete strategy signal. A sustained break invalidates the plan.",
          "sourceTimeframe": "15"
        }
      ],
      "whatToWatch": [
        "Close through stop region",
        "Fast spike that reverses (false break)"
      ],
      "ifHolds": "Plan may still be valid if price holds on the correct side of invalidation.",
      "ifBreaks": "Manual plan is invalidated — do not average down.",
      "confirmationRequired": [
        "Confirmed close beyond stop for invalidation"
      ],
      "nextLevelId": null,
      "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
      "simpleExplanation": "If price breaks and holds beyond this area, the trade idea is wrong.",
      "confidence": 80
    },
    {
      "id": "lvl-atr-low",
      "side": "DOWNSIDE",
      "kind": "STRETCH",
      "roleAtCurrentPrice": "STRETCH_ESTIMATE",
      "proximity": "BELOW",
      "price": 4022.32,
      "zoneLow": null,
      "zoneHigh": null,
      "strength": "MINOR",
      "distancePoints": -12.49,
      "distancePercent": -0.31,
      "shortMeaning": "ATR stretch low (estimate)",
      "reasons": [
        {
          "code": "ATR_PROJECTION",
          "label": "ATR projection",
          "explanation": "Projected roughly one ATR (12.5) below the current verified price. Estimate only.",
          "sourceTimeframe": "15"
        }
      ],
      "whatToWatch": [
        "Whether a selloff can extend a full ATR"
      ],
      "ifHolds": "Holding near the ATR stretch low often means downside extension is exhausting.",
      "ifBreaks": "Stretch estimates are frequently not reached.",
      "confirmationRequired": [
        "Strong downside continuation"
      ],
      "nextLevelId": null,
      "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
      "simpleExplanation": "An ATR stretch is a statistical reach estimate, not a guaranteed low.",
      "confidence": 45
    }
  ],
  "tradePlan": {
    "cardKind": "CONDITIONAL_REFERENCE",
    "title": "Conditional levels — no active trade plan",
    "actionable": false,
    "direction": "NONE",
    "entryZone": null,
    "stopLoss": null,
    "tp1": null,
    "tp2": null,
    "tp3": null,
    "riskReward": null,
    "maxCashRiskNote": "No active trade — set cash risk in the Risk planner only if you later enter manually.",
    "positionSizeNote": "No trade plan is active. Reference levels below are not an order ticket.",
    "invalidation": "Break and hold below 4031.1 ends the immediate reclaim attempt",
    "management": "Wait for confirmation. Do not treat stop/TP references as an active plan.",
    "orderingValid": false,
    "orderingNote": "No trade plan is active.",
    "bullishConditional": {
      "label": "Bullish conditional plan",
      "direction": "BUY",
      "trigger": "Reclaim and hold above VAL 4037.308",
      "entryZone": "4037.308",
      "stopLoss": 4031.1,
      "tp1": 4037.31,
      "invalidation": "Break and hold below 4031.1",
      "confirmationRequired": [
        "Confirmation candle on the bullish trigger"
      ]
    },
    "bearishConditional": {
      "label": "Bearish conditional plan",
      "direction": "SELL",
      "trigger": "Breakdown and hold below support 4031.1",
      "entryZone": "4031.1",
      "stopLoss": 4037.308,
      "tp1": 4031.1,
      "invalidation": "Reclaim and hold above 4037.308",
      "confirmationRequired": [
        "Confirmation candle on the bearish trigger"
      ]
    }
  },
  "freshness": {
    "quoteAgeSeconds": 30,
    "signalAgeSeconds": 120,
    "marketStructureMode": "COMPLETE",
    "sourceLabel": "TEST_FIXTURE",
    "dataQuality": null
  },
  "safety": {
    "autoTrade": "OFF",
    "demoOrderSubmission": false,
    "liveTrading": false,
    "analysisOnly": true
  },
  "disclaimer": "GoldMeta is analysis-only manual assistance for adult traders. AutoTrade stays OFF. No broker orders are submitted. This payload is a labelled Issue #50 chart fixture for UI/tests only."
} as IntradayPlan;
