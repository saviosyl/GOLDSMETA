/**
 * V1.1 shadow replay — one position, Bid/Ask economics, no broker.
 */
import type { GhAction, GhExitReason, GhShadowTrade } from "../types";
import { classifySession, classifyRegime } from "../sessionRegime";
import {
  consecutiveV11,
  decideV11Action,
  type V11PolicyConfig,
  type V11SideScores
} from "./policy";
import {
  GOLD_HUNTER_V11_MODEL_RESEARCH_VERSION,
  GOLD_HUNTER_V11_STRATEGY_VERSION
} from "./versions";

export type V11ScoreRow = {
  timestampMs: number;
  bid: number;
  ask: number;
  spread: number;
  regime: ReturnType<typeof classifyRegime>;
  scores: V11SideScores;
  dataOk: boolean;
};

function friction(): number {
  return 0.06;
}

export function runV11ShadowReplay(
  rows: V11ScoreRow[],
  policy: V11PolicyConfig
): GhShadowTrade[] {
  const trades: GhShadowTrade[] = [];
  let open: {
    side: "BUY" | "SELL";
    entryTs: number;
    entryBid: number;
    entryAsk: number;
    entryPrice: number;
    mfe: number;
    mae: number;
  } | null = null;
  let cooldownUntil = 0;
  const recent: GhAction[] = [];

  for (const row of rows) {
    const now = row.timestampMs;
    if (open) {
      const mid = (row.bid + row.ask) / 2;
      const entryMid = (open.entryBid + open.entryAsk) / 2;
      const unreal =
        open.side === "BUY" ? mid - entryMid : entryMid - mid;
      open.mfe = Math.max(open.mfe, unreal);
      open.mae = Math.min(open.mae, unreal);

      let exitReason: GhExitReason | null = null;
      const holdSec = (now - open.entryTs) / 1000;
      if (holdSec >= policy.maxHoldSec) exitReason = "MAX_HOLD";
      const adverse =
        open.side === "BUY"
          ? open.entryPrice - row.bid
          : row.ask - open.entryPrice;
      if (adverse >= policy.protectiveStop) exitReason = "PROTECTIVE_STOP";

      // EDGE_GONE / EDGE_FLIPPED
      const buy = row.scores.buyScore;
      const sell = row.scores.sellScore;
      if (open.side === "BUY" && buy < policy.minEdge * 0.25) {
        exitReason = exitReason ?? "EDGE_GONE";
      }
      if (open.side === "SELL" && sell < policy.minEdge * 0.25) {
        exitReason = exitReason ?? "EDGE_GONE";
      }
      if (open.side === "BUY" && sell > buy && sell >= policy.minEdge) {
        exitReason = exitReason ?? "EDGE_FLIPPED";
      }
      if (open.side === "SELL" && buy > sell && buy >= policy.minEdge) {
        exitReason = exitReason ?? "EDGE_FLIPPED";
      }

      if (exitReason) {
        const exitPrice = open.side === "BUY" ? row.bid : row.ask;
        const gross =
          open.side === "BUY"
            ? exitPrice - open.entryPrice
            : open.entryPrice - exitPrice;
        const fr = friction();
        const net = gross - fr;
        trades.push({
          tradeId: `v11_${open.side}_${open.entryTs}`,
          date: new Date(open.entryTs).toISOString().slice(0, 10),
          strategyVersion: GOLD_HUNTER_V11_STRATEGY_VERSION,
          modelVersion: GOLD_HUNTER_V11_MODEL_RESEARCH_VERSION,
          entryTimestampMs: open.entryTs,
          exitTimestampMs: now,
          durationSeconds: Math.round(holdSec),
          side: open.side,
          entryBid: open.entryBid,
          entryAsk: open.entryAsk,
          entryPrice: open.entryPrice,
          exitBid: row.bid,
          exitAsk: row.ask,
          exitPrice,
          entrySpread: open.entryAsk - open.entryBid,
          grossMove: gross,
          additionalFriction: fr,
          netMove: net,
          mfe: open.mfe,
          mae: open.mae,
          entryProbs: {
            5: {
              horizonSec: 5,
              pUp: 0,
              pDown: 0,
              pNoEdge: 1,
              expectedNetBuy: row.scores.buyScore,
              expectedNetSell: row.scores.sellScore
            },
            15: {
              horizonSec: 15,
              pUp: 0,
              pDown: 0,
              pNoEdge: 1,
              expectedNetBuy: row.scores.buyScore,
              expectedNetSell: row.scores.sellScore
            },
            30: {
              horizonSec: 30,
              pUp: 0,
              pDown: 0,
              pNoEdge: 1,
              expectedNetBuy: row.scores.buyScore,
              expectedNetSell: row.scores.sellScore
            },
            60: {
              horizonSec: 60,
              pUp: 0,
              pDown: 0,
              pNoEdge: 1,
              expectedNetBuy: row.scores.buyScore,
              expectedNetSell: row.scores.sellScore
            }
          },
          exitProbs: null,
          entryReason: `V11_${policy.architecture}`,
          exitReason,
          session: classifySession(open.entryTs),
          regime: row.regime,
          result: net > 0 ? "WIN" : net < 0 ? "LOSS" : "BREAKEVEN"
        });
        open = null;
        cooldownUntil = now + 5000;
      }
      continue;
    }

    if (now < cooldownUntil) continue;
    const raw = decideV11Action({
      scores: row.scores,
      policy,
      spread: row.spread,
      regime: row.regime,
      dataOk: row.dataOk
    });
    recent.push(raw);
    if (recent.length > 10) recent.shift();
    const action = consecutiveV11(recent, policy.consecutiveEvals);
    if (action === "WAIT") continue;
    open = {
      side: action,
      entryTs: now,
      entryBid: row.bid,
      entryAsk: row.ask,
      entryPrice: action === "BUY" ? row.ask : row.bid,
      mfe: 0,
      mae: 0
    };
  }
  return trades;
}
