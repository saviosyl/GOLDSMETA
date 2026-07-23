/**
 * Strict Trading 212 HTTP path/method allowlist.
 * Caller-supplied base URLs and Authorization headers are never accepted —
 * the client always builds URL + auth from server environment + secrets.
 */

import type { T212Environment } from "./types";

const PRACTICE_BASE = "https://demo.trading212.com/api/v0";
const LIVE_BASE = "https://live.trading212.com/api/v0";

export type T212HttpMethod = "GET" | "POST" | "DELETE";

/** Read-only paths (GET). */
export const T212_ALLOWED_READ_PATHS = [
  "/equity/account/summary",
  "/equity/positions",
  "/equity/metadata/instruments",
  "/equity/metadata/exchanges",
  "/equity/orders",
  "/equity/history/orders"
] as const;

/** Practice mutation paths — only when order submission is explicitly allowed. */
export const T212_ALLOWED_PRACTICE_MUTATIONS: ReadonlyArray<{
  method: T212HttpMethod;
  pathPattern: RegExp;
  pathLabel: string;
}> = [
  {
    method: "POST",
    pathPattern: /^\/equity\/orders\/market$/,
    pathLabel: "/equity/orders/market"
  },
  {
    method: "DELETE",
    pathPattern: /^\/equity\/orders\/[^/]+$/,
    pathLabel: "/equity/orders/{id}"
  }
];

export function normalizeT212Path(path: string): string {
  const bare = path.split("?")[0] ?? path;
  if (!bare.startsWith("/")) return `/${bare}`;
  return bare.replace(/\/+$/, "") || "/";
}

const T212_ORDER_ID_BLOCKLIST = new Set([
  "market",
  "limit",
  "stop",
  "stop_limit",
  "history"
]);

export function isAllowedReadPath(path: string): boolean {
  const bare = normalizeT212Path(path);
  if ((T212_ALLOWED_READ_PATHS as readonly string[]).includes(bare)) return true;
  // GET /equity/orders/{id} — never treat create-route suffixes as ids
  const orderIdMatch = bare.match(/^\/equity\/orders\/([^/]+)$/);
  if (orderIdMatch) {
    const id = orderIdMatch[1] ?? "";
    if (T212_ORDER_ID_BLOCKLIST.has(id)) return false;
    return true;
  }
  return false;
}

export function isAllowedPracticeMutation(
  method: T212HttpMethod,
  path: string
): boolean {
  const bare = normalizeT212Path(path);
  return T212_ALLOWED_PRACTICE_MUTATIONS.some(
    (m) => m.method === method && m.pathPattern.test(bare)
  );
}

export interface T212RequestAllowlistInput {
  method: T212HttpMethod;
  path: string;
  environment: T212Environment;
  mutationsEnabled: boolean;
  /** Reject if caller tried to override host. */
  requestedBaseUrl?: string | null;
  /** Reject if caller tried to supply Authorization. */
  requestedAuthorization?: string | null;
}

export type T212AllowlistResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

export function assertT212RequestAllowed(
  input: T212RequestAllowlistInput
): T212AllowlistResult {
  if (input.requestedBaseUrl != null && String(input.requestedBaseUrl).trim() !== "") {
    return {
      ok: false,
      code: "CALLER_BASE_URL_REJECTED",
      message: "Caller-supplied base URLs are not permitted."
    };
  }
  if (
    input.requestedAuthorization != null &&
    String(input.requestedAuthorization).trim() !== ""
  ) {
    return {
      ok: false,
      code: "CALLER_AUTHORIZATION_REJECTED",
      message: "Caller-supplied Authorization headers are not permitted."
    };
  }

  if (input.environment === "LIVE") {
    return {
      ok: false,
      code: "T212_LIVE_HOST_LOCKED",
      message: "Live Trading 212 host is locked."
    };
  }

  if (!PRACTICE_BASE.startsWith("https://demo.trading212.com/")) {
    return {
      ok: false,
      code: "T212_BASE_MISCONFIGURED",
      message: "Practice base URL misconfigured."
    };
  }
  void LIVE_BASE; // documented Live host — never selected in Practice allowlist path

  const method = input.method;
  const bare = normalizeT212Path(input.path);

  if (method === "GET") {
    if (!isAllowedReadPath(bare)) {
      return {
        ok: false,
        code: "T212_PATH_NOT_ALLOWLISTED",
        message: `GET ${bare} is not allowlisted.`
      };
    }
    return { ok: true };
  }

  if (!input.mutationsEnabled) {
    return {
      ok: false,
      code: "T212_MUTATION_DISABLED",
      message: "T212 mutations are disabled in this runtime."
    };
  }

  if (!isAllowedPracticeMutation(method, bare)) {
    return {
      ok: false,
      code: "T212_MUTATION_NOT_ALLOWLISTED",
      message: `${method} ${bare} is not an approved Practice mutation.`
    };
  }

  return { ok: true };
}
