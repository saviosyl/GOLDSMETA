/**
 * Periodic LIVE vs REPLAY equivalence check against frozen soak config.
 * Applies RESYNC markers so live force-closes / book resets stay in parity.
 */
import { createGunzip } from "node:zlib";
import { createReadStream, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { GoldHunterFastEngine } from "./engine";
import { ShadowExecutionAdapter } from "./executionAdapter";
import type { GhFastCollectorRecord } from "./collector";
import { applyStreamEvent } from "./replay";
import type { GhFastStreamEvent } from "./types";

export type ReplayParityResult = {
  ok: boolean;
  comparedEvents: number;
  liveEntries: number;
  replayEntries: number;
  liveExits: number;
  replayExits: number;
  firstDivergence: {
    seq: number;
    field: string;
    live: unknown;
    replay: unknown;
  } | null;
  code: "LIVE_REPLAY_OK" | "LIVE_REPLAY_DIVERGENCE" | "LIVE_REPLAY_NO_DATA";
};

async function readNdjsonGz(path: string): Promise<GhFastCollectorRecord[]> {
  const rows: GhFastCollectorRecord[] = [];
  const stream = createReadStream(path).pipe(createGunzip());
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line) as GhFastCollectorRecord);
  }
  return rows;
}

export async function verifyReplayParityFromLocalChunks(args: {
  chunkDir: string;
  maxEvents?: number;
}): Promise<ReplayParityResult> {
  if (!existsSync(args.chunkDir)) {
    return {
      ok: false,
      comparedEvents: 0,
      liveEntries: 0,
      replayEntries: 0,
      liveExits: 0,
      replayExits: 0,
      firstDivergence: null,
      code: "LIVE_REPLAY_NO_DATA"
    };
  }
  const files = readdirSync(args.chunkDir)
    .filter((f) => f.endsWith(".ndjson.gz"))
    .sort();
  const adapter = new ShadowExecutionAdapter();
  const engine = new GoldHunterFastEngine({
    adapter,
    useFrozenSoakConfig: true
  });

  let compared = 0;
  let liveEntries = 0;
  let liveExits = 0;
  let firstDivergence: ReplayParityResult["firstDivergence"] = null;
  const max = args.maxEvents ?? 50_000;

  for (const file of files) {
    const rows = await readNdjsonGz(join(args.chunkDir, file));
    for (const row of rows) {
      if (compared >= max) break;
      // Skip synthetic RESYNC_EXIT companion rows — the RESYNC marker applies the close.
      if (
        row.event.kind !== "RESYNC" &&
        typeof row.event.eventId === "string" &&
        row.event.eventId.startsWith("RESYNC_EXIT:")
      ) {
        if (row.decision.action === "EXIT") liveExits += 1;
        continue;
      }

      const ev = row.event as GhFastStreamEvent;
      const liveAction = row.decision.action;
      const liveSetup = row.decision.setup;
      if (liveAction === "ENTER_BUY" || liveAction === "ENTER_SELL") liveEntries += 1;
      if (liveAction === "EXIT") liveExits += 1;

      const replayDec = await applyStreamEvent(engine, ev);
      compared += 1;

      if (replayDec.action !== liveAction && !firstDivergence) {
        firstDivergence = {
          seq: ev.receiveSeq ?? compared,
          field: "action",
          live: liveAction,
          replay: replayDec.action
        };
      } else if (
        (liveAction === "ENTER_BUY" || liveAction === "ENTER_SELL") &&
        replayDec.setup !== liveSetup &&
        !firstDivergence
      ) {
        firstDivergence = {
          seq: ev.receiveSeq ?? compared,
          field: "setup",
          live: liveSetup,
          replay: replayDec.setup
        };
      }
    }
    if (compared >= max) break;
  }

  const replayEntries = adapter.orders.filter((o) => o.kind === "ENTER").length;
  const replayExits = adapter.orders.filter((o) => o.kind === "EXIT").length;

  if (compared === 0) {
    return {
      ok: false,
      comparedEvents: 0,
      liveEntries: 0,
      replayEntries: 0,
      liveExits: 0,
      replayExits: 0,
      firstDivergence: null,
      code: "LIVE_REPLAY_NO_DATA"
    };
  }

  if (firstDivergence) {
    return {
      ok: false,
      comparedEvents: compared,
      liveEntries,
      replayEntries,
      liveExits,
      replayExits,
      firstDivergence,
      code: "LIVE_REPLAY_DIVERGENCE"
    };
  }

  return {
    ok: true,
    comparedEvents: compared,
    liveEntries,
    replayEntries,
    liveExits,
    replayExits,
    firstDivergence: null,
    code: "LIVE_REPLAY_OK"
  };
}

/** Sync helper for tiny in-memory parity tests. */
export async function verifyReplayParityFromEvents(
  events: GhFastStreamEvent[]
): Promise<ReplayParityResult> {
  const a = new ShadowExecutionAdapter();
  const b = new ShadowExecutionAdapter();
  const ea = new GoldHunterFastEngine({ adapter: a, useFrozenSoakConfig: true });
  const eb = new GoldHunterFastEngine({ adapter: b, useFrozenSoakConfig: true });
  let firstDivergence: ReplayParityResult["firstDivergence"] = null;
  for (let i = 0; i < events.length; i++) {
    const da = await applyStreamEvent(ea, events[i]!);
    const db = await applyStreamEvent(eb, events[i]!);
    if (da.action !== db.action || da.state !== db.state) {
      firstDivergence = {
        seq: events[i]!.receiveSeq ?? i,
        field: "action",
        live: da.action,
        replay: db.action
      };
      break;
    }
  }
  return {
    ok: !firstDivergence,
    comparedEvents: events.length,
    liveEntries: a.orders.filter((o) => o.kind === "ENTER").length,
    replayEntries: b.orders.filter((o) => o.kind === "ENTER").length,
    liveExits: a.orders.filter((o) => o.kind === "EXIT").length,
    replayExits: b.orders.filter((o) => o.kind === "EXIT").length,
    firstDivergence,
    code: firstDivergence ? "LIVE_REPLAY_DIVERGENCE" : "LIVE_REPLAY_OK"
  };
}

export function readLocalCheckpoint(chunkDir: string): unknown[] {
  const p = join(chunkDir, "checkpoint.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l): unknown => JSON.parse(l) as unknown);
}
