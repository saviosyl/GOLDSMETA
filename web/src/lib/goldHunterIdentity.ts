/**
 * Compact Gold Hunter identity for UI display.
 * Trading schema / historical trade documents are not modified here.
 */
import { GOLD_META_COMMIT_SHA } from "./buildIdentity";

export const GOLD_HUNTER_PRODUCT_LABEL = "Gold Hunter";
export const GOLD_HUNTER_BRAIN_LABEL = "Brain V3";
/** UI revision for this frontend cleanup. Bump when the Gold Hunter shell ships. */
export const GOLD_HUNTER_UI_REV = "2026.08.20-01";

export function goldHunterBuildShort(sha: string = GOLD_META_COMMIT_SHA): string {
  const clean = (sha || "dev").trim();
  return clean.slice(0, 7);
}

/** UI-only: hide leftover AutoTrade wording in wait/gate strings. */
export function goldHunterDisplayWait(raw: string): string {
  return raw
    .replace(/START DEMO AUTOTRADE/gi, "START DEMO")
    .replace(/Demo AutoTrade/gi, "Gold Hunter Demo")
    .replace(/AUTOTRADE OFF/g, "DEMO OFF")
    .replace(/\bAutoTrade\b/gi, "Gold Hunter");
}
