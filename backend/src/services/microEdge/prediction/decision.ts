import type { MicroHorizon } from "../config";
import type { MicroHorizonDecision, MicroOverallDecision, MicroRegime } from "../types";

export function decideHorizon(args: {
  netEdgeUp: number;
  netEdgeDown: number;
  pUp: number;
  pDown: number;
  pNoEdge: number;
  regime: MicroRegime;
  dataOk: boolean;
}): { decision: MicroHorizonDecision; eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!args.dataOk || args.regime === "DANGER") {
    reasons.push("data_or_danger");
    return { decision: "WAIT", eligible: false, reasons };
  }
  const bestSide = args.netEdgeUp >= args.netEdgeDown ? "UP" : "DOWN";
  const bestEdge = Math.max(args.netEdgeUp, args.netEdgeDown);
  const bestP = bestSide === "UP" ? args.pUp : args.pDown;
  if (bestEdge <= 0 || bestP < 0.4 || args.pNoEdge > 0.55) {
    reasons.push("insufficient_cost_adjusted_edge");
    return { decision: "NO_EDGE", eligible: false, reasons };
  }
  const strong = bestEdge >= 0.15 && bestP >= 0.55;
  reasons.push("positive_net_edge");
  if (bestSide === "UP") {
    return {
      decision: strong ? "STRONG_UP_EDGE" : "UP_EDGE",
      eligible: true,
      reasons
    };
  }
  return {
    decision: strong ? "STRONG_DOWN_EDGE" : "DOWN_EDGE",
    eligible: true,
    reasons
  };
}

export function overallDecision(
  horizons: Record<MicroHorizon, { decision: MicroHorizonDecision; netEdgeUp: number; netEdgeDown: number }>
): { overall: MicroOverallDecision; strongest: MicroHorizon; agreement: string } {
  const order: MicroHorizon[] = ["5m", "1m", "15m"];
  let strongest: MicroHorizon = "5m";
  let best = -Infinity;
  for (const h of order) {
    const edge = Math.max(horizons[h].netEdgeUp, horizons[h].netEdgeDown);
    if (edge > best) {
      best = edge;
      strongest = h;
    }
  }
  const dirs = order.map((h) => {
    const d = horizons[h].decision;
    if (d.includes("UP")) return "UP";
    if (d.includes("DOWN")) return "DOWN";
    return "FLAT";
  });
  const agreement =
    dirs.every((d) => d === dirs[0]) && dirs[0] !== "FLAT"
      ? "ALL_ALIGNED"
      : dirs[0] === dirs[2] && dirs[0] !== "FLAT"
        ? "1M_15M_ALIGNED"
        : dirs[1] === dirs[0] && dirs[0] !== "FLAT"
          ? "5M_1M_ALIGNED"
          : "DISAGREE_OR_FLAT";
  return { overall: horizons[strongest].decision, strongest, agreement };
}
