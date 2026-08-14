/**
 * Periodic LIVE vs REPLAY equivalence check against frozen soak config.
 * Applies RESYNC markers so live force-closes / book resets stay in parity.
 * LIVE_REPLAY_OK requires action parity AND entry/exit/resync count equality.
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
  liveResyncs: number;
  replayResyncs: number;
  firstDivergence: {
    seq: number;
    field: string;
    live: unknown;
    replay: unknown;
  } | null;
  code: "LIVE_REPLAY_OK" | "LIVE_REPLAY_DIVERGENCE" | "LIVE_REPLAY_NO_DATA";
};

function emptyNoData(): ReplayParityResult {
  return {
    ok: false,
    comparedEvents: 0,
    liveEntries: 0,
    replayEntries: 0,
    liveExits: 0,
    replayExits: 0,
    liveResyncs: 0,
    replayResyncs: 0,
    firstDivergence: null,
    code: "LIVE_REPLAY_NO_DATA"
  };
}

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

function isAuditExitRow(row: GhFastCollectorRecord): boolean {
  return (
    row.recordType === "AUDIT_EXIT" ||
    row.event.kind === "RESYNC_EXIT_AUDIT" ||
    (typeof row.event.eventId === "string" &&
      row.event.eventId.startsWith("RESYNC_EXIT:"))
  );
}

export async function verifyReplayParityFromLocalChunks(args: {
  chunkDir: string;
  maxEvents?: number;
  /** When false, replay with args.config (or defaults) instead of frozen soak. */
  useFrozenSoakConfig?: boolean;
  config?: import("./types").GhFastConfig | Partial<import("./types").GhFastConfig>;
}): Promise<ReplayParityResult> {
  if (!existsSync(args.chunkDir)) return emptyNoData();
  const files = readdirSync(args.chunkDir)
    .filter((f) => f.endsWith(".ndjson.gz"))
    .sort();
  const adapter = new ShadowExecutionAdapter();
  const engine = new GoldHunterFastEngine({
    adapter,
    useFrozenSoakConfig: args.useFrozenSoakConfig !== false,
    config: args.config
  });

  let compared = 0;
  let liveEntries = 0;
  let liveExits = 0;
  let liveResyncs = 0;
  let firstDivergence: ReplayParityResult["firstDivergence"] = null;
  const max = args.maxEvents ?? 50_000;
  /** Pending force-close audits awaiting the following RESYNC apply. */
  const pendingAudits: Array<{
    tradeId: string;
    exitReason: string | null;
    reason: string;
    seq: number;
  }> = [];

  for (const file of files) {
    const rows = await readNdjsonGz(join(args.chunkDir, file));
    for (const row of rows) {
      if (compared >= max) break;

      if (isAuditExitRow(row)) {
        liveExits += 1;
        pendingAudits.push({
          tradeId:
            row.tradeExit?.tradeId ??
            (row.event.kind === "RESYNC_EXIT_AUDIT"
              ? row.event.tradeId
              : "unknown"),
          exitReason: row.decision.exitReason ?? row.tradeExit?.exitReason ?? null,
          reason:
            row.tradeExit?.resyncReason != null
              ? String(row.tradeExit.resyncReason)
              : row.event.kind === "RESYNC_EXIT_AUDIT"
                ? String(row.event.reason)
                : "unknown",
          seq: row.event.receiveSeq
        });
        // Never apply audit as a market tick.
        continue;
      }

      const ev = row.event as GhFastStreamEvent;
      const liveAction = row.decision.action;
      const liveSetup = row.decision.setup;
      if (liveAction === "ENTER_BUY" || liveAction === "ENTER_SELL") liveEntries += 1;
      if (liveAction === "EXIT") liveExits += 1;
      if (liveAction === "RESYNC" || ev.kind === "RESYNC") liveResyncs += 1;

      const closedBefore = engine.closed.length;
      const replayDec = await applyStreamEvent(engine, ev);
      compared += 1;

      if (ev.kind === "RESYNC" && pendingAudits.length) {
        const closedAfter = engine.closed.slice(closedBefore);
        for (const audit of pendingAudits) {
          const match = closedAfter.find((t) => t.tradeId === audit.tradeId);
          if (!match && !firstDivergence) {
            firstDivergence = {
              seq: audit.seq,
              field: "trade_id",
              live: audit.tradeId,
              replay: closedAfter.map((t) => t.tradeId)
            };
          } else if (match && match.exitReason !== audit.exitReason && !firstDivergence) {
            firstDivergence = {
              seq: audit.seq,
              field: "exit_reason",
              live: audit.exitReason,
              replay: match.exitReason
            };
          } else if (
            match &&
            audit.reason &&
            match.resyncReason != null &&
            String(match.resyncReason) !== audit.reason &&
            !firstDivergence
          ) {
            firstDivergence = {
              seq: audit.seq,
              field: "resync_reason",
              live: audit.reason,
              replay: match.resyncReason
            };
          } else if (
            match &&
            match.resetSequence != null &&
            match.resetSequence !== audit.seq &&
            !firstDivergence
          ) {
            firstDivergence = {
              seq: audit.seq,
              field: "resync_sequence",
              live: audit.seq,
              replay: match.resetSequence
            };
          }
        }
        pendingAudits.length = 0;
      }

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
  const replayResyncs = engine.resyncMarkers.length;

  if (compared === 0) return emptyNoData();

  if (!firstDivergence && liveEntries !== replayEntries) {
    firstDivergence = {
      seq: -1,
      field: "entry_count",
      live: liveEntries,
      replay: replayEntries
    };
  }
  if (!firstDivergence && liveExits !== replayExits) {
    firstDivergence = {
      seq: -1,
      field: "exit_count",
      live: liveExits,
      replay: replayExits
    };
  }
  if (!firstDivergence && liveResyncs !== replayResyncs) {
    firstDivergence = {
      seq: -1,
      field: "resync_count",
      live: liveResyncs,
      replay: replayResyncs
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
      liveResyncs,
      replayResyncs,
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
    liveResyncs,
    replayResyncs,
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
  let compared = 0;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    if (ev.kind === "RESYNC_EXIT_AUDIT") continue;
    const da = await applyStreamEvent(ea, ev);
    const db = await applyStreamEvent(eb, ev);
    compared += 1;
    if (da.action !== db.action || da.state !== db.state) {
      firstDivergence = {
        seq: ev.receiveSeq ?? i,
        field: "action",
        live: da.action,
        replay: db.action
      };
      break;
    }
  }
  // Count shadow orders / markers — RESYNC force-closes emit EXIT on the adapter
  // while the returned decision action is RESYNC.
  const liveEntries = a.orders.filter((o) => o.kind === "ENTER").length;
  const liveExits = a.orders.filter((o) => o.kind === "EXIT").length;
  const liveResyncs = ea.resyncMarkers.length;
  const replayEntries = b.orders.filter((o) => o.kind === "ENTER").length;
  const replayExits = b.orders.filter((o) => o.kind === "EXIT").length;
  const replayResyncs = eb.resyncMarkers.length;
  if (!firstDivergence && liveEntries !== replayEntries) {
    firstDivergence = {
      seq: -1,
      field: "entry_count",
      live: liveEntries,
      replay: replayEntries
    };
  }
  if (!firstDivergence && liveExits !== replayExits) {
    firstDivergence = {
      seq: -1,
      field: "exit_count",
      live: liveExits,
      replay: replayExits
    };
  }
  if (!firstDivergence && liveResyncs !== replayResyncs) {
    firstDivergence = {
      seq: -1,
      field: "resync_count",
      live: liveResyncs,
      replay: replayResyncs
    };
  }
  return {
    ok: !firstDivergence,
    comparedEvents: compared,
    liveEntries,
    replayEntries,
    liveExits,
    replayExits,
    liveResyncs,
    replayResyncs,
    firstDivergence,
    code: firstDivergence
      ? "LIVE_REPLAY_DIVERGENCE"
      : compared
        ? "LIVE_REPLAY_OK"
        : "LIVE_REPLAY_NO_DATA"
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
