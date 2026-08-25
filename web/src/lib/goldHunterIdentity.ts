/**
 * Compact Gold Hunter identity for UI display.
 * Trading schema / historical trade documents are not modified here.
 */
import { GOLD_META_COMMIT_SHA } from "./buildIdentity";

export const GOLD_HUNTER_PRODUCT_LABEL = "Gold Hunter";

export function goldHunterBuildShort(sha: string = GOLD_META_COMMIT_SHA): string {
  const clean = (sha || "dev").trim();
  return clean.slice(0, 7);
}

export function goldHunterDisplayBrainVersion(raw: string | null | undefined): string {
  if (!raw) return "—";
  const m = raw.match(/_V(\d+)$/);
  if (m) return `V${m[1]}`;
  return raw;
}

export function goldHunterDisplayStrategyVariant(raw: string | null | undefined): string {
  if (!raw) return "—";
  return raw
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseSoftwareRevision(
  raw: string | null | undefined
): {
  brainNumber: string;
  strategyVariant: string;
  y: string;
  m: string;
  d: string;
  seq: string;
} | null {
  if (!raw) return null;
  const m = raw.match(
    /^GH_BRAIN_V(\d+)_([A-Z0-9_]+)_([0-9]{4})\.([0-9]{2})\.([0-9]{2})-(\d{2})$/
  );
  if (!m) return null;
  return {
    brainNumber: m[1],
    strategyVariant: m[2],
    y: m[3],
    m: m[4],
    d: m[5],
    seq: m[6]
  };
}

export function goldHunterRevisionFromSoftwareRevision(
  softwareRevision: string | null | undefined
): string | null {
  const parsed = parseSoftwareRevision(softwareRevision);
  if (!parsed) return null;
  return `GH-B${parsed.brainNumber}-${parsed.y}${parsed.m}${parsed.d}-${parsed.seq}`;
}

export function goldHunterVariantFromSoftwareRevision(
  softwareRevision: string | null | undefined
): string | null {
  const parsed = parseSoftwareRevision(softwareRevision);
  if (!parsed) return null;
  return parsed.strategyVariant;
}

/** UI-only: hide leftover AutoTrade wording in wait/gate strings. */
export function goldHunterDisplayWait(raw: string): string {
  return raw
    .replace(/START DEMO AUTOTRADE/gi, "START DEMO")
    .replace(/Demo AutoTrade/gi, "Gold Hunter Demo")
    .replace(/AUTOTRADE OFF/g, "DEMO OFF")
    .replace(/\bAutoTrade\b/gi, "Gold Hunter");
}
