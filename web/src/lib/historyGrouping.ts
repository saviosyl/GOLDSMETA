/**
 * Group repeated identical WAIT checks for Signal History (no layout redesign).
 */

export type HistoryGroupable = {
  decisionId: string;
  decision: string;
  generatedAt: string;
  reasonCodes?: string[] | null;
  oneLineReason?: string | null;
};

export type HistoryDisplayItem =
  | { kind: "single"; item: HistoryGroupable }
  | {
      kind: "wait_group";
      id: string;
      startAt: string;
      endAt: string;
      count: number;
      reason: string;
      items: HistoryGroupable[];
    };

const waitBucketKey = (item: HistoryGroupable): string => {
  const code = (item.reasonCodes?.[0] || item.oneLineReason || "WAIT").toUpperCase();
  // Bucket by calendar hour UTC so a long confirmation wait collapses.
  const hour = item.generatedAt.slice(0, 13);
  return `${code}|${hour}`;
};

export function groupHistoryItems(items: HistoryGroupable[]): HistoryDisplayItem[] {
  const out: HistoryDisplayItem[] = [];
  let i = 0;
  while (i < items.length) {
    const cur = items[i]!;
    if (String(cur.decision).toUpperCase() !== "WAIT") {
      out.push({ kind: "single", item: cur });
      i += 1;
      continue;
    }
    const key = waitBucketKey(cur);
    const group = [cur];
    let j = i + 1;
    while (j < items.length) {
      const next = items[j]!;
      if (String(next.decision).toUpperCase() !== "WAIT") break;
      if (waitBucketKey(next) !== key) break;
      group.push(next);
      j += 1;
    }
    if (group.length >= 3) {
      const times = group.map((g) => Date.parse(g.generatedAt)).filter(Number.isFinite);
      const start = new Date(Math.min(...times)).toISOString();
      const end = new Date(Math.max(...times)).toISOString();
      out.push({
        kind: "wait_group",
        id: `wait-group-${group[0]!.decisionId}`,
        startAt: start,
        endAt: end,
        count: group.length,
        reason:
          group[0]!.oneLineReason ||
          "checks waiting for confirmation or a complete setup",
        items: group
      });
    } else {
      for (const g of group) out.push({ kind: "single", item: g });
    }
    i = j;
  }
  return out;
}

export function formatWaitGroupLabel(group: Extract<HistoryDisplayItem, { kind: "wait_group" }>): string {
  const start = new Date(group.startAt);
  const end = new Date(group.endAt);
  const fmt = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${fmt(start)}–${fmt(end)} · ${group.count} checks waiting for 5M confirmation`;
}
