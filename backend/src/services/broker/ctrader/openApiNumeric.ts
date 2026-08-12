/**
 * Safe numeric conversion for cTrader Open API int64/uint64 fields.
 *
 * @reiryoku/ctrader-layer may decode 64-bit values as number, string, bigint,
 * or a protobufjs Long-like object ({ low, high, unsigned, toString }).
 *
 * Identifiers must not be silently rounded. Money values require validated
 * moneyDigits before scaling.
 */

export type NumericRuntimeKind =
  | "number"
  | "string"
  | "bigint"
  | "long_like"
  | "null"
  | "undefined"
  | "other";

export function describeRuntimeType(value: unknown): {
  kind: NumericRuntimeKind;
  ctor: string | null;
  preview: string | null;
} {
  if (value === null) return { kind: "null", ctor: null, preview: null };
  if (value === undefined)
    return { kind: "undefined", ctor: null, preview: null };
  if (typeof value === "number") {
    return {
      kind: "number",
      ctor: "Number",
      preview: Number.isFinite(value) ? String(value) : String(value)
    };
  }
  if (typeof value === "string") {
    return {
      kind: "string",
      ctor: "String",
      preview: value.length > 64 ? `${value.slice(0, 64)}…` : value
    };
  }
  if (typeof value === "bigint") {
    return { kind: "bigint", ctor: "BigInt", preview: value.toString() };
  }
  if (isLongLike(value)) {
    let preview: string | null = null;
    try {
      preview = value.toString();
    } catch {
      preview = null;
    }
    return {
      kind: "long_like",
      ctor: Object.prototype.toString.call(value),
      preview
    };
  }
  return {
    kind: "other",
    ctor: Object.prototype.toString.call(value),
    preview: null
  };
}

function isLongLike(
  value: unknown
): value is { toString: () => string; low?: unknown; high?: unknown } {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  if (typeof o.toString !== "function") return false;
  // protobufjs Long / long.js typically expose low/high (and often unsigned).
  if ("low" in o && "high" in o) return true;
  // Some builds expose only toNumber/toString with unsigned flag.
  if ("unsigned" in o && typeof (o as { toNumber?: unknown }).toNumber === "function") {
    return true;
  }
  return false;
}

function longLikeToString(value: {
  toString: () => string;
}): string | null {
  try {
    const s = value.toString();
    if (typeof s !== "string") return null;
    const t = s.trim();
    if (!/^-?\d+$/.test(t)) return null;
    return t;
  } catch {
    return null;
  }
}

/**
 * Identifier as exact decimal string. Never rounds unsafe 64-bit values.
 */
export function safeIdString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) return null;
    return String(value);
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (!/^-?\d+$/.test(t)) return null;
    // Reject strings that would lose precision if later coerced unsafely.
    try {
      const bi = BigInt(t);
      if (
        bi > BigInt(Number.MAX_SAFE_INTEGER) ||
        bi < BigInt(Number.MIN_SAFE_INTEGER)
      ) {
        // Still a valid id string — keep exact digits; caller must not Number().
        return t;
      }
      return t;
    } catch {
      return null;
    }
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (isLongLike(value)) {
    return longLikeToString(value);
  }
  return null;
}

/**
 * Finite number suitable for arithmetic (money raw units, volumes when safe).
 * Fail closed for non-finite / unsafe integer loss on integer-valued inputs.
 */
export function safeFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (t === "" || !/^-?(?:\d+)(?:\.\d+)?$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === "bigint") {
    if (
      value > BigInt(Number.MAX_SAFE_INTEGER) ||
      value < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      return null;
    }
    return Number(value);
  }
  if (isLongLike(value)) {
    const s = longLikeToString(value);
    if (s == null) return null;
    try {
      const bi = BigInt(s);
      if (
        bi > BigInt(Number.MAX_SAFE_INTEGER) ||
        bi < BigInt(Number.MIN_SAFE_INTEGER)
      ) {
        return null;
      }
      return Number(bi);
    } catch {
      return null;
    }
  }
  return null;
}

/** Integer in the safe JS range (volume cents, moneyDigits, leverageInCents). */
export function safeInteger(value: unknown): number | null {
  const n = safeFiniteNumber(value);
  if (n == null || !Number.isInteger(n) || !Number.isSafeInteger(n)) return null;
  return n;
}

/**
 * Convert deposit-currency raw units using validated moneyDigits.
 * moneyDigits must be a non-negative safe integer.
 */
export function moneyFromDigitsSafe(
  value: unknown,
  moneyDigits: unknown
): number | null {
  const digits = safeInteger(moneyDigits);
  if (digits == null || digits < 0 || digits > 18) return null;
  const raw = safeFiniteNumber(value);
  if (raw == null) return null;
  return raw / Math.pow(10, digits);
}

/**
 * Account / symbol id for Spotware sendCommand numeric fields.
 * Fail closed when not a safe integer (prevents silent precision loss).
 */
export function safeWireAccountId(value: unknown): number | null {
  const id = safeIdString(value);
  if (id == null) return null;
  try {
    const bi = BigInt(id);
    if (
      bi > BigInt(Number.MAX_SAFE_INTEGER) ||
      bi < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      return null;
    }
    return Number(bi);
  } catch {
    return null;
  }
}
