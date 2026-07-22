/**
 * Aggressive redaction for Stocks Intraday / T212 payloads.
 */

import { maskSecret } from "./featureFlags";

const SENSITIVE_KEY =
  /password|passwd|api[_-]?key|api[_-]?secret|secret|token|authorization|credential/i;

export function redactSecrets<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    if (/Bearer\s+\S+/i.test(value) || /Basic\s+\S+/i.test(value)) return "[REDACTED]";
    return value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactValue);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      if (SENSITIVE_KEY.test(key)) {
        if (typeof entry === "string") return [key, maskSecret(entry)];
        return [key, "[REDACTED]"];
      }
      return [key, redactValue(entry)];
    })
  );
}

export function assertNoSecretsInText(text: string): boolean {
  const forbidden = [
    /api[_-]?key[=:\s]+\S+/i,
    /api[_-]?secret[=:\s]+\S+/i,
    /password[=:\s]+\S+/i,
    /Bearer\s+[A-Za-z0-9._-]{16,}/i,
    /Basic\s+[A-Za-z0-9+/=]{16,}/i
  ];
  return !forbidden.some((re) => re.test(text));
}
