/**
 * GOLD_HUNTER V1.1 recovery checkpoint state.
 * Persisted after each major research stage so a Cursor reset can resume.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type V11RecoveryStage =
  | "INIT"
  | "DATA_READY"
  | "TRAIN_COMPLETE"
  | "OPTIMIZER_DONE"
  | "FULL_VALIDATION_STARTED"
  | "FULL_VALIDATION_COMPLETE"
  | "CONFIG_FROZEN"
  | "RECOVERY_HOLDOUT_COMPLETE"
  | "AUG6_13_AUDIT_COMPLETE"
  | "COMPLETE"
  | "BLOCKED";

export type V11RecoveryState = {
  runId: string;
  gitSha: string;
  datasetHash: string | null;
  stage: V11RecoveryStage;
  timestampUtc: string;
  candidateCount: number;
  selectedCandidate: {
    family: string;
    architecture: string;
    rankQuantile: number | null;
  } | null;
  frozenSha256: string | null;
  notes?: string;
  dataDir?: string;
};

export function recoveryStatePath(dataDir: string): string {
  return join(dataDir, "..", "v11-recovery-state.json");
}

export function writeRecoveryState(
  dataDir: string,
  patch: Partial<V11RecoveryState> &
    Pick<V11RecoveryState, "runId" | "gitSha" | "stage">
): V11RecoveryState {
  const path = join(dataDir, "v11-recovery-state.json");
  // Also mirror one level up for discoverability after partial data loss.
  const mirror = recoveryStatePath(dataDir);
  let prev: Partial<V11RecoveryState> = {};
  if (existsSync(path)) {
    try {
      prev = JSON.parse(readFileSync(path, "utf8")) as V11RecoveryState;
    } catch {
      prev = {};
    }
  }
  const next: V11RecoveryState = {
    runId: patch.runId,
    gitSha: patch.gitSha,
    datasetHash: patch.datasetHash ?? prev.datasetHash ?? null,
    stage: patch.stage,
    timestampUtc: new Date().toISOString(),
    candidateCount: patch.candidateCount ?? prev.candidateCount ?? 0,
    selectedCandidate:
      patch.selectedCandidate !== undefined
        ? patch.selectedCandidate
        : (prev.selectedCandidate ?? null),
    frozenSha256:
      patch.frozenSha256 !== undefined
        ? patch.frozenSha256
        : (prev.frozenSha256 ?? null),
    notes: patch.notes ?? prev.notes,
    dataDir
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2));
  try {
    mkdirSync(dirname(mirror), { recursive: true });
    writeFileSync(mirror, JSON.stringify(next, null, 2));
  } catch {
    // mirror is best-effort
  }
  console.log(
    JSON.stringify({
      event: "gh_v11_recovery_checkpoint",
      stage: next.stage,
      runId: next.runId,
      frozenSha256: next.frozenSha256
    })
  );
  return next;
}

export function readRecoveryState(dataDir: string): V11RecoveryState | null {
  const path = join(dataDir, "v11-recovery-state.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as V11RecoveryState;
  } catch {
    return null;
  }
}
