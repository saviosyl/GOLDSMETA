/**
 * Collision-safe FAST clientOrderId.
 *
 * cTrader ProtoOANewOrderReq.clientOrderId maxLength = 50.
 * Identity is a SHA-256 of the FULL ownerUid + signalId — never truncation.
 */

import { createHash } from "crypto";

export const FAST_CLIENT_ORDER_ID_MAX_LEN = 50;
export const FAST_CLIENT_ORDER_ID_HASH_LEN = 16;

const SAFE_CHAR = /[^a-zA-Z0-9_]/g;
const NEW_FORMAT =
  /^fa_[A-Za-z0-9]+_(BUY|SELL|NA)_[a-f0-9]{16}$/;

export type FastClientOrderIdArgs = {
  ownerUid: string;
  signalId: string;
};

export function isFastClientOrderIdCharset(id: string): boolean {
  return /^[A-Za-z0-9_]+$/.test(id) && id.length > 0 && id.length <= FAST_CLIENT_ORDER_ID_MAX_LEN;
}

export function isLegacyTruncatedFastClientOrderId(id: string): boolean {
  const raw = String(id || "").trim();
  if (!raw.startsWith("fa_")) return false;
  if (NEW_FORMAT.test(raw)) return false;
  return isFastClientOrderIdCharset(raw);
}

function shortReadablePrefix(signalId: string): string {
  const raw = String(signalId || "");
  const dir = /\bSELL\b/i.test(raw) ? "SELL" : /\bBUY\b/i.test(raw) ? "BUY" : "NA";
  let setup = "sig";
  if (/BREAKOUT/i.test(raw)) setup = "brk";
  else if (/PULLBACK/i.test(raw)) setup = "pbk";
  else if (/REVERSAL/i.test(raw)) setup = "rev";
  else {
    const compact = raw.replace(SAFE_CHAR, "");
    setup = (compact.slice(0, 3) || "sig").toLowerCase();
  }
  return `${setup}_${dir}`.slice(0, 20);
}

export function hashOwnerSignal(ownerUid: string, signalId: string): string {
  return createHash("sha256")
    .update(String(ownerUid ?? ""), "utf8")
    .update("\n", "utf8")
    .update(String(signalId ?? ""), "utf8")
    .digest("hex")
    .slice(0, FAST_CLIENT_ORDER_ID_HASH_LEN);
}

/**
 * Deterministic FAST clientOrderId.
 * Same ownerUid+signalId → same id. Different owners → different ids.
 */
export function generateFastClientOrderId(
  signalId: string,
  ownerUid = ""
): string {
  const prefix = shortReadablePrefix(signalId);
  const hash = hashOwnerSignal(ownerUid, signalId);
  const id = `fa_${prefix}_${hash}`;
  if (id.length > FAST_CLIENT_ORDER_ID_MAX_LEN) {
    return `fa_${hash}`.slice(0, FAST_CLIENT_ORDER_ID_MAX_LEN);
  }
  return id;
}

export function generateFastClientOrderIdForOwner(args: FastClientOrderIdArgs): string {
  return generateFastClientOrderId(args.signalId, args.ownerUid);
}
