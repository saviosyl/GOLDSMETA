/**
 * Micro account selection — never silently pick account[0].
 * Prefer Pepperstone DEMO when environment=DEMO is intended.
 */
import type { MicroCTraderEnvironment } from "./microCTraderAuth";

export type MicroAuthorizedAccount = {
  accountId: string;
  isLive: boolean | null;
  traderLogin: string | null;
  brokerHint: string | null;
};

export type MicroAccountSelectionResult =
  | {
      ok: true;
      selectedAccountId: string;
      mode: "AUTO_SINGLE_COMPATIBLE" | "EXPLICIT";
      accounts: MicroAuthorizedAccount[];
    }
  | {
      ok: false;
      reason:
        | "NO_AUTHORIZED_ACCOUNTS"
        | "MULTIPLE_COMPATIBLE_NEED_SELECTION"
        | "NO_DEMO_WHEN_DEMO_REQUIRED"
        | "LIVE_FORBIDDEN_FOR_DEMO_ACTIVATION"
        | "ACCOUNT_NOT_IN_AUTHORIZED_LIST";
      accounts: MicroAuthorizedAccount[];
    };

export function parseAuthorizedAccounts(res: unknown): MicroAuthorizedAccount[] {
  const root = (res ?? {}) as Record<string, unknown>;
  const list =
    (root.ctidTraderAccount as unknown) ??
    root.ctidTraderAccountId ??
    root.account ??
    root.accounts;
  const arr = Array.isArray(list) ? list : list != null ? [list] : [];
  const out: MicroAuthorizedAccount[] = [];
  for (const item of arr) {
    if (typeof item === "number" || typeof item === "string") {
      const id = String(item).trim();
      if (id) {
        out.push({
          accountId: id,
          isLive: null,
          traderLogin: null,
          brokerHint: null
        });
      }
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const id = o.ctidTraderAccountId ?? o.accountId ?? o.id;
      if (id == null || !String(id).trim()) continue;
      const isLive =
        typeof o.isLive === "boolean"
          ? o.isLive
          : o.isLive == null
            ? null
            : String(o.isLive).toLowerCase() === "true";
      out.push({
        accountId: String(id).trim(),
        isLive,
        traderLogin:
          o.traderLogin != null ? String(o.traderLogin) : null,
        brokerHint:
          o.brokerName != null
            ? String(o.brokerName)
            : o.brokerTitle != null
              ? String(o.brokerTitle)
              : null
      });
    }
  }
  // Dedupe by accountId
  const seen = new Set<string>();
  return out.filter((a) => {
    if (seen.has(a.accountId)) return false;
    seen.add(a.accountId);
    return true;
  });
}

function isDemoCompatible(
  account: MicroAuthorizedAccount,
  intended: MicroCTraderEnvironment
): boolean {
  if (intended === "DEMO") {
    // Prefer known DEMO; unknown isLive is allowed only for single-account case
    // handled separately. Here LIVE=true is never DEMO-compatible.
    if (account.isLive === true) return false;
    return true;
  }
  // LIVE intended: allow isLive true or unknown
  if (account.isLive === false) return false;
  return true;
}

/**
 * Select account for Micro activation.
 * - Never auto-select account[0] when multiple exist
 * - Never silently replace DEMO with LIVE
 * - Auto-select only when exactly one compatible account
 */
export function selectMicroAccount(args: {
  accounts: MicroAuthorizedAccount[];
  intendedEnvironment: MicroCTraderEnvironment;
  explicitAccountId?: string | null;
}): MicroAccountSelectionResult {
  const accounts = args.accounts;
  if (!accounts.length) {
    return { ok: false, reason: "NO_AUTHORIZED_ACCOUNTS", accounts };
  }

  if (args.explicitAccountId) {
    const explicit = String(args.explicitAccountId).trim();
    const found = accounts.find((a) => a.accountId === explicit);
    if (!found) {
      return {
        ok: false,
        reason: "ACCOUNT_NOT_IN_AUTHORIZED_LIST",
        accounts
      };
    }
    if (
      args.intendedEnvironment === "DEMO" &&
      found.isLive === true
    ) {
      return {
        ok: false,
        reason: "LIVE_FORBIDDEN_FOR_DEMO_ACTIVATION",
        accounts
      };
    }
    return {
      ok: true,
      selectedAccountId: found.accountId,
      mode: "EXPLICIT",
      accounts
    };
  }

  const compatible = accounts.filter((a) =>
    isDemoCompatible(a, args.intendedEnvironment)
  );

  if (args.intendedEnvironment === "DEMO") {
    const knownLive = accounts.filter((a) => a.isLive === true);
    const knownDemo = accounts.filter((a) => a.isLive === false);
    if (knownDemo.length === 0 && knownLive.length > 0 && compatible.length === 0) {
      return {
        ok: false,
        reason: "NO_DEMO_WHEN_DEMO_REQUIRED",
        accounts
      };
    }
  }

  if (compatible.length === 1) {
    return {
      ok: true,
      selectedAccountId: compatible[0]!.accountId,
      mode: "AUTO_SINGLE_COMPATIBLE",
      accounts
    };
  }

  if (compatible.length === 0) {
    return {
      ok: false,
      reason:
        args.intendedEnvironment === "DEMO"
          ? "NO_DEMO_WHEN_DEMO_REQUIRED"
          : "NO_AUTHORIZED_ACCOUNTS",
      accounts
    };
  }

  // Multiple compatible — require UI selection. Do NOT pick [0].
  return {
    ok: false,
    reason: "MULTIPLE_COMPATIBLE_NEED_SELECTION",
    accounts
  };
}

/** Safe metadata for UI — never tokens. */
export function toSafeAccountMetadata(
  accounts: MicroAuthorizedAccount[]
): Array<{
  accountIdMasked: string;
  environment: "DEMO" | "LIVE" | "UNKNOWN";
  traderLoginMasked: string | null;
  brokerHint: string | null;
}> {
  return accounts.map((a) => ({
    accountIdMasked:
      a.accountId.length <= 4
        ? `****${a.accountId}`
        : `****${a.accountId.slice(-4)}`,
    environment:
      a.isLive === true ? "LIVE" : a.isLive === false ? "DEMO" : "UNKNOWN",
    traderLoginMasked: a.traderLogin
      ? `****${String(a.traderLogin).slice(-3)}`
      : null,
    brokerHint: a.brokerHint
  }));
}
