import { getFirestore } from "firebase-admin/firestore";
import { randomBytes } from "crypto";
import type { AutoTradeEnvironment } from "./userAutoTradeSettings";

export type SettingsAuditEntry = {
  id: string;
  uid: string;
  environment: AutoTradeEnvironment;
  at: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  buildSha: string | null;
};

function col(uid: string) {
  return getFirestore().collection(`users/${uid}/autotradeSettingsAudit`);
}

export async function recordSettingsChanges(args: {
  uid: string;
  environment: AutoTradeEnvironment;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  fields: string[];
}): Promise<void> {
  const buildSha =
    (process.env.GOLD_META_COMMIT_SHA || process.env.VITE_GOLD_META_COMMIT_SHA || "").trim() ||
    null;
  const batch = getFirestore().batch();
  let n = 0;
  for (const field of args.fields) {
    const oldValue = args.before[field];
    const newValue = args.after[field];
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;
    const id = `sa_${Date.now().toString(36)}_${randomBytes(2).toString("hex")}_${field}`;
    const row: SettingsAuditEntry = {
      id,
      uid: args.uid,
      environment: args.environment,
      at: new Date().toISOString(),
      field,
      oldValue: oldValue ?? null,
      newValue: newValue ?? null,
      buildSha
    };
    batch.set(col(args.uid).doc(id), row);
    n += 1;
  }
  if (n > 0) await batch.commit();
}
