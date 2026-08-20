import type { LearnLesson } from "./types";

/**
 * Learn GoldMeta — 21 beginner lessons.
 * Language: extremely simple English. Education only. No profit promises.
 */
export const LEARN_LESSONS: LearnLesson[] = [
  {
    id: "what-is-trading",
    number: 1,
    title: "What is Trading?",
    description: "Buy low, sell high — and why prices can also go the wrong way.",
    listenMinutes: 2,
    diagram: null,
    body: `Imagine you have a toy.
You buy it for 10 euros.
Later, someone buys it from you for 12 euros.
You made 2 euros.

Markets work in a similar way.
People buy and sell things like gold.
The price can go up.
The price can also go down.

If the price moves the way you hoped, you can make money.
If the price moves the other way, you can lose money.

Trading can make money OR lose money.
That is normal.
Nothing is guaranteed.

GoldMeta helps you understand market conditions.
GoldMeta does not know the future.
GoldMeta does not promise profit.`,
    example:
      "You buy gold near 4,300. Later the price is 4,310. That move helped. But if price falls to 4,290 instead, that move hurt. Both outcomes are possible.",
    remember: [
      "Trading means buying and selling with risk.",
      "Prices can move up or down.",
      "You can make money or lose money.",
      "GoldMeta helps analysis. It does not predict the future."
    ]
  },
  {
    id: "what-is-a-stock",
    number: 2,
    title: "What is a Stock?",
    description: "A tiny ownership piece of a company — and what GoldMeta focuses on.",
    listenMinutes: 2,
    diagram: null,
    body: `A stock is a small ownership piece of a company.

Think of a big pizza.
The company is the whole pizza.
A stock is one slice.

Example:
Apple stock means a tiny piece of Apple.

People trade stocks hoping the price will rise.
But stock prices can also fall.

Important for GoldMeta:
GoldMeta is mainly designed for GOLD.
GOLD is shown as XAUUSD.
GoldMeta is not mainly built for ordinary company stocks.`,
    example:
      "Owning one share of a company is like owning one tiny brick of a huge building. GoldMeta’s main focus is gold priced in US dollars, not company shares.",
    remember: [
      "A stock is a small piece of a company.",
      "Stock prices can rise or fall.",
      "GoldMeta is mainly for gold (XAUUSD).",
      "This app is not a stock-picking tool."
    ]
  },
  {
    id: "what-is-gold-xauusd",
    number: 3,
    title: "What is Gold / XAUUSD?",
    description: "XAU means gold. USD means US dollars.",
    listenMinutes: 2,
    diagram: null,
    body: `XAU means gold.
USD means the US dollar.

So XAUUSD shows the price of gold in US dollars.

If XAUUSD is 4,340, one unit of gold costs about 4,340 US dollars.

GoldMeta watches this gold price.
It studies conditions around that price.
It still cannot know what happens next.`,
    example:
      "When you see 4,340 on GoldMeta, that is gold’s price in dollars — like a big price tag for gold.",
    remember: [
      "XAU = gold.",
      "USD = US dollar.",
      "XAUUSD = gold priced in dollars.",
      "GoldMeta focuses on this gold market."
    ]
  },
  {
    id: "buy-sell-wait",
    number: 4,
    title: "BUY, SELL and WAIT",
    description: "Three decisions — and why WAIT is a real answer.",
    listenMinutes: 3,
    diagram: "buy-sell-wait",
    body: `GoldMeta can show three main decisions.

BUY means:
GoldMeta sees conditions that support upward movement.
That does not guarantee price will rise.

SELL means:
GoldMeta sees conditions that support downward movement.
That does not guarantee price will fall.

WAIT means:
There is not enough confirmation yet.
The picture is incomplete.

WAIT is a valid decision.
WAIT does NOT mean the application is broken.
Sometimes the smartest action is to wait.

Always remember:
These are analysis labels.
They are not promises of profit.`,
    example:
      "Gold is at 4,340. The bigger picture looks okay, but the short confirmation is missing. GoldMeta says WAIT. That is helpful — not a bug.",
    remember: [
      "BUY = conditions support upward movement.",
      "SELL = conditions support downward movement.",
      "WAIT = not enough confirmation yet.",
      "WAIT is normal and useful.",
      "No decision guarantees profit."
    ]
  },
  {
    id: "candlesticks",
    number: 5,
    title: "Candlesticks",
    description: "Tiny pictures that show how price moved.",
    listenMinutes: 3,
    diagram: "candle",
    body: `A candlestick is a tiny picture of price movement.

It shows four numbers:
Open — where price started.
Close — where price finished.
High — the highest price in that time.
Low — the lowest price in that time.

A green candle usually means the close was above the open.
Price finished higher than it started.

A red candle usually means the close was below the open.
Price finished lower than it started.

The thin lines are called wicks.
Wicks show the high and low extremes.

Candles help you see movement.
They do not promise the next move.`,
    example:
      "In 15 minutes, gold opens at 4,340, goes as high as 4,345, as low as 4,338, and closes at 4,343. That can draw a green candle with a small wick on top and bottom.",
    remember: [
      "Candles show open, close, high, and low.",
      "Green often means finished higher.",
      "Red often means finished lower.",
      "Wicks show extremes.",
      "Candles describe the past, not guaranteed futures."
    ]
  },
  {
    id: "timeframes",
    number: 6,
    title: "Timeframes",
    description: "5M, 15M, and 1H — zoom levels for the same market.",
    listenMinutes: 2,
    diagram: null,
    body: `A timeframe is how much time each candle covers.

5M means each candle is 5 minutes.
15M means each candle is 15 minutes.
1H means each candle is 1 hour.

Analogy:
5M is looking closely, like standing next to a painting.
1H is stepping back to see the bigger picture.

GoldMeta often uses more than one timeframe together.
A short timeframe can be noisy.
A longer timeframe can show the wider story.`,
    example:
      "On 5M, price may wiggle up and down. On 1H, those wiggles may still look like one clear upward path.",
    remember: [
      "Timeframes are zoom levels.",
      "5M = close look.",
      "15M = medium look.",
      "1H = bigger picture.",
      "Different zooms can tell different parts of the story."
    ]
  },
  {
    id: "support-resistance",
    number: 7,
    title: "Support and Resistance",
    description: "Floor and ceiling ideas — not magic walls.",
    listenMinutes: 3,
    diagram: "support-resistance",
    body: `Support is like a floor.

Imagine dropping a ball.
The floor can stop the ball from falling.

In trading, support is a price area where buyers may become stronger.

Resistance is like a ceiling.
Price may struggle to push through it.
Sellers may become stronger near that area.

Important:
Support and resistance are not magic walls.
Price can still break through them.

GoldMeta uses these areas as context.
They help describe conditions.
They do not guarantee a bounce or a reversal.`,
    example:
      "If gold keeps bouncing near 4,320, that area may act like support. If price later smashes through 4,320, the old floor failed — that can happen.",
    remember: [
      "Support ≈ floor.",
      "Resistance ≈ ceiling.",
      "They are areas, not guarantees.",
      "Price can break through.",
      "GoldMeta uses them as context."
    ]
  },
  {
    id: "trend-structure",
    number: 8,
    title: "Trend and Market Structure",
    description: "Rising steps, falling steps, or sideways.",
    listenMinutes: 3,
    diagram: "market-structure",
    body: `Market structure is the shape of price movement.

Bullish structure often shows higher highs and higher lows.
Like climbing stairs upward.

Bearish structure often shows lower highs and lower lows.
Like walking downstairs.

Sideways or range means price moves left and right in a box.
Neither side is clearly winning.

Structure helps describe the path price has been taking.
It does not lock in the next step.`,
    example:
      "Gold makes a high at 4,340, a higher high at 4,350, and the pullbacks stay above earlier lows. That looks more like upward stairs.",
    remember: [
      "Higher highs and higher lows can mean upward structure.",
      "Lower highs and lower lows can mean downward structure.",
      "Sideways means a range.",
      "Structure describes the path so far.",
      "Structure is not a promise."
    ]
  },
  {
    id: "poc-vah-val",
    number: 9,
    title: "POC, VAH and VAL",
    description: "The busy shopping area of price.",
    listenMinutes: 3,
    diagram: "value-area",
    body: `Think of a shopping centre.

POC means Point of Control.
It is like the busiest shop area — where the most trading activity happened.

VAH means Value Area High.
It is near the top of the main busy zone.

VAL means Value Area Low.
It is near the bottom of the main busy zone.

GoldMeta looks at where price sits around these levels.
Above, inside, or below the busy zone can change the story.

These levels are maps of past activity.
They are not crystal balls.`,
    example:
      "If POC is 4,335 and price is holding above it, GoldMeta may treat that as stronger location context than price stuck far below the busy area.",
    remember: [
      "POC ≈ busiest area.",
      "VAH ≈ top of main value area.",
      "VAL ≈ bottom of main value area.",
      "Location around these levels matters.",
      "They describe past activity, not guaranteed future moves."
    ]
  },
  {
    id: "volume-atr",
    number: 10,
    title: "Volume and ATR / Volatility",
    description: "Quiet markets versus moving markets.",
    listenMinutes: 2,
    diagram: null,
    body: `Some days the market is quiet.
Price moves slowly.
Waves are small.

Some days the market is active.
Price moves farther and faster.

Volatility means how much price is moving.

ATR helps measure that movement.
You do not need the math.
Just remember: ATR is a movement size helper.

High movement can mean bigger chances and bigger risks.
Quiet markets can mean smaller moves.

GoldMeta uses volatility as context.
It does not mean easy profit.`,
    example:
      "On a quiet day, gold may move a few dollars. On a busy day, it may swing much more. ATR helps describe that difference simply.",
    remember: [
      "Quiet market = smaller moves.",
      "Active market = larger moves.",
      "ATR helps measure movement size.",
      "More movement can also mean more risk.",
      "Volatility is context, not a signal by itself."
    ]
  },
  {
    id: "goldmeta-score",
    number: 11,
    title: "GoldMeta Score",
    description: "A setup quality score — not a profit probability.",
    listenMinutes: 3,
    diagram: "score",
    body: `GoldMeta Score is a setup quality score.

GoldMeta checks several pieces of evidence.
When more pieces agree, the score can be stronger.
When pieces disagree, the score can be weaker.

CRITICAL:
A score of 80 out of 100 does NOT mean an 80 percent chance of profit.

It does not mean “almost sure.”
It does not mean “safe trade.”

It only describes how complete and aligned the current setup looks.

Trading can still lose at any score.`,
    example:
      "Score 82 may mean many checklist items agree. Score 45 may mean the picture is mixed. Neither number promises money.",
    remember: [
      "GoldMeta Score = setup quality.",
      "More agreement can raise the score.",
      "80/100 is NOT an 80% chance of profit.",
      "Any score can still lose.",
      "Use the score as context, not a guarantee."
    ]
  },
  {
    id: "entry-stop-targets",
    number: 12,
    title: "Entry, Stop Loss and Targets",
    description: "Where a plan starts, where it protects, and where it aims.",
    listenMinutes: 3,
    diagram: "risk-reward",
    body: `Entry is where the plan begins.
It is the area GoldMeta is watching for a possible start.

Stop Loss is the protection point.
Think of it as an emergency exit.
If price reaches the stop, the plan idea failed for now.

TP means Take Profit.
TP1, TP2, and TP3 are profit targets.
They are goals, not promises.

A plan can show:
Entry,
Stop Loss,
TP1,
TP2,
TP3.

Price may reach a target.
Price may hit the stop instead.
Both can happen.`,
    example:
      "BUY plan: entry near 4,340, stop at 4,330, TP1 at 4,350, TP2 at 4,360. You risk about 10 dollars to aim for larger targets. Targets are not guaranteed.",
    remember: [
      "Entry = plan start area.",
      "Stop Loss = emergency exit.",
      "TP1 / TP2 / TP3 = targets, not promises.",
      "Price can hit targets or the stop.",
      "Always know your risk before acting."
    ]
  },
  {
    id: "risk-reward",
    number: 13,
    title: "Risk / Reward",
    description: "How much you risk compared with how much you aim for.",
    listenMinutes: 2,
    diagram: "risk-reward",
    body: `Risk is what you may lose if the stop is hit.
Reward is what you hope to gain if a target is reached.

If you risk 1 euro to try for 2 euros, that is about 1 to 2.
People write this as 1:2.

A nicer ratio does not make a trade safe.
A weak ratio does not always make a trade bad.
It is one educational measuring stick.

GoldMeta can show risk and reward numbers to help you compare size.
It still cannot promise the reward will arrive.`,
    example:
      "Stop is 10 dollars away. TP1 is 20 dollars away. That is roughly risking 1 to try for 2. Educational only — outcomes vary.",
    remember: [
      "Risk = possible loss to the stop.",
      "Reward = possible gain to a target.",
      "1:2 means risk 1 to aim for 2.",
      "Ratio is a measuring stick, not safety.",
      "Reward is never guaranteed."
    ]
  },
  {
    id: "reading-the-plan",
    number: 14,
    title: "Reading the GoldMeta Plan",
    description: "A calm tour of the Plan page.",
    listenMinutes: 4,
    diagram: null,
    body: `The Plan page is your main day-trading screen.

Here is a simple walkthrough.

Decision:
Shows BUY, SELL, or WAIT.

Score:
Shows setup quality. Not a profit percent.

Current Price:
The latest gold price GoldMeta is using.

Market Story:
A plain explanation of what is happening.

Market Structure:
Higher highs, lower lows, or range context.

Why Waiting:
If the decision is WAIT, this explains what is still missing.

Trade Plan:
Entry, stop, and targets when a complete plan exists.

Next Action:
What to watch for next.

Phone alerts:
Can notify you about important plan events.

Read the Plan slowly.
If something is missing, WAIT can be the correct answer.`,
    example:
      "You open Plan. Decision says WAIT. Market Structure may already be ready, but Why Waiting says the 5-minute trade confirmation is still missing. GoldMeta waits for that final confirmation instead of forcing a trade.",
    remember: [
      "Plan is the main day screen.",
      "Decision, Score, Price, Story, Structure matter.",
      "Why Waiting explains incomplete setups.",
      "Trade Plan shows entry, stop, targets when ready.",
      "WAIT on Plan is information, not a crash."
    ]
  },
  {
    id: "reading-market-report",
    number: 15,
    title: "Reading the Market Report",
    description: "The approved single-page report, section by section.",
    listenMinutes: 4,
    diagram: null,
    body: `The Market Report is one clear page.
It summarises the market in a fixed order.

Read it like this:

Market Decision — BUY, SELL, or WAIT.
GoldMeta Score — setup quality, not profit chance.
Current Price — where gold is now.
Price Action 15M — recent 15-minute movement.
Price Structure — the shape of the path.
Market Story — the simple narrative.
Why Wait, Why Buy, or Why Sell — the reason in plain words.
Plan Readiness / Trade Plan — whether levels are ready.
Multi-Timeframe — whether bigger and smaller views agree.
Volatility — quiet or active.
Session — which world session is active.
Key Levels — important price areas.
Scenario Map — possible paths, not promises.

Use the report to understand conditions.
Do not treat it as a fortune teller.`,
    example:
      "Report says WAIT, score mid-range, 15M mixed, and plan readiness incomplete. That combination teaches patience better than forcing a trade.",
    remember: [
      "The report follows a fixed simple order.",
      "Score is quality, not win probability.",
      "Why Wait / Buy / Sell explains the reason.",
      "Multi-timeframe and volatility add context.",
      "Scenario Map shows possibilities, not guarantees."
    ]
  },
  {
    id: "multi-timeframe",
    number: 16,
    title: "Multi-Timeframe Analysis",
    description: "Check the close view and the far view together.",
    listenMinutes: 2,
    diagram: null,
    body: `Multi-timeframe means looking at more than one zoom level.

Example:
1H may show the bigger direction.
15M may show the medium plan.
5M may show short confirmation.

When they agree, the story can feel clearer.
When they disagree, WAIT is often wiser.

Agreement still does not guarantee profit.
Disagreement does not mean the app is wrong.`,
    example:
      "1H looks upward, 15M looks upward, but 5M has no confirmation yet. GoldMeta may stay on WAIT until the short piece arrives.",
    remember: [
      "Use more than one timeframe.",
      "Bigger picture plus close picture.",
      "Agreement can strengthen confidence in the story.",
      "Disagreement often means WAIT.",
      "Agreement is still not a guarantee."
    ]
  },
  {
    id: "market-sessions",
    number: 17,
    title: "Market Sessions",
    description: "Asia, London, and New York — different active hours.",
    listenMinutes: 2,
    diagram: "sessions",
    body: `The gold market is open across the world.
Different parts of the world become active at different times.

Asia session:
Often calmer for some periods.

London session:
Often busier as Europe becomes active.

New York session:
Often busy as America becomes active.

Overlap periods can be especially active.

Session alone does not predict direction.
It only tells you when more people may be awake and trading.`,
    example:
      "During London–New York overlap, gold may move more. That means more activity — not a promised up or down move.",
    remember: [
      "Asia, London, and New York are main sessions.",
      "Different hours can feel different.",
      "Overlap can be more active.",
      "Session ≠ direction signal.",
      "Session is timing context only."
    ]
  },
  {
    id: "autotrade-explained",
    number: 18,
    title: "AutoTrade Explained",
    description: "Gold Hunter is the AutoTrade UI. Live stays locked.",
    listenMinutes: 3,
    diagram: null,
    body: `Gold Hunter is the only AutoTrade UI.

Core AutoTrade and FAST AutoTrade were removed.
They are not an active engine any more.

Automated trading follows predefined Gold Hunter rules.
It is NOT a money button.
It does not print profit.

Trades can still lose in Demo.
Trades can still lose if Live is ever enabled later.

Live trading must never start automatically.
Live stays locked until separate activation.

Always stay in control of risk settings.`,
    example:
      "You use Gold Hunter on Demo with practice money. Core AutoTrade qualification was removed. Live remains locked.",
    remember: [
      "Gold Hunter is the AutoTrade UI.",
      "Core AutoTrade and FAST AutoTrade were removed.",
      "It is not a money button.",
      "Trades can still lose.",
      "Live must never auto-start."
    ]
  },
  {
    id: "qualification-demo",
    number: 19,
    title: "Qualification and Demo Trading",
    description: "Core qualification was removed. Gold Hunter is the AutoTrade UI.",
    listenMinutes: 3,
    diagram: null,
    body: `Core AutoTrade qualification was removed.

That old path — preview, controlled Demo trades, then observation — is no longer an active system.

Gold Hunter is the only AutoTrade UI.
Demo uses practice money.
It feels real, but it is not your live cash.

Safety checks still matter.
Limits, risk settings, and controls are reviewed in Gold Hunter.

Live remains LOCKED until separate activation.
Nothing in Gold Hunter unlocks Live by itself.`,
    example:
      "You use Gold Hunter on Demo. Core Demo Auto qualification was removed. Live still shows locked — that is correct.",
    remember: [
      "Core qualification was removed.",
      "Gold Hunter is the AutoTrade UI.",
      "Demo uses practice money.",
      "Live stays locked.",
      "Practice is for learning, not guaranteed profit."
    ]
  },
  {
    id: "phone-alerts",
    number: 20,
    title: "Phone Alerts",
    description: "Get notified about important Plan events.",
    listenMinutes: 2,
    diagram: null,
    body: `GoldMeta can send phone notifications for important Plan events.

Examples:
A new valid plan appears.
Price approaches entry.
Price reaches entry.
Confirmation arrives.
A plan is invalidated.
A target is reached.

Alerts help you pay attention.
Alerts do not guarantee a trade should be taken.
Alerts do not guarantee profit.

You still decide how to respond.
You still manage risk.`,
    example:
      "Your phone says “entry approaching.” You open Plan, re-check the story and risk, then decide. The alert was a reminder — not an order.",
    remember: [
      "Alerts notify. They do not decide for you.",
      "Common events include plan, entry, confirmation, invalidation, targets.",
      "An alert is not a trade guarantee.",
      "Always re-check Plan and risk.",
      "You stay in control."
    ]
  },
  {
    id: "complete-example",
    number: 21,
    title: "Complete GoldMeta Example",
    description: "One full story from WAIT to a BUY plan — both outcomes possible.",
    listenMinutes: 4,
    diagram: "buy-sell-wait",
    body: `Let’s walk through one calm example.

Gold is at 4,340.

1H looks bullish.
15M looks bullish.
Price is above POC.
But 5M confirmation is missing.

GoldMeta says WAIT.
That is correct.
The short confirmation piece is not ready yet.

Later, confirmation arrives.
GoldMeta creates a BUY plan.

Example levels:
Entry near 4,340.
Stop Loss near 4,330.
TP1 near 4,350.
TP2 near 4,360.
TP3 near 4,370.
Risk to reward toward TP1 is about 1 to 1, and farther targets are larger.

Now two outcomes are possible.

Outcome A:
Price moves toward the targets.

Outcome B:
Price falls to the Stop Loss.

No outcome is guaranteed.
A clear plan still involves risk.

GoldMeta helped describe conditions and levels.
GoldMeta did not know the future.`,
    example:
      "WAIT while 5M confirmation is missing → confirmation arrives → BUY plan with entry, stop, and targets → price may hit TP or stop. Both remain possible.",
    remember: [
      "Incomplete confirmation → WAIT can be right.",
      "A BUY plan still needs entry, stop, and targets.",
      "Targets and stops are both possible endings.",
      "Nothing is guaranteed.",
      "Education first. Risk always exists."
    ]
  }
];

export function getLessonById(id: string | undefined | null): LearnLesson | null {
  if (!id) return null;
  return LEARN_LESSONS.find((l) => l.id === id) ?? null;
}

export function getLessonByNumber(n: number): LearnLesson | null {
  return LEARN_LESSONS.find((l) => l.number === n) ?? null;
}

export const LEARN_LESSON_COUNT = LEARN_LESSONS.length;
