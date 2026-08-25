import type { MicroOutcome, MicroPerformanceSlice, MicroPrediction } from "../types";

export function aggregatePerformance(
  key: string,
  predictions: MicroPrediction[],
  outcomes: MicroOutcome[]
): MicroPerformanceSlice {
  const byId = new Map(outcomes.map((o) => [o.predictionId + ":" + o.horizon, o]));
  let scorable = 0;
  let unscorable = 0;
  let eligible = 0;
  let dirHit = 0;
  let dirN = 0;
  let classHit = 0;
  let classN = 0;
  let brier = 0;
  let logLoss = 0;
  let net = 0;
  let costs = 0;
  let wins = 0;
  let losses = 0;
  let winSum = 0;
  let lossSum = 0;
  let equity = 0;
  let peak = 0;
  let maxDd = 0;

  for (const p of predictions) {
    for (const h of Object.keys(p.horizons) as Array<keyof typeof p.horizons>) {
      const o = byId.get(p.predictionId + ":" + h);
      if (!o) continue;
      if (p.horizons[h].eligibleOpportunity) eligible += 1;
      if (!o.scorable) {
        unscorable += 1;
        continue;
      }
      scorable += 1;
      if (o.directionCorrect != null) {
        dirN += 1;
        if (o.directionCorrect) dirHit += 1;
      }
      if (o.classCorrect != null) {
        classN += 1;
        if (o.classCorrect) classHit += 1;
      }
      if (o.brierComponents != null) brier += o.brierComponents;
      if (o.logLossComponent != null) logLoss += o.logLossComponent;
      const chosen =
        (o.netLong ?? 0) >= (o.netShort ?? 0) ? (o.netLong ?? 0) : (o.netShort ?? 0);
      // Only accumulate NET for eligible opportunities.
      if (p.horizons[h].eligibleOpportunity) {
        net += chosen;
        costs += o.estimatedCosts ?? 0;
        equity += chosen;
        peak = Math.max(peak, equity);
        maxDd = Math.max(maxDd, peak - equity);
        if (chosen > 0) {
          wins += 1;
          winSum += chosen;
        } else if (chosen < 0) {
          losses += 1;
          lossSum += Math.abs(chosen);
        }
      }
    }
  }

  return {
    key,
    predictions: predictions.length,
    scorable,
    unscorable,
    eligible,
    directionAccuracy: dirN ? dirHit / dirN : null,
    classAccuracy: classN ? classHit / classN : null,
    brier: scorable ? brier / scorable : null,
    logLoss: scorable ? logLoss / scorable : null,
    netHypotheticalPl: net,
    estimatedCosts: costs,
    winRate: wins + losses ? wins / (wins + losses) : null,
    profitFactor: lossSum > 0 ? winSum / lossSum : wins ? Infinity : null,
    expectancy: eligible ? net / eligible : null,
    maxDrawdown: maxDd
  };
}
