/** Beginner glossary for contextual Help tooltips and the Help page. */

export type GlossaryTerm = {
  id: string;
  term: string;
  short: string;
  detail: string;
};

export const GLOSSARY: GlossaryTerm[] = [
  {
    id: "buy",
    term: "BUY",
    short: "GoldMeta sees conditions favouring a long (buy) bias.",
    detail:
      "BUY means the analysis leans toward buying gold at the proposed entry. It is not an order. Live execution stays locked until you understand the plan."
  },
  {
    id: "sell",
    term: "SELL",
    short: "GoldMeta sees conditions favouring a short (sell) bias.",
    detail:
      "SELL means the analysis leans toward selling gold at the proposed entry. GoldMeta never places the trade for you unless you later enable a separately approved broker mode."
  },
  {
    id: "wait",
    term: "WAIT",
    short: "No clear trade plan yet — stay flat.",
    detail:
      "WAIT means gates are not clear enough for a validated plan. Watching is the correct action."
  },
  {
    id: "confidence",
    term: "Confidence",
    short: "How strong the current setup quality looks (0–100%).",
    detail:
      "Confidence is a rules-based quality score, not a promise of profit and not certainty. Higher means clearer structure — never a guarantee."
  },
  {
    id: "trend",
    term: "Trend",
    short: "The broad market direction GoldMeta currently sees (up, down, or range).",
    detail:
      "Trend describes the recent directional bias. It can change quickly. It is analysis context, not a guaranteed outcome."
  },
  {
    id: "entry",
    term: "Entry",
    short: "The proposed price area where a plan would start.",
    detail:
      "Entry is a suggested starting zone for a manual plan. Markets can gap past it. GoldMeta does not place the order for you while trading is locked."
  },
  {
    id: "risk",
    term: "Risk",
    short: "How far price can move against the plan before the stop loss.",
    detail:
      "Estimated risk is a distance or sizing aid, not a guaranteed loss or profit figure. Never risk money you cannot afford to lose."
  },
  {
    id: "poc",
    term: "POC",
    short: "Point of Control — the price where the most volume traded (fair value).",
    detail:
      "Think of POC as the market’s ‘fair value’ level for the session profile GoldMeta is using."
  },
  {
    id: "vah",
    term: "VAH",
    short: "Value Area High — upper edge of where most trading happened.",
    detail: "Price above VAH is often considered outside the main value area."
  },
  {
    id: "val",
    term: "VAL",
    short: "Value Area Low — lower edge of where most trading happened.",
    detail: "Price below VAL is often considered outside the main value area."
  },
  {
    id: "stop-loss",
    term: "Stop loss",
    short: "The price where the plan says the idea is wrong.",
    detail:
      "A stop loss limits how far price can move against you before the plan is invalidated. Never risk money you cannot afford to lose."
  },
  {
    id: "take-profit",
    term: "Take profit",
    short: "Target prices where the plan suggests taking gains (TP1 / TP2 / TP3).",
    detail:
      "Targets are proposed exit levels. Markets can miss them. Scale-outs are optional and manual unless a future approved mode says otherwise."
  },
  {
    id: "spread",
    term: "Spread",
    short: "Difference between buy (ask) and sell (bid) prices at the broker.",
    detail:
      "A wider spread costs more to enter. GoldMeta checks spread during broker read-only verification."
  },
  {
    id: "lot-size",
    term: "Lot size",
    short: "How large a position is at the broker (contract size × volume).",
    detail:
      "Smaller lots mean smaller risk. GoldMeta will show volume minimums and steps once Pepperstone is connected for read-only checks."
  },
  {
    id: "autotrade",
    term: "AutoTrade",
    short: "Gold Hunter is the AutoTrade UI. Live execution stays locked.",
    detail:
      "Core AutoTrade and FAST AutoTrade were removed. Gold Hunter is the only AutoTrade UI. Live execution remains locked."
  },
  {
    id: "emergency-stop",
    term: "Emergency STOP",
    short: "Stops new automated entries when automation exists.",
    detail:
      "Emergency STOP is a safety control for future automation. It does not silently close positions by itself. Trading is already locked in this phase."
  }
];

export function glossaryById(id: string): GlossaryTerm | undefined {
  return GLOSSARY.find((g) => g.id === id);
}
