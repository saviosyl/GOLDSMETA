/**
 * Aggressive redaction for broker / preview payloads.
 * Never leak passwords, API keys, tokens, CST, X-SECURITY-TOKEN, or full account IDs.
 */

const SENSITIVE_KEY =
  /password|passwd|api[_-]?key|api[_-]?secret|secret|token|authorization|cst|x-?security-?token|accountid|account[_-]?id|credentials?/i;

function maskAccountId(id: string): string {
  const raw = String(id || "").trim();
  if (raw.length <= 4) return "****";
  return `${raw.slice(0, 2)}…${raw.slice(-2)}`;
}

export function redactSecrets<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    if (/CST|X-SECURITY-TOKEN|Bearer\s+\S+|Authorization[=:\s]/i.test(value)) {
      return "[REDACTED]";
    }
    return value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactValue);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      if (SENSITIVE_KEY.test(key)) {
        if (/account/i.test(key) && typeof entry === "string") {
          return [key, maskAccountId(entry)];
        }
        return [key, "[REDACTED]"];
      }
      return [key, redactValue(entry)];
    })
  );
}

export function assertNoSecretsInText(text: string): boolean {
  const forbidden = [
    /CST[=:\s]+\S+/i,
    /X-SECURITY-TOKEN[=:\s]+\S+/i,
    /api[_-]?key[=:\s]+\S+/i,
    /password[=:\s]+\S+/i,
    /Authorization[=:\s]+\S+/i,
    /Bearer\s+[A-Za-z0-9._-]{20,}/i
  ];
  return !forbidden.some((re) => re.test(text));
}
