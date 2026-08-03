import type { IntradayPlan } from "../types/intradayPlan";

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

export const issue50PreviewCases: Issue50PreviewCase[] = [
  {
    "id": "below-val",
    "title": "Price below VAL",
    "mode": "COMPLETE",
    "quoteAgeSeconds": 30,
    "signalAgeSeconds": 120,
    "livePrice": 4034.815,
    "decisionCode": "WAIT",
    "plan": {
      "schemaVersion": "1.2",
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
      "nextTarget": "4041.2 — recent bar high",
      "nextTargetPrice": 4041.2,
      "afterThatTarget": "4045.09 — POC / volume magnet",
      "afterThatTargetPrice": 4045.09,
      "majorTarget": "4049.63 — VAH",
      "majorTargetPrice": 4049.63,
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
        "confirmationRequired": [
          "5-minute candle closes above VAL",
          "Retest holds above VAL"
        ],
        "firstTarget": "4041.2 — recent bar high",
        "firstTargetPrice": 4041.2,
        "firstTargetWhy": "Nearest verified recent bar high beyond the bullish trigger.",
        "secondTarget": "4045.09 — POC / volume magnet",
        "secondTargetPrice": 4045.09,
        "secondTargetWhy": "Verified point of control — volume magnet beyond the trigger.",
        "invalidation": "Break and hold below 4031.1",
        "invalidationPrice": 4031.1
      },
      "bearishScenario": {
        "label": "If price falls",
        "trigger": "Break and hold below 4031.1",
        "triggerPrice": 4031.1,
        "confirmationRequired": [
          "5-minute candle closes below the support trigger",
          "Hold below on retest"
        ],
        "firstTarget": "Unavailable",
        "firstTargetPrice": null,
        "firstTargetWhy": "No verified intermediate target is available beyond the trigger — do not invent a price.",
        "secondTarget": "4022.32 — stretch low (estimate)",
        "secondTargetPrice": 4022.32,
        "secondTargetWhy": "Stretch estimate only — no nearer verified intermediate target.",
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
          "confirmationRequired": [
            "5-minute candle closes above VAL",
            "Retest holds above VAL"
          ],
          "target1": "4041.2 — recent bar high",
          "target1Price": 4041.2,
          "target1Why": "Nearest verified recent bar high beyond the bullish trigger.",
          "target2": "4045.09 — POC / volume magnet",
          "target2Price": 4045.09,
          "target2Why": "Verified point of control — volume magnet beyond the trigger.",
          "invalidation": "Break and hold below 4031.1",
          "invalidationPrice": 4031.1
        },
        "bearishConditional": {
          "label": "Bearish conditional plan",
          "direction": "SELL",
          "trigger": "Break and hold below 4031.1",
          "confirmationRequired": [
            "5-minute candle closes below the support trigger",
            "Hold below on retest"
          ],
          "target1": "Unavailable",
          "target1Price": null,
          "target1Why": "No verified intermediate target is available beyond the trigger — do not invent a price.",
          "target2": "4022.32 — stretch low (estimate)",
          "target2Price": 4022.32,
          "target2Why": "Stretch estimate only — no nearer verified intermediate target.",
          "invalidation": "Reclaim and hold above 4037.308",
          "invalidationPrice": 4037.308
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
    },
    "decision": {
      "lastKnownPrice": 4034.815,
      "ohlcv": {
        "open": 4036,
        "high": 4041.2,
        "low": 4031.1,
        "close": 4034.815,
        "volume": 1
      },
      "marketStructure": {
        "poc": 4045.087,
        "vah": 4049.633,
        "val": 4037.308,
        "trend": "RANGE",
        "confirmationClassification": "NONE"
      },
      "decision": "WAIT",
      "dataQuality": "GOOD",
      "dataSourceLabel": "TEST",
      "isTestDecision": true,
      "generatedAt": "2026-08-03T19:37:38.949Z",
      "marketDataTime": "2026-08-03T19:37:38.949Z",
      "currentSession": "LONDON"
    }
  },
  {
    "id": "inside-value",
    "title": "Price inside VAL–VAH",
    "mode": "COMPLETE",
    "quoteAgeSeconds": 20,
    "signalAgeSeconds": 90,
    "livePrice": 4042.5,
    "decisionCode": "WAIT",
    "plan": {
      "schemaVersion": "1.2",
      "action": "RANGE_TRADE",
      "actionLabel": "RANGE TRADE",
      "oneSentence": "Market is two-sided — prepare both scenarios; do not force a mid-range entry. (LABELLED PREVIEW — inside-value)",
      "trigger": "Fade extremes between floor 4037.308 and ceiling 4049.633 only with confirmation",
      "triggerPrice": null,
      "distanceToTriggerPoints": null,
      "entryConfirmation": [
        "Rejection at range edge",
        "Or break and hold beyond the edge with follow-through"
      ],
      "invalidation": "Accepted breakout that turns the range into a trend",
      "nextTarget": "4045.09 — POC / volume magnet",
      "nextTargetPrice": 4045.09,
      "afterThatTarget": "4048 — recent bar high",
      "afterThatTargetPrice": 4048,
      "majorTarget": "4049.63 — probable high (range)",
      "majorTargetPrice": 4049.63,
      "whyNotReady": "No one-sided confirmation yet; mid-range entries are low quality.",
      "valueLocation": "INSIDE_VALUE",
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
            "detail": "Price 4042.5"
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
      "confidence": 62,
      "expectedRange": {
        "rangeAvailable": true,
        "unavailableReason": null,
        "valueLocation": "INSIDE_VALUE",
        "probableLow": 4037.31,
        "probableHigh": 4049.63,
        "stretchLow": 4030,
        "stretchHigh": 4055,
        "currentPrice": 4042.5,
        "remainingAbovePoints": 7.13,
        "remainingBelowPoints": 5.19,
        "remainingAbovePercent": 0.18,
        "remainingBelowPercent": 0.13,
        "confidence": 72,
        "reasons": [
          "Inside value: probable range uses verified VAL → VAH",
          "Stretch targets use approximately one ATR beyond current price / probable bounds"
        ],
        "invalidation": "Recalculate when a new complete strategy signal arrives, when price leaves the stretch band, or when market-structure mode becomes MISMATCH.",
        "estimateDisclaimer": "Probable and stretch prices are estimates only — never guarantees. Markets can move beyond any projected range."
      },
      "bullishScenario": {
        "label": "If price rises",
        "trigger": "Bounce from support 4037.308",
        "triggerPrice": 4037.308,
        "confirmationRequired": [
          "Confirmation candle at the bullish trigger",
          "Hold on retest"
        ],
        "firstTarget": "4045.09 — POC / volume magnet",
        "firstTargetPrice": 4045.09,
        "firstTargetWhy": "Verified point of control — volume magnet beyond the trigger.",
        "secondTarget": "4048 — recent bar high",
        "secondTargetPrice": 4048,
        "secondTargetWhy": "Nearest verified recent bar high beyond the bullish trigger.",
        "invalidation": "Break and hold below 4037.308",
        "invalidationPrice": 4037.308
      },
      "bearishScenario": {
        "label": "If price falls",
        "trigger": "Rejection from resistance 4049.633",
        "triggerPrice": 4049.633,
        "confirmationRequired": [
          "Confirmation candle at the bearish trigger",
          "Hold on retest"
        ],
        "firstTarget": "4045.09 — POC / volume magnet",
        "firstTargetPrice": 4045.09,
        "firstTargetWhy": "Verified POC as a downside magnet when below the trigger.",
        "secondTarget": "4037.31 — probable low (range)",
        "secondTargetPrice": 4037.31,
        "secondTargetWhy": "Expected-range low used only when it is not the same price as the trigger/support break.",
        "invalidation": "Break and hold above 4049.633",
        "invalidationPrice": 4049.633
      },
      "zones": {
        "valueLocation": "INSIDE_VALUE",
        "bestBuyZone": "Near VAL 4037.308 with confirmation",
        "bestBuyImmediate": false,
        "bestBuyConfirmation": "Bullish rejection / hold at VAL",
        "bestBuyInvalidation": "Break and hold below 4037.308",
        "bestSellZone": "Near VAH 4049.633 with confirmation",
        "bestSellImmediate": false,
        "bestSellConfirmation": "Bearish rejection / hold at VAH",
        "bestSellInvalidation": "Break and hold above 4049.633",
        "noTradeZone": "Avoid chasing mid-range near POC 4045.087 without confirmation",
        "nearestSupport": 4037.308,
        "nearestResistance": 4048
      },
      "importantLevels": [
        {
          "id": "lvl-atr-high",
          "side": "UPSIDE",
          "kind": "STRETCH",
          "roleAtCurrentPrice": "STRETCH_ESTIMATE",
          "proximity": "ABOVE",
          "price": 4055,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MINOR",
          "distancePoints": 12.5,
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
          "id": "lvl-vah",
          "side": "UPSIDE",
          "kind": "RESISTANCE",
          "roleAtCurrentPrice": "RESISTANCE",
          "proximity": "ABOVE",
          "price": 4049.633,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "STRONG",
          "distancePoints": 7.13,
          "distancePercent": 0.18,
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
          "id": "lvl-bar-high",
          "side": "UPSIDE",
          "kind": "RESISTANCE",
          "roleAtCurrentPrice": "RESISTANCE",
          "proximity": "ABOVE",
          "price": 4048,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MODERATE",
          "distancePoints": 5.5,
          "distancePercent": 0.14,
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
          "id": "lvl-poc",
          "side": "UPSIDE",
          "kind": "MAGNET",
          "roleAtCurrentPrice": "MAGNET",
          "proximity": "ABOVE",
          "price": 4045.087,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MAJOR",
          "distancePoints": 2.59,
          "distancePercent": 0.06,
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
          "id": "lvl-val",
          "side": "DOWNSIDE",
          "kind": "SUPPORT",
          "roleAtCurrentPrice": "SUPPORT",
          "proximity": "BELOW",
          "price": 4037.308,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "STRONG",
          "distancePoints": -5.19,
          "distancePercent": -0.13,
          "shortMeaning": "Value-area low — floor under value",
          "reasons": [
            {
              "code": "VAL",
              "label": "Value Area Low (VAL)",
              "explanation": "VAL is the lower edge of the value area. While price is at or above VAL, it can act as a floor (support).",
              "sourceTimeframe": "15"
            }
          ],
          "whatToWatch": [
            "Rejection bounce near VAL",
            "Break and hold below VAL"
          ],
          "ifHolds": "Price may bounce from this floor back toward POC/VAH.",
          "ifBreaks": "A break and hold below VAL can open lower downside targets.",
          "confirmationRequired": [
            "Confirmed bounce candle",
            "Or confirmed close below for breakdown"
          ],
          "nextLevelId": "lvl-poc",
          "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
          "simpleExplanation": "VAL is the lower edge of the value area. While price is at or above VAL, it can act as a floor (support).",
          "confidence": 78
        },
        {
          "id": "lvl-bar-low",
          "side": "DOWNSIDE",
          "kind": "SUPPORT",
          "roleAtCurrentPrice": "SUPPORT",
          "proximity": "BELOW",
          "price": 4036,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MODERATE",
          "distancePoints": -6.5,
          "distancePercent": -0.16,
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
          "nextLevelId": null,
          "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
          "simpleExplanation": "The recent low is the nearest verified support when it sits at or below current price.",
          "confidence": 60
        },
        {
          "id": "lvl-atr-low",
          "side": "DOWNSIDE",
          "kind": "STRETCH",
          "roleAtCurrentPrice": "STRETCH_ESTIMATE",
          "proximity": "BELOW",
          "price": 4030,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MINOR",
          "distancePoints": -12.5,
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
        "invalidation": "Accepted breakout that turns the range into a trend",
        "management": "Wait for confirmation. Do not treat stop/TP references as an active plan.",
        "orderingValid": false,
        "orderingNote": "No trade plan is active.",
        "bullishConditional": {
          "label": "Bullish conditional plan",
          "direction": "BUY",
          "trigger": "Bounce from support 4037.308",
          "confirmationRequired": [
            "Confirmation candle at the bullish trigger",
            "Hold on retest"
          ],
          "target1": "4045.09 — POC / volume magnet",
          "target1Price": 4045.09,
          "target1Why": "Verified point of control — volume magnet beyond the trigger.",
          "target2": "4048 — recent bar high",
          "target2Price": 4048,
          "target2Why": "Nearest verified recent bar high beyond the bullish trigger.",
          "invalidation": "Break and hold below 4037.308",
          "invalidationPrice": 4037.308
        },
        "bearishConditional": {
          "label": "Bearish conditional plan",
          "direction": "SELL",
          "trigger": "Rejection from resistance 4049.633",
          "confirmationRequired": [
            "Confirmation candle at the bearish trigger",
            "Hold on retest"
          ],
          "target1": "4045.09 — POC / volume magnet",
          "target1Price": 4045.09,
          "target1Why": "Verified POC as a downside magnet when below the trigger.",
          "target2": "4037.31 — probable low (range)",
          "target2Price": 4037.31,
          "target2Why": "Expected-range low used only when it is not the same price as the trigger/support break.",
          "invalidation": "Break and hold above 4049.633",
          "invalidationPrice": 4049.633
        }
      },
      "freshness": {
        "quoteAgeSeconds": 20,
        "signalAgeSeconds": 90,
        "marketStructureMode": "COMPLETE",
        "sourceLabel": "TEST",
        "dataQuality": "GOOD"
      },
      "safety": {
        "autoTrade": "OFF",
        "demoOrderSubmission": false,
        "liveTrading": false,
        "analysisOnly": true
      },
      "disclaimer": "GoldMeta is analysis-only manual assistance for adult traders. AutoTrade stays OFF. No broker orders are submitted. Preview fixture inside-value — not live market data."
    },
    "decision": {
      "lastKnownPrice": 4042.5,
      "ohlcv": {
        "open": 4040,
        "high": 4048,
        "low": 4036,
        "close": 4042.5,
        "volume": 1
      },
      "marketStructure": {
        "poc": 4045.087,
        "vah": 4049.633,
        "val": 4037.308,
        "trend": "RANGE",
        "confirmationClassification": "NONE"
      },
      "decision": "WAIT",
      "dataQuality": "GOOD",
      "dataSourceLabel": "TEST",
      "isTestDecision": true,
      "generatedAt": "2026-08-03T19:37:38.949Z",
      "marketDataTime": "2026-08-03T19:37:38.949Z",
      "currentSession": "LONDON"
    }
  },
  {
    "id": "above-vah",
    "title": "Price above VAH",
    "mode": "COMPLETE",
    "quoteAgeSeconds": 20,
    "signalAgeSeconds": 90,
    "livePrice": 4052.4,
    "decisionCode": "WAIT",
    "plan": {
      "schemaVersion": "1.2",
      "action": "PREPARE",
      "actionLabel": "PREPARE — SETUP FORMING",
      "oneSentence": "Price is above value. VAH 4049.633 is previous resistance that may act as support only after a valid hold/retest. (LABELLED PREVIEW — above-vah)",
      "trigger": "Hold / retest above VAH 4049.633 or breakdown back below",
      "triggerPrice": 4049.633,
      "distanceToTriggerPoints": 2.77,
      "entryConfirmation": [
        "Retest hold above VAH",
        "Or confirmed close back below VAH for fade"
      ],
      "invalidation": "Close back through 4049.633 against the intended side",
      "nextTarget": "4055 — recent bar high",
      "nextTargetPrice": 4055,
      "afterThatTarget": "4064.9 — stretch high (estimate)",
      "afterThatTargetPrice": 4064.9,
      "majorTarget": null,
      "majorTargetPrice": null,
      "whyNotReady": "Extension above value — wait for retest hold (bullish) or confirmed breakdown (bearish).",
      "valueLocation": "ABOVE_VALUE",
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
            "detail": "Price 4052.4"
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
      "directionBias": "BULLISH",
      "marketType": "TREND",
      "session": "LONDON",
      "confidence": 62,
      "expectedRange": {
        "rangeAvailable": true,
        "unavailableReason": null,
        "valueLocation": "ABOVE_VALUE",
        "probableLow": 4049.63,
        "probableHigh": 4055,
        "stretchLow": 4039.9,
        "stretchHigh": 4064.9,
        "currentPrice": 4052.4,
        "remainingAbovePoints": 2.6,
        "remainingBelowPoints": 2.77,
        "remainingAbovePercent": 0.06,
        "remainingBelowPercent": 0.07,
        "confidence": 58,
        "reasons": [
          "Above value: probable low uses VAH as potential retest/support reference",
          "Above value: probable high uses verified bar high / extension reference",
          "Stretch targets use approximately one ATR beyond current price / probable bounds"
        ],
        "invalidation": "Recalculate when a new complete strategy signal arrives, when price leaves the stretch band, or when market-structure mode becomes MISMATCH.",
        "estimateDisclaimer": "Probable and stretch prices are estimates only — never guarantees. Markets can move beyond any projected range."
      },
      "bullishScenario": {
        "label": "If price rises",
        "trigger": "Continuation hold above VAH 4049.633",
        "triggerPrice": 4049.633,
        "confirmationRequired": [
          "Hold above VAH on retest",
          "Bullish continuation candle"
        ],
        "firstTarget": "4055 — recent bar high",
        "firstTargetPrice": 4055,
        "firstTargetWhy": "Nearest verified recent bar high beyond the bullish trigger.",
        "secondTarget": "4064.9 — stretch high (estimate)",
        "secondTargetPrice": 4064.9,
        "secondTargetWhy": "Stretch estimate only — no nearer verified intermediate target.",
        "invalidation": "Close back below 4049.633",
        "invalidationPrice": 4049.633
      },
      "bearishScenario": {
        "label": "If price falls",
        "trigger": "Breakdown and hold below VAH 4049.633",
        "triggerPrice": 4049.633,
        "confirmationRequired": [
          "Confirmed close below VAH",
          "Failed retest from below"
        ],
        "firstTarget": "4048 — recent bar low",
        "firstTargetPrice": 4048,
        "firstTargetWhy": "Nearest verified recent bar low beyond the bearish trigger.",
        "secondTarget": "4045.09 — POC / volume magnet",
        "secondTargetPrice": 4045.09,
        "secondTargetWhy": "Verified POC as a downside magnet when below the trigger.",
        "invalidation": "Reclaim and hold above 4049.633",
        "invalidationPrice": 4049.633
      },
      "zones": {
        "valueLocation": "ABOVE_VALUE",
        "bestBuyZone": "Retest hold above VAH 4049.633 (conditional)",
        "bestBuyImmediate": false,
        "bestBuyConfirmation": "Hold above VAH 4049.633 on retest",
        "bestBuyInvalidation": "Close back below 4049.633",
        "bestSellZone": "Only after breakdown and hold below VAH 4049.633 (not an immediate sell into strength)",
        "bestSellImmediate": false,
        "bestSellConfirmation": "Confirmed close below VAH 4049.633",
        "bestSellInvalidation": "Reclaim and hold back above 4049.633",
        "noTradeZone": "Avoid shorting into extension without a breakdown confirmation",
        "nearestSupport": 4049.633,
        "nearestResistance": 4055
      },
      "importantLevels": [
        {
          "id": "lvl-atr-high",
          "side": "UPSIDE",
          "kind": "STRETCH",
          "roleAtCurrentPrice": "STRETCH_ESTIMATE",
          "proximity": "ABOVE",
          "price": 4064.9,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MINOR",
          "distancePoints": 12.5,
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
          "id": "lvl-bar-high",
          "side": "UPSIDE",
          "kind": "RESISTANCE",
          "roleAtCurrentPrice": "RESISTANCE",
          "proximity": "ABOVE",
          "price": 4055,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MODERATE",
          "distancePoints": 2.6,
          "distancePercent": 0.06,
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
          "id": "lvl-vah",
          "side": "DOWNSIDE",
          "kind": "SUPPORT",
          "roleAtCurrentPrice": "PREVIOUS_RESISTANCE_NOW_SUPPORT",
          "proximity": "BELOW",
          "price": 4049.633,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "STRONG",
          "distancePoints": -2.77,
          "distancePercent": -0.07,
          "shortMeaning": "VAH — previous ceiling, potential support after retest",
          "reasons": [
            {
              "code": "VAH",
              "label": "Value Area High (VAH)",
              "explanation": "Price is currently above VAH. VAH is previous resistance that may become support only after a valid hold/retest.",
              "sourceTimeframe": "15"
            }
          ],
          "whatToWatch": [
            "Retest hold above VAH",
            "Failed retest back below VAH"
          ],
          "ifHolds": "A hold above VAH after breakout can turn it into support.",
          "ifBreaks": "A failed hold that closes back below VAH can trap breakout buyers.",
          "confirmationRequired": [
            "Hold above VAH on retest"
          ],
          "nextLevelId": null,
          "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
          "simpleExplanation": "Price is currently above VAH. VAH is previous resistance that may become support only after a valid hold/retest.",
          "confidence": 78
        },
        {
          "id": "lvl-bar-low",
          "side": "DOWNSIDE",
          "kind": "SUPPORT",
          "roleAtCurrentPrice": "SUPPORT",
          "proximity": "BELOW",
          "price": 4048,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MODERATE",
          "distancePoints": -4.4,
          "distancePercent": -0.11,
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
          "nextLevelId": null,
          "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
          "simpleExplanation": "The recent low is the nearest verified support when it sits at or below current price.",
          "confidence": 60
        },
        {
          "id": "lvl-poc",
          "side": "DOWNSIDE",
          "kind": "MAGNET",
          "roleAtCurrentPrice": "MAGNET",
          "proximity": "BELOW",
          "price": 4045.087,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MAJOR",
          "distancePoints": -7.31,
          "distancePercent": -0.18,
          "shortMeaning": "POC — below-price magnet / support decision",
          "reasons": [
            {
              "code": "POC",
              "label": "Point of Control (POC)",
              "explanation": "POC is the busiest traded price — currently below price, acting as a magnet/support decision.",
              "sourceTimeframe": "15"
            }
          ],
          "whatToWatch": [
            "Acceptance through POC",
            "Rejection away from POC"
          ],
          "ifHolds": "Price may bounce from the POC magnet zone.",
          "ifBreaks": "Leaving POC lower can open a move toward VAL or below.",
          "confirmationRequired": [
            "Confirmed close through POC"
          ],
          "nextLevelId": "lvl-val",
          "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
          "simpleExplanation": "POC is the busiest traded price — currently below price, acting as a magnet/support decision.",
          "confidence": 82
        },
        {
          "id": "lvl-atr-low",
          "side": "DOWNSIDE",
          "kind": "STRETCH",
          "roleAtCurrentPrice": "STRETCH_ESTIMATE",
          "proximity": "BELOW",
          "price": 4039.9,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MINOR",
          "distancePoints": -12.5,
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
        },
        {
          "id": "lvl-val",
          "side": "DOWNSIDE",
          "kind": "SUPPORT",
          "roleAtCurrentPrice": "SUPPORT",
          "proximity": "BELOW",
          "price": 4037.308,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "STRONG",
          "distancePoints": -15.09,
          "distancePercent": -0.37,
          "shortMeaning": "Value-area low — floor under value",
          "reasons": [
            {
              "code": "VAL",
              "label": "Value Area Low (VAL)",
              "explanation": "VAL is the lower edge of the value area. While price is at or above VAL, it can act as a floor (support).",
              "sourceTimeframe": "15"
            }
          ],
          "whatToWatch": [
            "Rejection bounce near VAL",
            "Break and hold below VAL"
          ],
          "ifHolds": "Price may bounce from this floor back toward POC/VAH.",
          "ifBreaks": "A break and hold below VAL can open lower downside targets.",
          "confirmationRequired": [
            "Confirmed bounce candle",
            "Or confirmed close below for breakdown"
          ],
          "nextLevelId": "lvl-poc",
          "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
          "simpleExplanation": "VAL is the lower edge of the value area. While price is at or above VAL, it can act as a floor (support).",
          "confidence": 78
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
        "invalidation": "Close back through 4049.633 against the intended side",
        "management": "Wait for confirmation. Do not treat stop/TP references as an active plan.",
        "orderingValid": false,
        "orderingNote": "No trade plan is active.",
        "bullishConditional": {
          "label": "Bullish conditional plan",
          "direction": "BUY",
          "trigger": "Continuation hold above VAH 4049.633",
          "confirmationRequired": [
            "Hold above VAH on retest",
            "Bullish continuation candle"
          ],
          "target1": "4055 — recent bar high",
          "target1Price": 4055,
          "target1Why": "Nearest verified recent bar high beyond the bullish trigger.",
          "target2": "4064.9 — stretch high (estimate)",
          "target2Price": 4064.9,
          "target2Why": "Stretch estimate only — no nearer verified intermediate target.",
          "invalidation": "Close back below 4049.633",
          "invalidationPrice": 4049.633
        },
        "bearishConditional": {
          "label": "Bearish conditional plan",
          "direction": "SELL",
          "trigger": "Breakdown and hold below VAH 4049.633",
          "confirmationRequired": [
            "Confirmed close below VAH",
            "Failed retest from below"
          ],
          "target1": "4048 — recent bar low",
          "target1Price": 4048,
          "target1Why": "Nearest verified recent bar low beyond the bearish trigger.",
          "target2": "4045.09 — POC / volume magnet",
          "target2Price": 4045.09,
          "target2Why": "Verified POC as a downside magnet when below the trigger.",
          "invalidation": "Reclaim and hold above 4049.633",
          "invalidationPrice": 4049.633
        }
      },
      "freshness": {
        "quoteAgeSeconds": 20,
        "signalAgeSeconds": 90,
        "marketStructureMode": "COMPLETE",
        "sourceLabel": "TEST",
        "dataQuality": "GOOD"
      },
      "safety": {
        "autoTrade": "OFF",
        "demoOrderSubmission": false,
        "liveTrading": false,
        "analysisOnly": true
      },
      "disclaimer": "GoldMeta is analysis-only manual assistance for adult traders. AutoTrade stays OFF. No broker orders are submitted. Preview fixture above-vah — not live market data."
    },
    "decision": {
      "lastKnownPrice": 4052.4,
      "ohlcv": {
        "open": 4050,
        "high": 4055,
        "low": 4048,
        "close": 4052.4,
        "volume": 1
      },
      "marketStructure": {
        "poc": 4045.087,
        "vah": 4049.633,
        "val": 4037.308,
        "trend": "BULL",
        "confirmationClassification": "NONE"
      },
      "decision": "WAIT",
      "dataQuality": "GOOD",
      "dataSourceLabel": "TEST",
      "isTestDecision": true,
      "generatedAt": "2026-08-03T19:37:38.949Z",
      "marketDataTime": "2026-08-03T19:37:38.949Z",
      "currentSession": "LONDON"
    }
  },
  {
    "id": "buy-confirmed",
    "title": "Confirmed BUY plan",
    "mode": "COMPLETE",
    "quoteAgeSeconds": 20,
    "signalAgeSeconds": 90,
    "livePrice": 4042,
    "decisionCode": "BUY",
    "plan": {
      "schemaVersion": "1.2",
      "action": "BUY_NOW",
      "actionLabel": "BUY NOW",
      "oneSentence": "Buy plan is active with confirmation — manage risk manually; AutoTrade stays OFF. (LABELLED PREVIEW — buy-confirmed)",
      "trigger": "Buy zone near 4040",
      "triggerPrice": 4040,
      "distanceToTriggerPoints": 2,
      "entryConfirmation": [
        "Plan still valid",
        "Stop and targets reviewed"
      ],
      "invalidation": "Sustained break below 4038 / plan stop",
      "nextTarget": "4045 — POC / volume magnet",
      "nextTargetPrice": 4045,
      "afterThatTarget": "4048 — recent bar high",
      "afterThatTargetPrice": 4048,
      "majorTarget": "4050 — probable high (range)",
      "majorTargetPrice": 4050,
      "whyNotReady": null,
      "valueLocation": "INSIDE_VALUE",
      "setupProgress": {
        "complete": 6,
        "total": 6,
        "label": "6 of 6 conditions complete",
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
            "detail": "Price 4042"
          },
          {
            "id": "bias",
            "label": "Directional bias readable",
            "complete": true,
            "detail": "Decision BUY"
          },
          {
            "id": "confirmation",
            "label": "Entry confirmation candle",
            "complete": true,
            "detail": "Classification BREAKOUT"
          },
          {
            "id": "plan",
            "label": "Entry / stop / targets available",
            "complete": true,
            "detail": "Verified plan levels present"
          },
          {
            "id": "alignment",
            "label": "Price sources aligned",
            "complete": true,
            "detail": "Sources OK"
          }
        ]
      },
      "directionBias": "BULLISH",
      "marketType": "BREAKOUT",
      "session": "LONDON",
      "confidence": 62,
      "expectedRange": {
        "rangeAvailable": true,
        "unavailableReason": null,
        "valueLocation": "INSIDE_VALUE",
        "probableLow": 4038,
        "probableHigh": 4050,
        "stretchLow": 4032,
        "stretchHigh": 4052,
        "currentPrice": 4042,
        "remainingAbovePoints": 8,
        "remainingBelowPoints": 4,
        "remainingAbovePercent": 0.2,
        "remainingBelowPercent": 0.1,
        "confidence": 72,
        "reasons": [
          "Inside value: probable range uses verified VAL → VAH",
          "Stretch targets use approximately one ATR beyond current price / probable bounds"
        ],
        "invalidation": "Recalculate when a new complete strategy signal arrives, when price leaves the stretch band, or when market-structure mode becomes MISMATCH.",
        "estimateDisclaimer": "Probable and stretch prices are estimates only — never guarantees. Markets can move beyond any projected range."
      },
      "bullishScenario": {
        "label": "If price rises",
        "trigger": "Bounce from support 4038",
        "triggerPrice": 4038,
        "confirmationRequired": [
          "Confirmation candle at the bullish trigger",
          "Hold on retest"
        ],
        "firstTarget": "4045 — POC / volume magnet",
        "firstTargetPrice": 4045,
        "firstTargetWhy": "Verified point of control — volume magnet beyond the trigger.",
        "secondTarget": "4048 — recent bar high",
        "secondTargetPrice": 4048,
        "secondTargetWhy": "Nearest verified recent bar high beyond the bullish trigger.",
        "invalidation": "Break and hold below 4038",
        "invalidationPrice": 4038
      },
      "bearishScenario": {
        "label": "If price falls",
        "trigger": "Rejection from resistance 4050",
        "triggerPrice": 4050,
        "confirmationRequired": [
          "Confirmation candle at the bearish trigger",
          "Hold on retest"
        ],
        "firstTarget": "4045 — POC / volume magnet",
        "firstTargetPrice": 4045,
        "firstTargetWhy": "Verified POC as a downside magnet when below the trigger.",
        "secondTarget": "4038 — probable low (range)",
        "secondTargetPrice": 4038,
        "secondTargetWhy": "Expected-range low used only when it is not the same price as the trigger/support break.",
        "invalidation": "Break and hold above 4050",
        "invalidationPrice": 4050
      },
      "zones": {
        "valueLocation": "INSIDE_VALUE",
        "bestBuyZone": "Near VAL 4038 with confirmation",
        "bestBuyImmediate": false,
        "bestBuyConfirmation": "Bullish rejection / hold at VAL",
        "bestBuyInvalidation": "Break and hold below 4038",
        "bestSellZone": "Near VAH 4050 with confirmation",
        "bestSellImmediate": false,
        "bestSellConfirmation": "Bearish rejection / hold at VAH",
        "bestSellInvalidation": "Break and hold above 4050",
        "noTradeZone": "Avoid chasing mid-range near POC 4045 without confirmation",
        "nearestSupport": 4038,
        "nearestResistance": 4048
      },
      "importantLevels": [
        {
          "id": "lvl-tp3",
          "side": "UPSIDE",
          "kind": "STRETCH",
          "roleAtCurrentPrice": "TARGET",
          "proximity": "ABOVE",
          "price": 4060,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MAJOR",
          "distancePoints": 18,
          "distancePercent": 0.45,
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
          "price": 4055,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "STRONG",
          "distancePoints": 13,
          "distancePercent": 0.32,
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
          "id": "lvl-atr-high",
          "side": "UPSIDE",
          "kind": "STRETCH",
          "roleAtCurrentPrice": "STRETCH_ESTIMATE",
          "proximity": "ABOVE",
          "price": 4052,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MINOR",
          "distancePoints": 10,
          "distancePercent": 0.25,
          "shortMeaning": "ATR stretch high (estimate)",
          "reasons": [
            {
              "code": "ATR_PROJECTION",
              "label": "ATR projection",
              "explanation": "Projected roughly one ATR (10) above the current verified price. Estimate only.",
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
          "id": "lvl-vah",
          "side": "UPSIDE",
          "kind": "RESISTANCE",
          "roleAtCurrentPrice": "RESISTANCE",
          "proximity": "ABOVE",
          "price": 4050,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "STRONG",
          "distancePoints": 8,
          "distancePercent": 0.2,
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
          "id": "lvl-tp1",
          "side": "UPSIDE",
          "kind": "TARGET",
          "roleAtCurrentPrice": "TARGET",
          "proximity": "ABOVE",
          "price": 4050,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MODERATE",
          "distancePoints": 8,
          "distancePercent": 0.2,
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
          "id": "lvl-bar-high",
          "side": "UPSIDE",
          "kind": "RESISTANCE",
          "roleAtCurrentPrice": "RESISTANCE",
          "proximity": "ABOVE",
          "price": 4048,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MODERATE",
          "distancePoints": 6,
          "distancePercent": 0.15,
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
          "id": "lvl-poc",
          "side": "UPSIDE",
          "kind": "MAGNET",
          "roleAtCurrentPrice": "MAGNET",
          "proximity": "ABOVE",
          "price": 4045,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MAJOR",
          "distancePoints": 3,
          "distancePercent": 0.07,
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
          "id": "lvl-val",
          "side": "DOWNSIDE",
          "kind": "SUPPORT",
          "roleAtCurrentPrice": "SUPPORT",
          "proximity": "BELOW",
          "price": 4038,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "STRONG",
          "distancePoints": -4,
          "distancePercent": -0.1,
          "shortMeaning": "Value-area low — floor under value",
          "reasons": [
            {
              "code": "VAL",
              "label": "Value Area Low (VAL)",
              "explanation": "VAL is the lower edge of the value area. While price is at or above VAL, it can act as a floor (support).",
              "sourceTimeframe": "15"
            }
          ],
          "whatToWatch": [
            "Rejection bounce near VAL",
            "Break and hold below VAL"
          ],
          "ifHolds": "Price may bounce from this floor back toward POC/VAH.",
          "ifBreaks": "A break and hold below VAL can open lower downside targets.",
          "confirmationRequired": [
            "Confirmed bounce candle",
            "Or confirmed close below for breakdown"
          ],
          "nextLevelId": "lvl-poc",
          "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
          "simpleExplanation": "VAL is the lower edge of the value area. While price is at or above VAL, it can act as a floor (support).",
          "confidence": 78
        },
        {
          "id": "lvl-bar-low",
          "side": "DOWNSIDE",
          "kind": "SUPPORT",
          "roleAtCurrentPrice": "SUPPORT",
          "proximity": "BELOW",
          "price": 4036,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MODERATE",
          "distancePoints": -6,
          "distancePercent": -0.15,
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
          "id": "lvl-atr-low",
          "side": "DOWNSIDE",
          "kind": "STRETCH",
          "roleAtCurrentPrice": "STRETCH_ESTIMATE",
          "proximity": "BELOW",
          "price": 4032,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MINOR",
          "distancePoints": -10,
          "distancePercent": -0.25,
          "shortMeaning": "ATR stretch low (estimate)",
          "reasons": [
            {
              "code": "ATR_PROJECTION",
              "label": "ATR projection",
              "explanation": "Projected roughly one ATR (10) below the current verified price. Estimate only.",
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
        },
        {
          "id": "lvl-stop",
          "side": "DOWNSIDE",
          "kind": "INVALIDATION",
          "roleAtCurrentPrice": "INVALIDATION",
          "proximity": "BELOW",
          "price": 4030,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MAJOR",
          "distancePoints": -12,
          "distancePercent": -0.3,
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
        }
      ],
      "tradePlan": {
        "cardKind": "ACTIVE_PLAN",
        "title": "Manual trade plan",
        "actionable": true,
        "direction": "BUY",
        "entryZone": "4040",
        "stopLoss": 4030,
        "tp1": 4050,
        "tp2": 4055,
        "tp3": 4060,
        "riskReward": "TP1 R≈1 · TP2 R≈1.5 · TP3 R≈2",
        "maxCashRiskNote": "Set cash risk in the Risk planner — GoldMeta never places orders.",
        "positionSizeNote": "Position size is manual. Open Risk planner if you need a size estimate.",
        "invalidation": "Sustained break below 4038 / plan stop",
        "management": "If TP1 is reached manually, consider moving stop toward breakeven. Never average down.",
        "orderingValid": true,
        "orderingNote": null,
        "bullishConditional": null,
        "bearishConditional": null
      },
      "freshness": {
        "quoteAgeSeconds": 20,
        "signalAgeSeconds": 90,
        "marketStructureMode": "COMPLETE",
        "sourceLabel": "TEST",
        "dataQuality": "GOOD"
      },
      "safety": {
        "autoTrade": "OFF",
        "demoOrderSubmission": false,
        "liveTrading": false,
        "analysisOnly": true
      },
      "disclaimer": "GoldMeta is analysis-only manual assistance for adult traders. AutoTrade stays OFF. No broker orders are submitted. Preview fixture buy-confirmed — not live market data."
    },
    "decision": {
      "lastKnownPrice": 4042,
      "ohlcv": {
        "open": 4040,
        "high": 4048,
        "low": 4036,
        "close": 4042,
        "volume": 1
      },
      "marketStructure": {
        "trend": "BULL",
        "poc": 4045,
        "vah": 4050,
        "val": 4038,
        "confirmationClassification": "BREAKOUT"
      },
      "decision": "BUY",
      "dataQuality": "GOOD",
      "dataSourceLabel": "TEST",
      "isTestDecision": true,
      "generatedAt": "2026-08-03T19:37:38.949Z",
      "marketDataTime": "2026-08-03T19:37:38.949Z",
      "currentSession": "LONDON"
    }
  },
  {
    "id": "sell-confirmed",
    "title": "Confirmed SELL plan",
    "mode": "COMPLETE",
    "quoteAgeSeconds": 20,
    "signalAgeSeconds": 90,
    "livePrice": 4042,
    "decisionCode": "SELL",
    "plan": {
      "schemaVersion": "1.2",
      "action": "SELL_ON_REJECTION",
      "actionLabel": "SELL ON REJECTION",
      "oneSentence": "Sell plan is active with confirmation — manage risk manually; AutoTrade stays OFF. (LABELLED PREVIEW — sell-confirmed)",
      "trigger": "Sell zone near 4042",
      "triggerPrice": 4042,
      "distanceToTriggerPoints": 0,
      "entryConfirmation": [
        "Plan still valid",
        "Stop and targets reviewed"
      ],
      "invalidation": "Sustained break above 4050 / plan stop",
      "nextTarget": "4045 — POC / volume magnet",
      "nextTargetPrice": 4045,
      "afterThatTarget": "4048 — recent bar high",
      "afterThatTargetPrice": 4048,
      "majorTarget": "4050 — probable high (range)",
      "majorTargetPrice": 4050,
      "whyNotReady": null,
      "valueLocation": "INSIDE_VALUE",
      "setupProgress": {
        "complete": 6,
        "total": 6,
        "label": "6 of 6 conditions complete",
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
            "detail": "Price 4042"
          },
          {
            "id": "bias",
            "label": "Directional bias readable",
            "complete": true,
            "detail": "Decision SELL"
          },
          {
            "id": "confirmation",
            "label": "Entry confirmation candle",
            "complete": true,
            "detail": "Classification REJECTION"
          },
          {
            "id": "plan",
            "label": "Entry / stop / targets available",
            "complete": true,
            "detail": "Verified plan levels present"
          },
          {
            "id": "alignment",
            "label": "Price sources aligned",
            "complete": true,
            "detail": "Sources OK"
          }
        ]
      },
      "directionBias": "BEARISH",
      "marketType": "PULLBACK",
      "session": "LONDON",
      "confidence": 62,
      "expectedRange": {
        "rangeAvailable": true,
        "unavailableReason": null,
        "valueLocation": "INSIDE_VALUE",
        "probableLow": 4038,
        "probableHigh": 4050,
        "stretchLow": 4032,
        "stretchHigh": 4052,
        "currentPrice": 4042,
        "remainingAbovePoints": 8,
        "remainingBelowPoints": 4,
        "remainingAbovePercent": 0.2,
        "remainingBelowPercent": 0.1,
        "confidence": 72,
        "reasons": [
          "Inside value: probable range uses verified VAL → VAH",
          "Stretch targets use approximately one ATR beyond current price / probable bounds"
        ],
        "invalidation": "Recalculate when a new complete strategy signal arrives, when price leaves the stretch band, or when market-structure mode becomes MISMATCH.",
        "estimateDisclaimer": "Probable and stretch prices are estimates only — never guarantees. Markets can move beyond any projected range."
      },
      "bullishScenario": {
        "label": "If price rises",
        "trigger": "Bounce from support 4038",
        "triggerPrice": 4038,
        "confirmationRequired": [
          "Confirmation candle at the bullish trigger",
          "Hold on retest"
        ],
        "firstTarget": "4045 — POC / volume magnet",
        "firstTargetPrice": 4045,
        "firstTargetWhy": "Verified point of control — volume magnet beyond the trigger.",
        "secondTarget": "4048 — recent bar high",
        "secondTargetPrice": 4048,
        "secondTargetWhy": "Nearest verified recent bar high beyond the bullish trigger.",
        "invalidation": "Break and hold below 4038",
        "invalidationPrice": 4038
      },
      "bearishScenario": {
        "label": "If price falls",
        "trigger": "Rejection from resistance 4050",
        "triggerPrice": 4050,
        "confirmationRequired": [
          "Confirmation candle at the bearish trigger",
          "Hold on retest"
        ],
        "firstTarget": "4045 — POC / volume magnet",
        "firstTargetPrice": 4045,
        "firstTargetWhy": "Verified POC as a downside magnet when below the trigger.",
        "secondTarget": "4038 — recent bar low",
        "secondTargetPrice": 4038,
        "secondTargetWhy": "Nearest verified recent bar low beyond the bearish trigger.",
        "invalidation": "Break and hold above 4050",
        "invalidationPrice": 4050
      },
      "zones": {
        "valueLocation": "INSIDE_VALUE",
        "bestBuyZone": "Near VAL 4038 with confirmation",
        "bestBuyImmediate": false,
        "bestBuyConfirmation": "Bullish rejection / hold at VAL",
        "bestBuyInvalidation": "Break and hold below 4038",
        "bestSellZone": "Near VAH 4050 with confirmation",
        "bestSellImmediate": false,
        "bestSellConfirmation": "Bearish rejection / hold at VAH",
        "bestSellInvalidation": "Break and hold above 4050",
        "noTradeZone": "Avoid chasing mid-range near POC 4045 without confirmation",
        "nearestSupport": 4038,
        "nearestResistance": 4048
      },
      "importantLevels": [
        {
          "id": "lvl-stop",
          "side": "UPSIDE",
          "kind": "INVALIDATION",
          "roleAtCurrentPrice": "INVALIDATION",
          "proximity": "ABOVE",
          "price": 4052,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MAJOR",
          "distancePoints": 10,
          "distancePercent": 0.25,
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
          "id": "lvl-atr-high",
          "side": "UPSIDE",
          "kind": "STRETCH",
          "roleAtCurrentPrice": "STRETCH_ESTIMATE",
          "proximity": "ABOVE",
          "price": 4052,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MINOR",
          "distancePoints": 10,
          "distancePercent": 0.25,
          "shortMeaning": "ATR stretch high (estimate)",
          "reasons": [
            {
              "code": "ATR_PROJECTION",
              "label": "ATR projection",
              "explanation": "Projected roughly one ATR (10) above the current verified price. Estimate only.",
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
          "id": "lvl-vah",
          "side": "UPSIDE",
          "kind": "RESISTANCE",
          "roleAtCurrentPrice": "RESISTANCE",
          "proximity": "ABOVE",
          "price": 4050,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "STRONG",
          "distancePoints": 8,
          "distancePercent": 0.2,
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
          "id": "lvl-bar-high",
          "side": "UPSIDE",
          "kind": "RESISTANCE",
          "roleAtCurrentPrice": "RESISTANCE",
          "proximity": "ABOVE",
          "price": 4048,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MODERATE",
          "distancePoints": 6,
          "distancePercent": 0.15,
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
          "id": "lvl-poc",
          "side": "UPSIDE",
          "kind": "MAGNET",
          "roleAtCurrentPrice": "MAGNET",
          "proximity": "ABOVE",
          "price": 4045,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MAJOR",
          "distancePoints": 3,
          "distancePercent": 0.07,
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
          "id": "lvl-val",
          "side": "DOWNSIDE",
          "kind": "SUPPORT",
          "roleAtCurrentPrice": "SUPPORT",
          "proximity": "BELOW",
          "price": 4038,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "STRONG",
          "distancePoints": -4,
          "distancePercent": -0.1,
          "shortMeaning": "Value-area low — floor under value",
          "reasons": [
            {
              "code": "VAL",
              "label": "Value Area Low (VAL)",
              "explanation": "VAL is the lower edge of the value area. While price is at or above VAL, it can act as a floor (support).",
              "sourceTimeframe": "15"
            }
          ],
          "whatToWatch": [
            "Rejection bounce near VAL",
            "Break and hold below VAL"
          ],
          "ifHolds": "Price may bounce from this floor back toward POC/VAH.",
          "ifBreaks": "A break and hold below VAL can open lower downside targets.",
          "confirmationRequired": [
            "Confirmed bounce candle",
            "Or confirmed close below for breakdown"
          ],
          "nextLevelId": "lvl-poc",
          "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
          "simpleExplanation": "VAL is the lower edge of the value area. While price is at or above VAL, it can act as a floor (support).",
          "confidence": 78
        },
        {
          "id": "lvl-bar-low",
          "side": "DOWNSIDE",
          "kind": "SUPPORT",
          "roleAtCurrentPrice": "SUPPORT",
          "proximity": "BELOW",
          "price": 4038,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MODERATE",
          "distancePoints": -4,
          "distancePercent": -0.1,
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
          "id": "lvl-tp1",
          "side": "DOWNSIDE",
          "kind": "TARGET",
          "roleAtCurrentPrice": "TARGET",
          "proximity": "BELOW",
          "price": 4032,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MODERATE",
          "distancePoints": -10,
          "distancePercent": -0.25,
          "shortMeaning": "Take-profit 1 — first downside target",
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
          "id": "lvl-atr-low",
          "side": "DOWNSIDE",
          "kind": "STRETCH",
          "roleAtCurrentPrice": "STRETCH_ESTIMATE",
          "proximity": "BELOW",
          "price": 4032,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MINOR",
          "distancePoints": -10,
          "distancePercent": -0.25,
          "shortMeaning": "ATR stretch low (estimate)",
          "reasons": [
            {
              "code": "ATR_PROJECTION",
              "label": "ATR projection",
              "explanation": "Projected roughly one ATR (10) below the current verified price. Estimate only.",
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
        },
        {
          "id": "lvl-tp2",
          "side": "DOWNSIDE",
          "kind": "TARGET",
          "roleAtCurrentPrice": "TARGET",
          "proximity": "BELOW",
          "price": 4026,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "STRONG",
          "distancePoints": -16,
          "distancePercent": -0.4,
          "shortMeaning": "Take-profit 2 — extended downside target",
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
          "id": "lvl-tp3",
          "side": "DOWNSIDE",
          "kind": "STRETCH",
          "roleAtCurrentPrice": "TARGET",
          "proximity": "BELOW",
          "price": 4020,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MAJOR",
          "distancePoints": -22,
          "distancePercent": -0.54,
          "shortMeaning": "Stretch downside target (TP3)",
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
        }
      ],
      "tradePlan": {
        "cardKind": "ACTIVE_PLAN",
        "title": "Manual trade plan",
        "actionable": true,
        "direction": "SELL",
        "entryZone": "4042",
        "stopLoss": 4052,
        "tp1": 4032,
        "tp2": 4026,
        "tp3": 4020,
        "riskReward": null,
        "maxCashRiskNote": "Set cash risk in the Risk planner — GoldMeta never places orders.",
        "positionSizeNote": "Position size is manual. Open Risk planner if you need a size estimate.",
        "invalidation": "Sustained break above 4050 / plan stop",
        "management": "If TP1 is reached manually, consider moving stop toward breakeven. Never average down.",
        "orderingValid": true,
        "orderingNote": null,
        "bullishConditional": null,
        "bearishConditional": null
      },
      "freshness": {
        "quoteAgeSeconds": 20,
        "signalAgeSeconds": 90,
        "marketStructureMode": "COMPLETE",
        "sourceLabel": "TEST",
        "dataQuality": "GOOD"
      },
      "safety": {
        "autoTrade": "OFF",
        "demoOrderSubmission": false,
        "liveTrading": false,
        "analysisOnly": true
      },
      "disclaimer": "GoldMeta is analysis-only manual assistance for adult traders. AutoTrade stays OFF. No broker orders are submitted. Preview fixture sell-confirmed — not live market data."
    },
    "decision": {
      "lastKnownPrice": 4042,
      "ohlcv": {
        "open": 4044,
        "high": 4048,
        "low": 4038,
        "close": 4042,
        "volume": 1
      },
      "marketStructure": {
        "trend": "BEAR",
        "poc": 4045,
        "vah": 4050,
        "val": 4038,
        "confirmationClassification": "REJECTION"
      },
      "decision": "SELL",
      "dataQuality": "GOOD",
      "dataSourceLabel": "TEST",
      "isTestDecision": true,
      "generatedAt": "2026-08-03T19:37:38.949Z",
      "marketDataTime": "2026-08-03T19:37:38.949Z",
      "currentSession": "LONDON"
    }
  },
  {
    "id": "range-conditional",
    "title": "RANGE / conditional scenarios",
    "mode": "COMPLETE",
    "quoteAgeSeconds": 20,
    "signalAgeSeconds": 90,
    "livePrice": 4043,
    "decisionCode": "WAIT",
    "plan": {
      "schemaVersion": "1.2",
      "action": "RANGE_TRADE",
      "actionLabel": "RANGE TRADE",
      "oneSentence": "Market is two-sided — prepare both scenarios; do not force a mid-range entry. (LABELLED PREVIEW — range-conditional)",
      "trigger": "Fade extremes between floor 4037.308 and ceiling 4049.633 only with confirmation",
      "triggerPrice": null,
      "distanceToTriggerPoints": null,
      "entryConfirmation": [
        "Rejection at range edge",
        "Or break and hold beyond the edge with follow-through"
      ],
      "invalidation": "Accepted breakout that turns the range into a trend",
      "nextTarget": "4045.09 — POC / volume magnet",
      "nextTargetPrice": 4045.09,
      "afterThatTarget": "4047 — recent bar high",
      "afterThatTargetPrice": 4047,
      "majorTarget": "4049.63 — probable high (range)",
      "majorTargetPrice": 4049.63,
      "whyNotReady": "No one-sided confirmation yet; mid-range entries are low quality.",
      "valueLocation": "INSIDE_VALUE",
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
            "detail": "Price 4043"
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
      "confidence": 62,
      "expectedRange": {
        "rangeAvailable": true,
        "unavailableReason": null,
        "valueLocation": "INSIDE_VALUE",
        "probableLow": 4037.31,
        "probableHigh": 4049.63,
        "stretchLow": 4032,
        "stretchHigh": 4054,
        "currentPrice": 4043,
        "remainingAbovePoints": 6.63,
        "remainingBelowPoints": 5.69,
        "remainingAbovePercent": 0.16,
        "remainingBelowPercent": 0.14,
        "confidence": 72,
        "reasons": [
          "Inside value: probable range uses verified VAL → VAH",
          "Stretch targets use approximately one ATR beyond current price / probable bounds"
        ],
        "invalidation": "Recalculate when a new complete strategy signal arrives, when price leaves the stretch band, or when market-structure mode becomes MISMATCH.",
        "estimateDisclaimer": "Probable and stretch prices are estimates only — never guarantees. Markets can move beyond any projected range."
      },
      "bullishScenario": {
        "label": "If price rises",
        "trigger": "Bounce from support 4037.308",
        "triggerPrice": 4037.308,
        "confirmationRequired": [
          "Confirmation candle at the bullish trigger",
          "Hold on retest"
        ],
        "firstTarget": "4045.09 — POC / volume magnet",
        "firstTargetPrice": 4045.09,
        "firstTargetWhy": "Verified point of control — volume magnet beyond the trigger.",
        "secondTarget": "4047 — recent bar high",
        "secondTargetPrice": 4047,
        "secondTargetWhy": "Nearest verified recent bar high beyond the bullish trigger.",
        "invalidation": "Break and hold below 4037.308",
        "invalidationPrice": 4037.308
      },
      "bearishScenario": {
        "label": "If price falls",
        "trigger": "Rejection from resistance 4049.633",
        "triggerPrice": 4049.633,
        "confirmationRequired": [
          "Confirmation candle at the bearish trigger",
          "Hold on retest"
        ],
        "firstTarget": "4045.09 — POC / volume magnet",
        "firstTargetPrice": 4045.09,
        "firstTargetWhy": "Verified POC as a downside magnet when below the trigger.",
        "secondTarget": "4039 — recent bar low",
        "secondTargetPrice": 4039,
        "secondTargetWhy": "Nearest verified recent bar low beyond the bearish trigger.",
        "invalidation": "Break and hold above 4049.633",
        "invalidationPrice": 4049.633
      },
      "zones": {
        "valueLocation": "INSIDE_VALUE",
        "bestBuyZone": "Near VAL 4037.308 with confirmation",
        "bestBuyImmediate": false,
        "bestBuyConfirmation": "Bullish rejection / hold at VAL",
        "bestBuyInvalidation": "Break and hold below 4037.308",
        "bestSellZone": "Near VAH 4049.633 with confirmation",
        "bestSellImmediate": false,
        "bestSellConfirmation": "Bearish rejection / hold at VAH",
        "bestSellInvalidation": "Break and hold above 4049.633",
        "noTradeZone": "Avoid chasing mid-range near POC 4045.087 without confirmation",
        "nearestSupport": 4039,
        "nearestResistance": 4047
      },
      "importantLevels": [
        {
          "id": "lvl-atr-high",
          "side": "UPSIDE",
          "kind": "STRETCH",
          "roleAtCurrentPrice": "STRETCH_ESTIMATE",
          "proximity": "ABOVE",
          "price": 4054,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MINOR",
          "distancePoints": 11,
          "distancePercent": 0.27,
          "shortMeaning": "ATR stretch high (estimate)",
          "reasons": [
            {
              "code": "ATR_PROJECTION",
              "label": "ATR projection",
              "explanation": "Projected roughly one ATR (11) above the current verified price. Estimate only.",
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
          "id": "lvl-vah",
          "side": "UPSIDE",
          "kind": "RESISTANCE",
          "roleAtCurrentPrice": "RESISTANCE",
          "proximity": "ABOVE",
          "price": 4049.633,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "STRONG",
          "distancePoints": 6.63,
          "distancePercent": 0.16,
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
          "id": "lvl-bar-high",
          "side": "UPSIDE",
          "kind": "RESISTANCE",
          "roleAtCurrentPrice": "RESISTANCE",
          "proximity": "ABOVE",
          "price": 4047,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MODERATE",
          "distancePoints": 4,
          "distancePercent": 0.1,
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
          "id": "lvl-poc",
          "side": "UPSIDE",
          "kind": "MAGNET",
          "roleAtCurrentPrice": "MAGNET",
          "proximity": "ABOVE",
          "price": 4045.087,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MAJOR",
          "distancePoints": 2.09,
          "distancePercent": 0.05,
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
          "id": "lvl-bar-low",
          "side": "DOWNSIDE",
          "kind": "SUPPORT",
          "roleAtCurrentPrice": "SUPPORT",
          "proximity": "BELOW",
          "price": 4039,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MODERATE",
          "distancePoints": -4,
          "distancePercent": -0.1,
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
          "nextLevelId": null,
          "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
          "simpleExplanation": "The recent low is the nearest verified support when it sits at or below current price.",
          "confidence": 60
        },
        {
          "id": "lvl-val",
          "side": "DOWNSIDE",
          "kind": "SUPPORT",
          "roleAtCurrentPrice": "SUPPORT",
          "proximity": "BELOW",
          "price": 4037.308,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "STRONG",
          "distancePoints": -5.69,
          "distancePercent": -0.14,
          "shortMeaning": "Value-area low — floor under value",
          "reasons": [
            {
              "code": "VAL",
              "label": "Value Area Low (VAL)",
              "explanation": "VAL is the lower edge of the value area. While price is at or above VAL, it can act as a floor (support).",
              "sourceTimeframe": "15"
            }
          ],
          "whatToWatch": [
            "Rejection bounce near VAL",
            "Break and hold below VAL"
          ],
          "ifHolds": "Price may bounce from this floor back toward POC/VAH.",
          "ifBreaks": "A break and hold below VAL can open lower downside targets.",
          "confirmationRequired": [
            "Confirmed bounce candle",
            "Or confirmed close below for breakdown"
          ],
          "nextLevelId": "lvl-poc",
          "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
          "simpleExplanation": "VAL is the lower edge of the value area. While price is at or above VAL, it can act as a floor (support).",
          "confidence": 78
        },
        {
          "id": "lvl-atr-low",
          "side": "DOWNSIDE",
          "kind": "STRETCH",
          "roleAtCurrentPrice": "STRETCH_ESTIMATE",
          "proximity": "BELOW",
          "price": 4032,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MINOR",
          "distancePoints": -11,
          "distancePercent": -0.27,
          "shortMeaning": "ATR stretch low (estimate)",
          "reasons": [
            {
              "code": "ATR_PROJECTION",
              "label": "ATR projection",
              "explanation": "Projected roughly one ATR (11) below the current verified price. Estimate only.",
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
        "invalidation": "Accepted breakout that turns the range into a trend",
        "management": "Wait for confirmation. Do not treat stop/TP references as an active plan.",
        "orderingValid": false,
        "orderingNote": "No trade plan is active.",
        "bullishConditional": {
          "label": "Bullish conditional plan",
          "direction": "BUY",
          "trigger": "Bounce from support 4037.308",
          "confirmationRequired": [
            "Confirmation candle at the bullish trigger",
            "Hold on retest"
          ],
          "target1": "4045.09 — POC / volume magnet",
          "target1Price": 4045.09,
          "target1Why": "Verified point of control — volume magnet beyond the trigger.",
          "target2": "4047 — recent bar high",
          "target2Price": 4047,
          "target2Why": "Nearest verified recent bar high beyond the bullish trigger.",
          "invalidation": "Break and hold below 4037.308",
          "invalidationPrice": 4037.308
        },
        "bearishConditional": {
          "label": "Bearish conditional plan",
          "direction": "SELL",
          "trigger": "Rejection from resistance 4049.633",
          "confirmationRequired": [
            "Confirmation candle at the bearish trigger",
            "Hold on retest"
          ],
          "target1": "4045.09 — POC / volume magnet",
          "target1Price": 4045.09,
          "target1Why": "Verified POC as a downside magnet when below the trigger.",
          "target2": "4039 — recent bar low",
          "target2Price": 4039,
          "target2Why": "Nearest verified recent bar low beyond the bearish trigger.",
          "invalidation": "Break and hold above 4049.633",
          "invalidationPrice": 4049.633
        }
      },
      "freshness": {
        "quoteAgeSeconds": 20,
        "signalAgeSeconds": 90,
        "marketStructureMode": "COMPLETE",
        "sourceLabel": "TEST",
        "dataQuality": "GOOD"
      },
      "safety": {
        "autoTrade": "OFF",
        "demoOrderSubmission": false,
        "liveTrading": false,
        "analysisOnly": true
      },
      "disclaimer": "GoldMeta is analysis-only manual assistance for adult traders. AutoTrade stays OFF. No broker orders are submitted. Preview fixture range-conditional — not live market data."
    },
    "decision": {
      "lastKnownPrice": 4043,
      "ohlcv": {
        "open": 4041,
        "high": 4047,
        "low": 4039,
        "close": 4043,
        "volume": 1
      },
      "marketStructure": {
        "trend": "RANGE",
        "poc": 4045.087,
        "vah": 4049.633,
        "val": 4037.308,
        "confirmationClassification": "NONE"
      },
      "decision": "WAIT",
      "dataQuality": "GOOD",
      "dataSourceLabel": "TEST",
      "isTestDecision": true,
      "generatedAt": "2026-08-03T19:37:38.950Z",
      "marketDataTime": "2026-08-03T19:37:38.950Z",
      "currentSession": "LONDON"
    }
  },
  {
    "id": "mismatch",
    "title": "MISMATCH",
    "mode": "MISMATCH",
    "quoteAgeSeconds": 20,
    "signalAgeSeconds": 90,
    "livePrice": 2408,
    "decisionCode": "WAIT",
    "plan": {
      "schemaVersion": "1.2",
      "action": "NO_TRADE",
      "actionLabel": "NO TRADE",
      "oneSentence": "Do not trade — price sources disagree, so levels cannot be combined safely. (LABELLED PREVIEW — mismatch)",
      "trigger": null,
      "triggerPrice": null,
      "distanceToTriggerPoints": null,
      "entryConfirmation": [
        "Wait until alert and live/structure prices agree again"
      ],
      "invalidation": "Any new mismatched complete signal keeps trading blocked.",
      "nextTarget": null,
      "nextTargetPrice": null,
      "afterThatTarget": null,
      "afterThatTargetPrice": null,
      "majorTarget": null,
      "majorTargetPrice": null,
      "whyNotReady": "Market data mismatch between the live quote and the stored strategy signal.",
      "valueLocation": "UNKNOWN",
      "setupProgress": {
        "complete": 1,
        "total": 6,
        "label": "1 of 6 conditions complete",
        "items": [
          {
            "id": "structure",
            "label": "Complete market structure (POC/VAH/VAL)",
            "complete": false,
            "detail": "Mode is MISMATCH — structure incomplete or mismatched"
          },
          {
            "id": "fresh-quote",
            "label": "Fresh live / last price",
            "complete": true,
            "detail": "Price 2408"
          },
          {
            "id": "bias",
            "label": "Directional bias readable",
            "complete": false,
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
            "complete": false,
            "detail": "Market data mismatch — do not combine levels"
          }
        ]
      },
      "directionBias": "NEUTRAL",
      "marketType": "RANGE",
      "session": "LONDON",
      "confidence": 62,
      "expectedRange": {
        "rangeAvailable": false,
        "unavailableReason": "Range unavailable — market data mismatch blocks combining levels.",
        "valueLocation": "UNKNOWN",
        "probableLow": null,
        "probableHigh": null,
        "stretchLow": null,
        "stretchHigh": null,
        "currentPrice": 2408,
        "remainingAbovePoints": null,
        "remainingBelowPoints": null,
        "remainingAbovePercent": null,
        "remainingBelowPercent": null,
        "confidence": 0,
        "reasons": [
          "Range unavailable — market data mismatch blocks combining levels."
        ],
        "invalidation": "Recalculate when a trustworthy range around current price can be formed.",
        "estimateDisclaimer": "Probable and stretch prices are estimates only — never guarantees. Markets can move beyond any projected range."
      },
      "bullishScenario": {
        "label": "If price rises",
        "trigger": "Bullish confirmation at structure",
        "triggerPrice": null,
        "confirmationRequired": [
          "Confirmation candle at the bullish trigger",
          "Hold on retest"
        ],
        "firstTarget": "Unavailable",
        "firstTargetPrice": null,
        "firstTargetWhy": "No verified intermediate target is available beyond the trigger — do not invent a price.",
        "secondTarget": "Unavailable",
        "secondTargetPrice": null,
        "secondTargetWhy": null,
        "invalidation": "Plan stop breach",
        "invalidationPrice": null
      },
      "bearishScenario": {
        "label": "If price falls",
        "trigger": "Bearish confirmation at structure",
        "triggerPrice": null,
        "confirmationRequired": [
          "Confirmation candle at the bearish trigger",
          "Hold on retest"
        ],
        "firstTarget": "Unavailable",
        "firstTargetPrice": null,
        "firstTargetWhy": "No verified intermediate target is available beyond the trigger — do not invent a price.",
        "secondTarget": "Unavailable",
        "secondTargetPrice": null,
        "secondTargetWhy": null,
        "invalidation": "Plan stop breach",
        "invalidationPrice": null
      },
      "zones": {
        "valueLocation": "UNKNOWN",
        "bestBuyZone": null,
        "bestBuyImmediate": false,
        "bestBuyConfirmation": null,
        "bestBuyInvalidation": null,
        "bestSellZone": null,
        "bestSellImmediate": false,
        "bestSellConfirmation": null,
        "bestSellInvalidation": null,
        "noTradeZone": "Avoid mid-range entries without confirmation",
        "nearestSupport": 2396,
        "nearestResistance": null
      },
      "importantLevels": [],
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
        "invalidation": "Any new mismatched complete signal keeps trading blocked.",
        "management": "Wait for confirmation. Do not treat stop/TP references as an active plan.",
        "orderingValid": false,
        "orderingNote": "No trade plan is active.",
        "bullishConditional": {
          "label": "Bullish conditional plan",
          "direction": "BUY",
          "trigger": "Bullish confirmation at structure",
          "confirmationRequired": [
            "Confirmation candle at the bullish trigger",
            "Hold on retest"
          ],
          "target1": "Unavailable",
          "target1Price": null,
          "target1Why": "No verified intermediate target is available beyond the trigger — do not invent a price.",
          "target2": "Unavailable",
          "target2Price": null,
          "target2Why": null,
          "invalidation": "Plan stop breach",
          "invalidationPrice": null
        },
        "bearishConditional": {
          "label": "Bearish conditional plan",
          "direction": "SELL",
          "trigger": "Bearish confirmation at structure",
          "confirmationRequired": [
            "Confirmation candle at the bearish trigger",
            "Hold on retest"
          ],
          "target1": "Unavailable",
          "target1Price": null,
          "target1Why": "No verified intermediate target is available beyond the trigger — do not invent a price.",
          "target2": "Unavailable",
          "target2Price": null,
          "target2Why": null,
          "invalidation": "Plan stop breach",
          "invalidationPrice": null
        }
      },
      "freshness": {
        "quoteAgeSeconds": 20,
        "signalAgeSeconds": 90,
        "marketStructureMode": "MISMATCH",
        "sourceLabel": "TEST",
        "dataQuality": "CONFLICTED"
      },
      "safety": {
        "autoTrade": "OFF",
        "demoOrderSubmission": false,
        "liveTrading": false,
        "analysisOnly": true
      },
      "disclaimer": "GoldMeta is analysis-only manual assistance for adult traders. AutoTrade stays OFF. No broker orders are submitted. Preview fixture mismatch — not live market data."
    },
    "decision": {
      "lastKnownPrice": 2408,
      "ohlcv": {
        "open": 2400,
        "high": 2412,
        "low": 2396,
        "close": 2408,
        "volume": 1
      },
      "marketStructure": {
        "trend": "RANGE",
        "poc": 2408,
        "vah": 2415,
        "val": 2400,
        "confirmationClassification": "NONE"
      },
      "decision": "WAIT",
      "dataQuality": "CONFLICTED",
      "dataSourceLabel": "TEST",
      "isTestDecision": true,
      "generatedAt": "2026-08-03T19:37:38.950Z",
      "marketDataTime": "2026-08-03T19:37:38.950Z",
      "currentSession": "LONDON"
    }
  },
  {
    "id": "live-range-only",
    "title": "LIVE_RANGE_ONLY / OHLC-only",
    "mode": "LIVE_RANGE_ONLY",
    "quoteAgeSeconds": 20,
    "signalAgeSeconds": 90,
    "livePrice": 4034.8,
    "decisionCode": "WAIT",
    "plan": {
      "schemaVersion": "1.2",
      "action": "PREPARE",
      "actionLabel": "PREPARE — SETUP FORMING",
      "oneSentence": "Setup forming — live price is available but complete structure is not. (LABELLED PREVIEW — live-range-only)",
      "trigger": "Wait for the next complete strategy signal with POC/VAH/VAL",
      "triggerPrice": null,
      "distanceToTriggerPoints": null,
      "entryConfirmation": [
        "Complete strategy alert with POC/VAH/VAL",
        "Price-source consistency check"
      ],
      "invalidation": "A MISMATCH between quote and structure blocks planning.",
      "nextTarget": "4041.2 — recent bar high",
      "nextTargetPrice": 4041.2,
      "afterThatTarget": "4047.3 — stretch high (estimate)",
      "afterThatTargetPrice": 4047.3,
      "majorTarget": null,
      "majorTargetPrice": null,
      "whyNotReady": "OHLC-only updates cannot create an entry plan without verified structure levels.",
      "valueLocation": "UNKNOWN",
      "setupProgress": {
        "complete": 2,
        "total": 6,
        "label": "2 of 6 conditions complete",
        "items": [
          {
            "id": "structure",
            "label": "Complete market structure (POC/VAH/VAL)",
            "complete": false,
            "detail": "Mode is LIVE_RANGE_ONLY — structure incomplete or mismatched"
          },
          {
            "id": "fresh-quote",
            "label": "Fresh live / last price",
            "complete": true,
            "detail": "Price 4034.8"
          },
          {
            "id": "bias",
            "label": "Directional bias readable",
            "complete": false,
            "detail": "Decision WAIT"
          },
          {
            "id": "confirmation",
            "label": "Entry confirmation candle",
            "complete": false,
            "detail": "No confirmation yet"
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
      "marketType": "UNKNOWN",
      "session": "LONDON",
      "confidence": 62,
      "expectedRange": {
        "rangeAvailable": true,
        "unavailableReason": null,
        "valueLocation": "UNKNOWN",
        "probableLow": 4031.1,
        "probableHigh": 4041.2,
        "stretchLow": 4022.3,
        "stretchHigh": 4047.3,
        "currentPrice": 4034.8,
        "remainingAbovePoints": 6.4,
        "remainingBelowPoints": 3.7,
        "remainingAbovePercent": 0.16,
        "remainingBelowPercent": 0.09,
        "confidence": 40,
        "reasons": [
          "OHLC/unknown value location: probable range uses bar high/low around current price",
          "Stretch targets use approximately one ATR beyond current price / probable bounds"
        ],
        "invalidation": "Recalculate when a new complete strategy signal arrives, when price leaves the stretch band, or when market-structure mode becomes MISMATCH.",
        "estimateDisclaimer": "Probable and stretch prices are estimates only — never guarantees. Markets can move beyond any projected range."
      },
      "bullishScenario": {
        "label": "If price rises",
        "trigger": "Bounce from support 4031.1",
        "triggerPrice": 4031.1,
        "confirmationRequired": [
          "Confirmation candle at the bullish trigger",
          "Hold on retest"
        ],
        "firstTarget": "4041.2 — recent bar high",
        "firstTargetPrice": 4041.2,
        "firstTargetWhy": "Nearest verified recent bar high beyond the bullish trigger.",
        "secondTarget": "4047.3 — stretch high (estimate)",
        "secondTargetPrice": 4047.3,
        "secondTargetWhy": "Stretch estimate only — no nearer verified intermediate target.",
        "invalidation": "Break and hold below 4031.1",
        "invalidationPrice": 4031.1
      },
      "bearishScenario": {
        "label": "If price falls",
        "trigger": "Rejection from resistance 4041.2",
        "triggerPrice": 4041.2,
        "confirmationRequired": [
          "Confirmation candle at the bearish trigger",
          "Hold on retest"
        ],
        "firstTarget": "4031.1 — recent bar low",
        "firstTargetPrice": 4031.1,
        "firstTargetWhy": "Nearest verified recent bar low beyond the bearish trigger.",
        "secondTarget": "4022.3 — stretch low (estimate)",
        "secondTargetPrice": 4022.3,
        "secondTargetWhy": "Stretch estimate only — no nearer verified intermediate target.",
        "invalidation": "Break and hold above 4041.2",
        "invalidationPrice": 4041.2
      },
      "zones": {
        "valueLocation": "UNKNOWN",
        "bestBuyZone": null,
        "bestBuyImmediate": false,
        "bestBuyConfirmation": null,
        "bestBuyInvalidation": null,
        "bestSellZone": null,
        "bestSellImmediate": false,
        "bestSellConfirmation": null,
        "bestSellInvalidation": null,
        "noTradeZone": "Avoid mid-range entries without confirmation",
        "nearestSupport": 4031.1,
        "nearestResistance": 4041.2
      },
      "importantLevels": [
        {
          "id": "lvl-atr-high",
          "side": "UPSIDE",
          "kind": "STRETCH",
          "roleAtCurrentPrice": "STRETCH_ESTIMATE",
          "proximity": "ABOVE",
          "price": 4047.3,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MINOR",
          "distancePoints": 12.5,
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
          "id": "lvl-bar-high",
          "side": "UPSIDE",
          "kind": "RESISTANCE",
          "roleAtCurrentPrice": "RESISTANCE",
          "proximity": "ABOVE",
          "price": 4041.2,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MODERATE",
          "distancePoints": 6.4,
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
          "nextLevelId": null,
          "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
          "simpleExplanation": "The recent high is a nearby reference until buyers or sellers prove control.",
          "confidence": 60
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
          "distancePoints": -3.7,
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
          "nextLevelId": null,
          "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
          "simpleExplanation": "The recent low is the nearest verified support when it sits at or below current price.",
          "confidence": 60
        },
        {
          "id": "lvl-atr-low",
          "side": "DOWNSIDE",
          "kind": "STRETCH",
          "roleAtCurrentPrice": "STRETCH_ESTIMATE",
          "proximity": "BELOW",
          "price": 4022.3,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MINOR",
          "distancePoints": -12.5,
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
        "invalidation": "A MISMATCH between quote and structure blocks planning.",
        "management": "Wait for confirmation. Do not treat stop/TP references as an active plan.",
        "orderingValid": false,
        "orderingNote": "No trade plan is active.",
        "bullishConditional": {
          "label": "Bullish conditional plan",
          "direction": "BUY",
          "trigger": "Bounce from support 4031.1",
          "confirmationRequired": [
            "Confirmation candle at the bullish trigger",
            "Hold on retest"
          ],
          "target1": "4041.2 — recent bar high",
          "target1Price": 4041.2,
          "target1Why": "Nearest verified recent bar high beyond the bullish trigger.",
          "target2": "4047.3 — stretch high (estimate)",
          "target2Price": 4047.3,
          "target2Why": "Stretch estimate only — no nearer verified intermediate target.",
          "invalidation": "Break and hold below 4031.1",
          "invalidationPrice": 4031.1
        },
        "bearishConditional": {
          "label": "Bearish conditional plan",
          "direction": "SELL",
          "trigger": "Rejection from resistance 4041.2",
          "confirmationRequired": [
            "Confirmation candle at the bearish trigger",
            "Hold on retest"
          ],
          "target1": "4031.1 — recent bar low",
          "target1Price": 4031.1,
          "target1Why": "Nearest verified recent bar low beyond the bearish trigger.",
          "target2": "4022.3 — stretch low (estimate)",
          "target2Price": 4022.3,
          "target2Why": "Stretch estimate only — no nearer verified intermediate target.",
          "invalidation": "Break and hold above 4041.2",
          "invalidationPrice": 4041.2
        }
      },
      "freshness": {
        "quoteAgeSeconds": 20,
        "signalAgeSeconds": 90,
        "marketStructureMode": "LIVE_RANGE_ONLY",
        "sourceLabel": "TEST",
        "dataQuality": "GOOD"
      },
      "safety": {
        "autoTrade": "OFF",
        "demoOrderSubmission": false,
        "liveTrading": false,
        "analysisOnly": true
      },
      "disclaimer": "GoldMeta is analysis-only manual assistance for adult traders. AutoTrade stays OFF. No broker orders are submitted. Preview fixture live-range-only — not live market data."
    },
    "decision": {
      "lastKnownPrice": 4034.8,
      "ohlcv": {
        "open": 4036,
        "high": 4041.2,
        "low": 4031.1,
        "close": 4034.8,
        "volume": 1
      },
      "marketStructure": null,
      "decision": "WAIT",
      "dataQuality": "GOOD",
      "dataSourceLabel": "TEST",
      "isTestDecision": true,
      "generatedAt": "2026-08-03T19:37:38.950Z",
      "marketDataTime": "2026-08-03T19:37:38.950Z",
      "currentSession": "LONDON"
    }
  },
  {
    "id": "missing-atr",
    "title": "Missing ATR",
    "mode": "COMPLETE",
    "quoteAgeSeconds": 20,
    "signalAgeSeconds": 90,
    "livePrice": 4034.815,
    "decisionCode": "WAIT",
    "plan": {
      "schemaVersion": "1.2",
      "action": "PREPARE",
      "actionLabel": "PREPARE — SETUP FORMING",
      "oneSentence": "Price is below value. VAL 4037.308 is the first reclaim/overhead resistance. A bullish plan requires a reclaim and hold above VAL; a failed reclaim may support bearish continuation. (LABELLED PREVIEW — missing-atr)",
      "trigger": "Reclaim and hold above VAL 4037.308",
      "triggerPrice": 4037.308,
      "distanceToTriggerPoints": 2.49,
      "entryConfirmation": [
        "Confirmed close above VAL for bullish reclaim",
        "Or rejection/failed reclaim for bearish continuation",
        "Do not treat VAL as a floor while it remains above price"
      ],
      "invalidation": "Break and hold below 4031.1 ends the immediate reclaim attempt",
      "nextTarget": "4041.2 — recent bar high",
      "nextTargetPrice": 4041.2,
      "afterThatTarget": "4045.09 — POC / volume magnet",
      "afterThatTargetPrice": 4045.09,
      "majorTarget": "4049.63 — VAH",
      "majorTargetPrice": 4049.63,
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
      "confidence": 62,
      "expectedRange": {
        "rangeAvailable": true,
        "unavailableReason": null,
        "valueLocation": "BELOW_VALUE",
        "probableLow": 4031.1,
        "probableHigh": 4037.31,
        "stretchLow": 4028.93,
        "stretchHigh": 4039.48,
        "currentPrice": 4034.815,
        "remainingAbovePoints": 2.49,
        "remainingBelowPoints": 3.72,
        "remainingAbovePercent": 0.06,
        "remainingBelowPercent": 0.09,
        "confidence": 58,
        "reasons": [
          "Below value: probable low from verified bar/ATR support at or below price; probable high is VAL reclaim resistance",
          "Stretch targets extend ~35% beyond the probable range width"
        ],
        "invalidation": "Recalculate when a new complete strategy signal arrives, when price leaves the stretch band, or when market-structure mode becomes MISMATCH.",
        "estimateDisclaimer": "Probable and stretch prices are estimates only — never guarantees. Markets can move beyond any projected range."
      },
      "bullishScenario": {
        "label": "If price rises",
        "trigger": "Reclaim and hold above VAL 4037.308",
        "triggerPrice": 4037.308,
        "confirmationRequired": [
          "5-minute candle closes above VAL",
          "Retest holds above VAL"
        ],
        "firstTarget": "4041.2 — recent bar high",
        "firstTargetPrice": 4041.2,
        "firstTargetWhy": "Nearest verified recent bar high beyond the bullish trigger.",
        "secondTarget": "4045.09 — POC / volume magnet",
        "secondTargetPrice": 4045.09,
        "secondTargetWhy": "Verified point of control — volume magnet beyond the trigger.",
        "invalidation": "Break and hold below 4031.1",
        "invalidationPrice": 4031.1
      },
      "bearishScenario": {
        "label": "If price falls",
        "trigger": "Break and hold below 4031.1",
        "triggerPrice": 4031.1,
        "confirmationRequired": [
          "5-minute candle closes below the support trigger",
          "Hold below on retest"
        ],
        "firstTarget": "Unavailable",
        "firstTargetPrice": null,
        "firstTargetWhy": "No verified intermediate target is available beyond the trigger — do not invent a price.",
        "secondTarget": "4028.93 — stretch low (estimate)",
        "secondTargetPrice": 4028.93,
        "secondTargetWhy": "Stretch estimate only — no nearer verified intermediate target.",
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
          "nextLevelId": null,
          "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
          "simpleExplanation": "The recent low is the nearest verified support when it sits at or below current price.",
          "confidence": 60
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
          "confirmationRequired": [
            "5-minute candle closes above VAL",
            "Retest holds above VAL"
          ],
          "target1": "4041.2 — recent bar high",
          "target1Price": 4041.2,
          "target1Why": "Nearest verified recent bar high beyond the bullish trigger.",
          "target2": "4045.09 — POC / volume magnet",
          "target2Price": 4045.09,
          "target2Why": "Verified point of control — volume magnet beyond the trigger.",
          "invalidation": "Break and hold below 4031.1",
          "invalidationPrice": 4031.1
        },
        "bearishConditional": {
          "label": "Bearish conditional plan",
          "direction": "SELL",
          "trigger": "Break and hold below 4031.1",
          "confirmationRequired": [
            "5-minute candle closes below the support trigger",
            "Hold below on retest"
          ],
          "target1": "Unavailable",
          "target1Price": null,
          "target1Why": "No verified intermediate target is available beyond the trigger — do not invent a price.",
          "target2": "4028.93 — stretch low (estimate)",
          "target2Price": 4028.93,
          "target2Why": "Stretch estimate only — no nearer verified intermediate target.",
          "invalidation": "Reclaim and hold above 4037.308",
          "invalidationPrice": 4037.308
        }
      },
      "freshness": {
        "quoteAgeSeconds": 20,
        "signalAgeSeconds": 90,
        "marketStructureMode": "COMPLETE",
        "sourceLabel": "TEST",
        "dataQuality": "GOOD"
      },
      "safety": {
        "autoTrade": "OFF",
        "demoOrderSubmission": false,
        "liveTrading": false,
        "analysisOnly": true
      },
      "disclaimer": "GoldMeta is analysis-only manual assistance for adult traders. AutoTrade stays OFF. No broker orders are submitted. Preview fixture missing-atr — not live market data."
    },
    "decision": {
      "lastKnownPrice": 4034.815,
      "ohlcv": {
        "open": 4036,
        "high": 4041.2,
        "low": 4031.1,
        "close": 4034.815,
        "volume": 1
      },
      "marketStructure": {
        "poc": 4045.087,
        "vah": 4049.633,
        "val": 4037.308,
        "trend": "RANGE",
        "confirmationClassification": "NONE"
      },
      "decision": "WAIT",
      "dataQuality": "GOOD",
      "dataSourceLabel": "TEST",
      "isTestDecision": true,
      "generatedAt": "2026-08-03T19:37:38.950Z",
      "marketDataTime": "2026-08-03T19:37:38.950Z",
      "currentSession": "LONDON"
    }
  },
  {
    "id": "missing-structure",
    "title": "Missing POC, VAH or VAL",
    "mode": "COMPLETE",
    "quoteAgeSeconds": 20,
    "signalAgeSeconds": 90,
    "livePrice": 4034.815,
    "decisionCode": "WAIT",
    "plan": {
      "schemaVersion": "1.2",
      "action": "PREPARE",
      "actionLabel": "PREPARE — SETUP FORMING",
      "oneSentence": "Setup forming — GoldMeta is watching levels but entry is not ready. (LABELLED PREVIEW — missing-structure)",
      "trigger": "Wait for the next confirmed structure interaction",
      "triggerPrice": null,
      "distanceToTriggerPoints": null,
      "entryConfirmation": [
        "Clear trigger touch",
        "Confirmation candle",
        "Aligned structure"
      ],
      "invalidation": "Mode change to MISMATCH or loss of verified structure",
      "nextTarget": "4041.2 — recent bar high",
      "nextTargetPrice": 4041.2,
      "afterThatTarget": "4047.32 — stretch high (estimate)",
      "afterThatTargetPrice": 4047.32,
      "majorTarget": null,
      "majorTargetPrice": null,
      "whyNotReady": "Confirmation and/or complete plan conditions are still incomplete.",
      "valueLocation": "UNKNOWN",
      "setupProgress": {
        "complete": 3,
        "total": 6,
        "label": "3 of 6 conditions complete",
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
            "complete": false,
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
      "confidence": 62,
      "expectedRange": {
        "rangeAvailable": true,
        "unavailableReason": null,
        "valueLocation": "UNKNOWN",
        "probableLow": 4031.1,
        "probableHigh": 4041.2,
        "stretchLow": 4022.32,
        "stretchHigh": 4047.32,
        "currentPrice": 4034.815,
        "remainingAbovePoints": 6.38,
        "remainingBelowPoints": 3.72,
        "remainingAbovePercent": 0.16,
        "remainingBelowPercent": 0.09,
        "confidence": 58,
        "reasons": [
          "OHLC/unknown value location: probable range uses bar high/low around current price",
          "Stretch targets use approximately one ATR beyond current price / probable bounds"
        ],
        "invalidation": "Recalculate when a new complete strategy signal arrives, when price leaves the stretch band, or when market-structure mode becomes MISMATCH.",
        "estimateDisclaimer": "Probable and stretch prices are estimates only — never guarantees. Markets can move beyond any projected range."
      },
      "bullishScenario": {
        "label": "If price rises",
        "trigger": "Bounce from support 4031.1",
        "triggerPrice": 4031.1,
        "confirmationRequired": [
          "Confirmation candle at the bullish trigger",
          "Hold on retest"
        ],
        "firstTarget": "4041.2 — recent bar high",
        "firstTargetPrice": 4041.2,
        "firstTargetWhy": "Nearest verified recent bar high beyond the bullish trigger.",
        "secondTarget": "4047.32 — stretch high (estimate)",
        "secondTargetPrice": 4047.32,
        "secondTargetWhy": "Stretch estimate only — no nearer verified intermediate target.",
        "invalidation": "Break and hold below 4031.1",
        "invalidationPrice": 4031.1
      },
      "bearishScenario": {
        "label": "If price falls",
        "trigger": "Rejection from resistance 4041.2",
        "triggerPrice": 4041.2,
        "confirmationRequired": [
          "Confirmation candle at the bearish trigger",
          "Hold on retest"
        ],
        "firstTarget": "4031.1 — recent bar low",
        "firstTargetPrice": 4031.1,
        "firstTargetWhy": "Nearest verified recent bar low beyond the bearish trigger.",
        "secondTarget": "4022.32 — stretch low (estimate)",
        "secondTargetPrice": 4022.32,
        "secondTargetWhy": "Stretch estimate only — no nearer verified intermediate target.",
        "invalidation": "Break and hold above 4041.2",
        "invalidationPrice": 4041.2
      },
      "zones": {
        "valueLocation": "UNKNOWN",
        "bestBuyZone": null,
        "bestBuyImmediate": false,
        "bestBuyConfirmation": null,
        "bestBuyInvalidation": null,
        "bestSellZone": null,
        "bestSellImmediate": false,
        "bestSellConfirmation": null,
        "bestSellInvalidation": null,
        "noTradeZone": "Avoid mid-range entries without confirmation",
        "nearestSupport": 4031.1,
        "nearestResistance": 4041.2
      },
      "importantLevels": [
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
          "nextLevelId": null,
          "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
          "simpleExplanation": "The recent high is a nearby reference until buyers or sellers prove control.",
          "confidence": 60
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
          "nextLevelId": null,
          "riskWarning": "Levels can fail without warning. This is analysis only — not a broker order and not financial advice.",
          "simpleExplanation": "The recent low is the nearest verified support when it sits at or below current price.",
          "confidence": 60
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
        "invalidation": "Mode change to MISMATCH or loss of verified structure",
        "management": "Wait for confirmation. Do not treat stop/TP references as an active plan.",
        "orderingValid": false,
        "orderingNote": "No trade plan is active.",
        "bullishConditional": {
          "label": "Bullish conditional plan",
          "direction": "BUY",
          "trigger": "Bounce from support 4031.1",
          "confirmationRequired": [
            "Confirmation candle at the bullish trigger",
            "Hold on retest"
          ],
          "target1": "4041.2 — recent bar high",
          "target1Price": 4041.2,
          "target1Why": "Nearest verified recent bar high beyond the bullish trigger.",
          "target2": "4047.32 — stretch high (estimate)",
          "target2Price": 4047.32,
          "target2Why": "Stretch estimate only — no nearer verified intermediate target.",
          "invalidation": "Break and hold below 4031.1",
          "invalidationPrice": 4031.1
        },
        "bearishConditional": {
          "label": "Bearish conditional plan",
          "direction": "SELL",
          "trigger": "Rejection from resistance 4041.2",
          "confirmationRequired": [
            "Confirmation candle at the bearish trigger",
            "Hold on retest"
          ],
          "target1": "4031.1 — recent bar low",
          "target1Price": 4031.1,
          "target1Why": "Nearest verified recent bar low beyond the bearish trigger.",
          "target2": "4022.32 — stretch low (estimate)",
          "target2Price": 4022.32,
          "target2Why": "Stretch estimate only — no nearer verified intermediate target.",
          "invalidation": "Break and hold above 4041.2",
          "invalidationPrice": 4041.2
        }
      },
      "freshness": {
        "quoteAgeSeconds": 20,
        "signalAgeSeconds": 90,
        "marketStructureMode": "COMPLETE",
        "sourceLabel": "TEST",
        "dataQuality": "GOOD"
      },
      "safety": {
        "autoTrade": "OFF",
        "demoOrderSubmission": false,
        "liveTrading": false,
        "analysisOnly": true
      },
      "disclaimer": "GoldMeta is analysis-only manual assistance for adult traders. AutoTrade stays OFF. No broker orders are submitted. Preview fixture missing-structure — not live market data."
    },
    "decision": {
      "lastKnownPrice": 4034.815,
      "ohlcv": {
        "open": 4036,
        "high": 4041.2,
        "low": 4031.1,
        "close": 4034.815,
        "volume": 1
      },
      "marketStructure": {
        "trend": "RANGE",
        "poc": null,
        "vah": null,
        "val": null,
        "confirmationClassification": "NONE"
      },
      "decision": "WAIT",
      "dataQuality": "GOOD",
      "dataSourceLabel": "TEST",
      "isTestDecision": true,
      "generatedAt": "2026-08-03T19:37:38.951Z",
      "marketDataTime": "2026-08-03T19:37:38.951Z",
      "currentSession": "LONDON"
    }
  },
  {
    "id": "stale-signal-fresh-quote",
    "title": "Stale strategy signal with a fresh quote",
    "mode": "COMPLETE",
    "quoteAgeSeconds": 15,
    "signalAgeSeconds": 3600,
    "livePrice": 4036.2,
    "decisionCode": "WAIT",
    "plan": {
      "schemaVersion": "1.2",
      "action": "PREPARE",
      "actionLabel": "PREPARE — SETUP FORMING",
      "oneSentence": "Price is below value. VAL 4037.308 is the first reclaim/overhead resistance. A bullish plan requires a reclaim and hold above VAL; a failed reclaim may support bearish continuation. (LABELLED PREVIEW — stale-signal-fresh-quote)",
      "trigger": "Reclaim and hold above VAL 4037.308",
      "triggerPrice": 4037.308,
      "distanceToTriggerPoints": 1.11,
      "entryConfirmation": [
        "Confirmed close above VAL for bullish reclaim",
        "Or rejection/failed reclaim for bearish continuation",
        "Do not treat VAL as a floor while it remains above price"
      ],
      "invalidation": "Break and hold below 4030 ends the immediate reclaim attempt",
      "nextTarget": "4040 — recent bar high",
      "nextTargetPrice": 4040,
      "afterThatTarget": "4045.09 — POC / volume magnet",
      "afterThatTargetPrice": 4045.09,
      "majorTarget": "4049.63 — VAH",
      "majorTargetPrice": 4049.63,
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
            "detail": "Price 4036.2"
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
      "confidence": 62,
      "expectedRange": {
        "rangeAvailable": true,
        "unavailableReason": null,
        "valueLocation": "BELOW_VALUE",
        "probableLow": 4030,
        "probableHigh": 4037.31,
        "stretchLow": 4023.7,
        "stretchHigh": 4048.7,
        "currentPrice": 4036.2,
        "remainingAbovePoints": 1.11,
        "remainingBelowPoints": 6.2,
        "remainingAbovePercent": 0.03,
        "remainingBelowPercent": 0.15,
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
        "confirmationRequired": [
          "5-minute candle closes above VAL",
          "Retest holds above VAL"
        ],
        "firstTarget": "4040 — recent bar high",
        "firstTargetPrice": 4040,
        "firstTargetWhy": "Nearest verified recent bar high beyond the bullish trigger.",
        "secondTarget": "4045.09 — POC / volume magnet",
        "secondTargetPrice": 4045.09,
        "secondTargetWhy": "Verified point of control — volume magnet beyond the trigger.",
        "invalidation": "Break and hold below 4030",
        "invalidationPrice": 4030
      },
      "bearishScenario": {
        "label": "If price falls",
        "trigger": "Break and hold below 4030",
        "triggerPrice": 4030,
        "confirmationRequired": [
          "5-minute candle closes below the support trigger",
          "Hold below on retest"
        ],
        "firstTarget": "Unavailable",
        "firstTargetPrice": null,
        "firstTargetWhy": "No verified intermediate target is available beyond the trigger — do not invent a price.",
        "secondTarget": "4023.7 — stretch low (estimate)",
        "secondTargetPrice": 4023.7,
        "secondTargetWhy": "Stretch estimate only — no nearer verified intermediate target.",
        "invalidation": "Reclaim and hold above 4037.308",
        "invalidationPrice": 4037.308
      },
      "zones": {
        "valueLocation": "BELOW_VALUE",
        "bestBuyZone": "Conditional reclaim-and-hold above 4037.308 (not an immediate buy zone)",
        "bestBuyImmediate": false,
        "bestBuyConfirmation": "Confirmed close and hold above VAL 4037.308",
        "bestBuyInvalidation": "Break and hold below 4030",
        "bestSellZone": "Failed reclaim / rejection at VAL 4037.308",
        "bestSellImmediate": false,
        "bestSellConfirmation": "Rejection candle at VAL after a touch from below",
        "bestSellInvalidation": "Reclaim and hold above 4037.308",
        "noTradeZone": "Avoid chasing into mid-value near 4045.087 before reclaim",
        "nearestSupport": 4030,
        "nearestResistance": 4037.308
      },
      "importantLevels": [
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
          "distancePoints": 13.6,
          "distancePercent": 0.34,
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
          "nextLevelId": null,
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
          "distancePoints": 13.43,
          "distancePercent": 0.33,
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
          "price": 4048.7,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MINOR",
          "distancePoints": 12.5,
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
          "distancePoints": 8.9,
          "distancePercent": 0.22,
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
          "distancePoints": 8.89,
          "distancePercent": 0.22,
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
          "price": 4040,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MODERATE",
          "distancePoints": 3.8,
          "distancePercent": 0.09,
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
          "side": "AT_PRICE",
          "kind": "RECLAIM",
          "roleAtCurrentPrice": "RECLAIM_LEVEL",
          "proximity": "NEAR",
          "price": 4037.308,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "STRONG",
          "distancePoints": 1.11,
          "distancePercent": 0.03,
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
          "price": 4030,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MODERATE",
          "distancePoints": -6.2,
          "distancePercent": -0.15,
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
          "distancePoints": -7.6,
          "distancePercent": -0.19,
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
          "price": 4023.7,
          "zoneLow": null,
          "zoneHigh": null,
          "strength": "MINOR",
          "distancePoints": -12.5,
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
        "invalidation": "Break and hold below 4030 ends the immediate reclaim attempt",
        "management": "Wait for confirmation. Do not treat stop/TP references as an active plan.",
        "orderingValid": false,
        "orderingNote": "No trade plan is active.",
        "bullishConditional": {
          "label": "Bullish conditional plan",
          "direction": "BUY",
          "trigger": "Reclaim and hold above VAL 4037.308",
          "confirmationRequired": [
            "5-minute candle closes above VAL",
            "Retest holds above VAL"
          ],
          "target1": "4040 — recent bar high",
          "target1Price": 4040,
          "target1Why": "Nearest verified recent bar high beyond the bullish trigger.",
          "target2": "4045.09 — POC / volume magnet",
          "target2Price": 4045.09,
          "target2Why": "Verified point of control — volume magnet beyond the trigger.",
          "invalidation": "Break and hold below 4030",
          "invalidationPrice": 4030
        },
        "bearishConditional": {
          "label": "Bearish conditional plan",
          "direction": "SELL",
          "trigger": "Break and hold below 4030",
          "confirmationRequired": [
            "5-minute candle closes below the support trigger",
            "Hold below on retest"
          ],
          "target1": "Unavailable",
          "target1Price": null,
          "target1Why": "No verified intermediate target is available beyond the trigger — do not invent a price.",
          "target2": "4023.7 — stretch low (estimate)",
          "target2Price": 4023.7,
          "target2Why": "Stretch estimate only — no nearer verified intermediate target.",
          "invalidation": "Reclaim and hold above 4037.308",
          "invalidationPrice": 4037.308
        }
      },
      "freshness": {
        "quoteAgeSeconds": 15,
        "signalAgeSeconds": 3600,
        "marketStructureMode": "COMPLETE",
        "sourceLabel": "TEST",
        "dataQuality": "GOOD"
      },
      "safety": {
        "autoTrade": "OFF",
        "demoOrderSubmission": false,
        "liveTrading": false,
        "analysisOnly": true
      },
      "disclaimer": "GoldMeta is analysis-only manual assistance for adult traders. AutoTrade stays OFF. No broker orders are submitted. Preview fixture stale-signal-fresh-quote — not live market data."
    },
    "decision": {
      "lastKnownPrice": 4036.2,
      "ohlcv": {
        "open": 4035,
        "high": 4040,
        "low": 4030,
        "close": 4036.2,
        "volume": 1
      },
      "marketStructure": {
        "poc": 4045.087,
        "vah": 4049.633,
        "val": 4037.308,
        "trend": "RANGE",
        "confirmationClassification": "NONE"
      },
      "decision": "WAIT",
      "dataQuality": "GOOD",
      "dataSourceLabel": "TEST",
      "isTestDecision": true,
      "generatedAt": "2026-08-03T18:37:38.951Z",
      "marketDataTime": "2026-08-03T19:37:38.951Z",
      "currentSession": "LONDON"
    }
  }
] as Issue50PreviewCase[];

export function getIssue50PreviewCase(id: string): Issue50PreviewCase | undefined {
  return issue50PreviewCases.find((c) => c.id === id);
}
