import { MICRO_LABEL_VERSION, MICRO_THETA, type MicroHorizon } from "../config";
import type { MicroClass } from "../types";

/**
 * Tradeable class from NET hypothetical outcomes after costs.
 * Ties fail closed to NO_EDGE.
 */
export function labelFromNets(args: {
  horizon: MicroHorizon;
  netLong: number;
  netShort: number;
}): { actualClass: MicroClass; labelVersion: string; theta: number } {
  const theta = MICRO_THETA[args.horizon];
  if (args.netLong > theta && args.netLong > args.netShort) {
    return { actualClass: "UP_TRADEABLE", labelVersion: MICRO_LABEL_VERSION, theta };
  }
  if (args.netShort > theta && args.netShort > args.netLong) {
    return { actualClass: "DOWN_TRADEABLE", labelVersion: MICRO_LABEL_VERSION, theta };
  }
  return { actualClass: "NO_EDGE", labelVersion: MICRO_LABEL_VERSION, theta };
}
