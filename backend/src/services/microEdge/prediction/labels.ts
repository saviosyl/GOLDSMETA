import { MICRO_LABEL_VERSION, MICRO_THETA, type MicroHorizon } from "../config";
import type { MicroClass } from "../types";

/**
 * Tradeable class from NET hypothetical outcomes after costs.
 * Ties fail closed to NO_EDGE.
 *
 * When scoring historical predictions, pass frozen theta/labelVersion from the prediction.
 */
export function labelFromNets(args: {
  horizon: MicroHorizon;
  netLong: number;
  netShort: number;
  /** Frozen theta from prediction; defaults to current config only for new labels. */
  theta?: number;
  labelVersion?: string;
}): { actualClass: MicroClass; labelVersion: string; theta: number } {
  const theta = args.theta ?? MICRO_THETA[args.horizon];
  const labelVersion = args.labelVersion ?? MICRO_LABEL_VERSION;
  if (args.netLong > theta && args.netLong > args.netShort) {
    return { actualClass: "UP_TRADEABLE", labelVersion, theta };
  }
  if (args.netShort > theta && args.netShort > args.netLong) {
    return { actualClass: "DOWN_TRADEABLE", labelVersion, theta };
  }
  return { actualClass: "NO_EDGE", labelVersion, theta };
}
