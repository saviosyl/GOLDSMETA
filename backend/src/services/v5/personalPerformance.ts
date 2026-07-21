import type { JournalEntry } from "../../models/types";
import type { SetupRecord } from "../../models/setup";
import type { PersonalBehaviourStats } from "./types";

/**
 * Private per-user behaviour analytics from journal tags + setup outcomes.
 * Never invents performance.
 */
export function computePersonalBehaviour(input: {
  journal: JournalEntry[];
  setups?: SetupRecord[];
}): PersonalBehaviourStats {
  const journal = input.journal;
  const tags = journal.flatMap((j) => j.tags ?? []).map((t) => t.toLowerCase());
  const countTag = (...keys: string[]) =>
    tags.filter((t) => keys.some((k) => t.includes(k))).length;

  const ignoredWait = countTag("ignored wait", "ignored_wait", "fomo");
  const enteredTooEarly = countTag("too early", "early entry", "entered_early");
  const closedTooEarly = countTag("closed early", "took profit early", "closed_early");
  const heldTooLong = countTag("held too long", "overheld", "held_long");

  const setups = input.setups ?? [];
  const bySession = new Map<string, number>();
  for (const s of setups) {
    const session = s.session ?? "UNKNOWN";
    const r = s.outcome?.rawRealisedR ?? null;
    if (r != null) bySession.set(session, (bySession.get(session) ?? 0) + r);
  }
  let mostProfitableSession: string | null = null;
  let best = -Infinity;
  for (const [k, v] of bySession) {
    if (v > best) {
      best = v;
      mostProfitableSession = k;
    }
  }

  const rs = setups
    .map((s) => s.outcome?.rawRealisedR)
    .filter((n): n is number => typeof n === "number");
  let winStreak = 0;
  let loseStreak = 0;
  let maxWin = 0;
  let maxLose = 0;
  for (const r of rs) {
    if (r > 0) {
      winStreak += 1;
      loseStreak = 0;
      maxWin = Math.max(maxWin, winStreak);
    } else if (r < 0) {
      loseStreak += 1;
      winStreak = 0;
      maxLose = Math.max(maxLose, loseStreak);
    } else {
      winStreak = 0;
      loseStreak = 0;
    }
  }

  const byDay = new Map<string, number>();
  for (const s of setups) {
    const day = s.resolvedAt?.slice(0, 10) ?? s.createdAt.slice(0, 10);
    const r = s.outcome?.rawRealisedR;
    if (r != null) byDay.set(day, (byDay.get(day) ?? 0) + r);
  }
  let worstDay: string | null = null;
  let worst = Infinity;
  for (const [k, v] of byDay) {
    if (v < worst) {
      worst = v;
      worstDay = k;
    }
  }

  const insufficient = journal.length === 0 && setups.length === 0;

  return {
    ignoredWait,
    enteredTooEarly,
    closedTooEarly,
    heldTooLong,
    mostProfitableSession,
    worstDay,
    bestStrategy: null,
    largestWinningStreak: maxWin,
    largestLosingStreak: maxLose,
    averageR:
      rs.length > 0 ? Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 100) / 100 : null,
    averagePatienceBars: null,
    journalEntries: journal.length,
    sampleWarning:
      journal.length + setups.length < 20
        ? "Extremely small personal sample — behavioural stats are illustrative only."
        : "Personal stats are private and descriptive only.",
    private: true,
    insufficientData: insufficient
  };
}
