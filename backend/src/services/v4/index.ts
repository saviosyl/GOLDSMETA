export { v4Config, V4_STRATEGY_VERSION, V4_ENGINE_VERSION } from "./config";
export { evaluateV4 } from "./engine";
export { runV4Backtest, buildSyntheticSeries, experimentId } from "./backtester";
export { runV4ShadowSafe, buildV4InputFromV3 } from "./shadowRunner";
export { computeStructuralStop } from "./stopEngine";
export type * from "./types";
