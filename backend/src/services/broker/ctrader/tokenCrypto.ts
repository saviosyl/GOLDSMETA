/**
 * Server-side token encryption helpers.
 * Tokens must never be stored plaintext in Firestore or returned to the browser.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function encryptTokenPayload(
  plaintext: string,
  encryptionSecret: string
): string {
  const key = deriveKey(encryptionSecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

export function decryptTokenPayload(
  payload: string,
  encryptionSecret: string
): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("CTRADER_TOKEN_PAYLOAD_INVALID");
  }
  const key = deriveKey(encryptionSecret);
  const iv = Buffer.from(parts[1]!, "base64url");
  const tag = Buffer.from(parts[2]!, "base64url");
  const data = Buffer.from(parts[3]!, "base64url");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function maskAccountId(accountId: string | number): string {
  const s = String(accountId);
  if (s.length <= 4) return "••••";
  return `${s.slice(0, 2)}…${s.slice(-2)}`;
}

export function hashAccountKey(accountId: string | number): string {
  return createHash("sha256").update(String(accountId)).digest("hex").slice(0, 24);
}
