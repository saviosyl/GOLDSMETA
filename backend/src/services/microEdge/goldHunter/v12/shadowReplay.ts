/**
 * V1.2 shadow replay — adaptive rank entry + dynamic profit harvest exits.
 * BUY entry Ask / exit Bid; SELL entry Bid / exit Ask. No broker.
 */
import type { GhAction, GhExitReason, GhShadowTrade } from "../types";
import { classifySession } from "../sessionRegime";
import {
  PastOnlyScoreWindow,
  adaptiveRankPasses
} from "./adaptiveRank";
import {
  createOpenState,
  evaluateV12Exit,
  updateHarvestState,
  type OpenHarvestState
} from "./exits";
import {
  combineArchitectureScores,
  consecutiveV12,
  decideV12Action,
  type V12HorizonScores,
  type V12PolicyConfig
} from "./policy";
import { v12RegimeToGh, type V12Regime } from "./regimes";
import {
  GOLD_HUNTER_V12_MODEL_RESEARCH_VERSION,
  GOLD_HUNTER_V12_STRATEGY_VERSION
} from "./versions";

export type V12ScoreRow = {
  timestampMs: number;
  bid: number;
  ask: number;
  spread: number;
  regime: V12Regime;
  scores: V12HorizonScores;
  dataOk: boolean;
  velocity: number;
  spreadOverMedian: number;
};

function friction(cfg: V12PolicyConfig): number {
  return cfg.exit.friction;
}

export function runV12ShadowReplay(
  rows: V12ScoreRow[],
  policy: V12PolicyConfig
): GhShadowTrade[] {
  const trades: GhShadowTrade[] = [];
  let open: (OpenHarvestState & { entryBid: number; entryAsk: number }) | null =
    null;
  let cooldownUntil = 0;
  const recent: GhAction[] = [];
  const buyWindow = new PastOnlyScoreWindow(policy.rankWindowSec * 1000);
  const sellWindow = new PastOnlyScoreWindow(policy.rankWindowSec * 1000);

  for (const row of rows) {
    const now = row.timestampMs;
    const { buy, sell } = combineArchitectureScores(
      policy.architecture,
      row.scores
    );

    if (open) {
      updateHarvestState(open, {
        bid: row.bid,
        ask: row.ask,
        cfg: policy.exit
      });
      const sideScore = open.side === "BUY" ? buy : sell;
      const opposeScore = open.side === "BUY" ? sell : buy;
      const exitReason: GhExitReason | null = evaluateV12Exit({
        open,
        nowMs: now,
        bid: row.bid,
        ask: row.ask,
        sideScore,
        opposeScore,
        velocity: row.velocity,
        spreadOverMedian: row.spreadOverMedian,
        dataOk: row.dataOk,
        cfg: policy.exit
      });

      if (exitReason) {
        const exitPrice = open.side === "BUY" ? row.bid : row.ask;
        const gross =
          open.side === "BUY"
            ? exitPrice - open.entryPrice
            : open.entryPrice - exitPrice;
        const fr = friction(policy);
        const net = gross - fr;
        const holdSec = (now - open.entryTs) / 1000;
        const emptyH = {
          horizonSec: 5 as const,
          pUp: 0,
          pDown: 0,
          pNoEdge: 1,
          expectedNetBuy: buy,
          expectedNetSell: sell
        };
        trades.push({
          tradeId: `v12_${open.side}_${open.entryTs}`,
          date: new Date(open.entryTs).toISOString().slice(0, 10),
          strategyVersion: GOLD_HUNTER_V12_STRATEGY_VERSION,
          modelVersion: GOLD_HUNTER_V12_MODEL_RESEARCH_VERSION,
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
          entrySpread: row.spread,
          grossMove: gross,
          additionalFriction: fr,
          netMove: net,
          mfe: open.mfe,
          mae: open.mae,
          entryProbs: { 5: emptyH, 15: emptyH, 30: emptyH, 60: emptyH },
          exitProbs: null,
          entryReason: `V12_${policy.architecture}_${policy.exit.architecture}`,
          exitReason,
          session: classifySession(open.entryTs),
          regime: v12RegimeToGh(row.regime),
          result: net > 0 ? "WIN" : net < 0 ? "LOSS" : "BREAKEVEN"
        });
        open = null;
        cooldownUntil = now + 5000;
      }
      buyWindow.push(now, buy);
      sellWindow.push(now, sell);
      continue;
    }

    if (now < cooldownUntil) {
      buyWindow.push(now, buy);
      sellWindow.push(now, sell);
      continue;
    }

    const buyRankOk = adaptiveRankPasses({
      score: buy,
      nowMs: now,
      window: buyWindow,
      percentile: policy.rankPercentile,
      coldFloor: policy.buyColdFloor
    });
    const sellRankOk = adaptiveRankPasses({
      score: sell,
      nowMs: now,
      window: sellWindow,
      percentile: policy.rankPercentile,
      coldFloor: policy.sellColdFloor
    });

    const raw = decideV12Action({
      scores: row.scores,
      policy,
      spread: row.spread,
      regime: row.regime,
      dataOk: row.dataOk,
      buyRankOk,
      sellRankOk
    });
    recent.push(raw);
    if (recent.length > 10) recent.shift();
    const action = consecutiveV12(recent, policy.consecutiveEvals);
    buyWindow.push(now, buy);
    sellWindow.push(now, sell);
    if (action === "WAIT") continue;

    const st = createOpenState({
      side: action,
      entryTs: now,
      entryPrice: action === "BUY" ? row.ask : row.bid,
      exitConfig: policy.exit
    });
    open = { ...st, entryBid: row.bid, entryAsk: row.ask };
  }
  return trades;
}
