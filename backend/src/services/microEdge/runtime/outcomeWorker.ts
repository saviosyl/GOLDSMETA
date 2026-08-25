import { scoreHorizon } from "../outcomes/scorer";
import type { MicroEdgeStore } from "../storage/microEdgeStore";
import type { MicroQuote } from "../types";

export async function runMicroOutcomePass(args: {
  store: MicroEdgeStore;
  pathQuotesFor: (predictionId: string) => MicroQuote[];
  nowIso: string;
  limit?: number;
}): Promise<{ scored: number; unscorable: number }> {
  const due = await args.store.listPendingDue(args.nowIso, args.limit ?? 50);
  let scored = 0;
  let unscorable = 0;
  for (const p of due) {
    const pred = await args.store.getPrediction(p.predictionId);
    if (!pred) continue;
    const outcome = scoreHorizon({
      prediction: pred,
      horizon: p.horizon,
      pathQuotes: args.pathQuotesFor(p.predictionId)
    });
    const status = await args.store.saveOutcome(outcome);
    if (status === "created") {
      if (outcome.scorable) scored += 1;
      else unscorable += 1;
    }
  }
  return { scored, unscorable };
}
