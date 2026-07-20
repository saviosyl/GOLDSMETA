import type { DecisionDirection, MarketSnapshot, TakeProfitPlan, TradePlan } from "../../models/types";
import { isPositivePrice, roundPrice, roundRatio } from "../../utils/money";

const emptyPlan = (): TradePlan => ({
  entry: {
    type: "NONE",
    price: null,
    zoneLow: null,
    zoneHigh: null,
    condition: null
  },
  stopLoss: {
    price: null,
    reason: null
  },
  takeProfits: [],
  riskReward: {
    tp1: null,
    tp2: null,
    tp3: null
  },
  breakeven: {
    state: "NOT_APPLICABLE",
    trigger: null,
    newStop: null,
    reason: null
  },
  earlyExit: {
    exitNow: false,
    conditions: []
  }
});

const numericLevels = (snapshot: MarketSnapshot): number[] => {
  const profileLevels = [
    ...(snapshot.levels?.pocNonBroken ?? []),
    ...(snapshot.levels?.vahNonBroken ?? []),
    ...(snapshot.levels?.valNonBroken ?? [])
  ].map((level) => level.price);

  return [
    snapshot.levels?.pocAll,
    snapshot.levels?.vahAll,
    snapshot.levels?.valAll,
    snapshot.sessionVolumeProfile?.poc,
    snapshot.sessionVolumeProfile?.vah,
    snapshot.sessionVolumeProfile?.val,
    snapshot.marketProfile?.initialBalanceHigh,
    snapshot.marketProfile?.initialBalanceLow,
    snapshot.marketProfile?.poorHigh,
    snapshot.marketProfile?.poorLow,
    ...(snapshot.sessionVolumeProfile?.hvn ?? []),
    ...(snapshot.sessionVolumeProfile?.lvn ?? []),
    ...(snapshot.marketProfile?.singlePrints ?? []),
    ...profileLevels
  ].filter((price): price is number => isPositivePrice(price));
};

const selectStopLoss = (
  snapshot: MarketSnapshot,
  direction: Exclude<DecisionDirection, "WAIT">,
  entry: number
): { price: number | null; reason: string | null } => {
  const candleLow = snapshot.confirmationCandle?.low ?? snapshot.ohlcv?.low ?? null;
  const candleHigh = snapshot.confirmationCandle?.high ?? snapshot.ohlcv?.high ?? null;
  const levels = numericLevels(snapshot);

  if (direction === "BUY") {
    const candidates = [candleLow, ...levels.filter((level) => level < entry)]
      .filter((price): price is number => isPositivePrice(price) && price < entry)
      .sort((left, right) => right - left);
    const selected = candidates[0];
    return selected ? { price: roundPrice(selected), reason: "Nearest structural support below entry" } : { price: null, reason: null };
  }

  const candidates = [candleHigh, ...levels.filter((level) => level > entry)]
    .filter((price): price is number => isPositivePrice(price) && price > entry)
    .sort((left, right) => left - right);
  const selected = candidates[0];
  return selected ? { price: roundPrice(selected), reason: "Nearest structural resistance above entry" } : { price: null, reason: null };
};

const selectTargets = (
  snapshot: MarketSnapshot,
  direction: Exclude<DecisionDirection, "WAIT">,
  entry: number,
  stopLoss: number
): TakeProfitPlan[] => {
  const rawLevels = numericLevels(snapshot);
  const structuralTargets =
    direction === "BUY"
      ? rawLevels.filter((level) => level > entry).sort((left, right) => left - right)
      : rawLevels.filter((level) => level < entry).sort((left, right) => right - left);

  const uniqueTargets: number[] = [];
  for (const target of structuralTargets) {
    if (!uniqueTargets.some((existing) => Math.abs(existing - target) < 0.01)) {
      uniqueTargets.push(target);
    }
    if (uniqueTargets.length === 3) {
      break;
    }
  }

  const risk = Math.abs(entry - stopLoss);
  while (uniqueTargets.length < 3 && risk > 0) {
    const multiple = uniqueTargets.length + 1;
    const target = direction === "BUY" ? entry + risk * multiple : entry - risk * multiple;
    uniqueTargets.push(roundPrice(target));
  }

  return uniqueTargets.slice(0, 3).map((target, index) => ({
    label: index === 0 ? "TP1" : index === 1 ? "TP2" : "TP3",
    price: roundPrice(target),
    reason: index < structuralTargets.length ? "Opposing structural level" : `${index + 1}R extension`
  }));
};

const riskRewardFor = (
  direction: Exclude<DecisionDirection, "WAIT">,
  entry: number,
  stopLoss: number,
  target: number | undefined
): number | null => {
  if (target === undefined) {
    return null;
  }
  const risk = Math.abs(entry - stopLoss);
  if (risk <= 0) {
    return null;
  }
  const reward = direction === "BUY" ? target - entry : entry - target;
  if (reward <= 0) {
    return null;
  }
  return roundRatio(reward / risk);
};

export const buildTradePlan = (snapshot: MarketSnapshot, decision: DecisionDirection): TradePlan => {
  if (decision === "WAIT" || !isPositivePrice(snapshot.price)) {
    return emptyPlan();
  }

  const entry = roundPrice(snapshot.price);
  const stopLoss = selectStopLoss(snapshot, decision, entry);
  if (!isPositivePrice(stopLoss.price)) {
    return {
      ...emptyPlan(),
      entry: {
        type: "MARKET",
        price: entry,
        zoneLow: null,
        zoneHigh: null,
        condition: "Valid setup requires a structural stop loss"
      }
    };
  }

  const takeProfits = selectTargets(snapshot, decision, entry, stopLoss.price);
  const tp1 = takeProfits.find((target) => target.label === "TP1")?.price;
  const tp2 = takeProfits.find((target) => target.label === "TP2")?.price;
  const tp3 = takeProfits.find((target) => target.label === "TP3")?.price;

  return {
    entry: {
      type: "MARKET",
      price: entry,
      zoneLow: null,
      zoneHigh: null,
      condition: "Use only after the confirmed TradingView alert is received"
    },
    stopLoss,
    takeProfits,
    riskReward: {
      tp1: riskRewardFor(decision, entry, stopLoss.price, tp1),
      tp2: riskRewardFor(decision, entry, stopLoss.price, tp2),
      tp3: riskRewardFor(decision, entry, stopLoss.price, tp3)
    },
    breakeven: {
      state: "MOVE_TO_BREAKEVEN",
      trigger: "After TP1 is reached and price holds beyond entry",
      newStop: entry,
      reason: "Reduce risk after first objective"
    },
    earlyExit: {
      exitNow: false,
      conditions: [
        "Opposite confirmed signal",
        "Acceptance fails back inside prior value",
        "Stop loss structure is invalidated"
      ]
    }
  };
};
