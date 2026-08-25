/**
 * Micro account selection — never silently pick account[0].
 * Prefer Pepperstone DEMO when environment=DEMO is intended.
 * isLive must come from cTrader account metadata — never inferred from Micro env.
 */
import type { MicroCTraderEnvironment } from "./microCTraderAuth";

/** ProtoOAClientPermissionScope */
export const MICRO_PERMISSION_SCOPE = {
  SCOPE_VIEW: 0,
  SCOPE_TRADE: 1
} as const;

export type MicroPermissionScope = "SCOPE_VIEW" | "SCOPE_TRADE" | "UNKNOWN";

export type MicroAuthorizedAccount = {
  accountId: string;
  /** Authoritative from cTrader — never inferred from Micro environment. */
  isLive: boolean | null;
  traderLogin: string | null;
  brokerHint: string | null;
};

/** Private safe metadata persisted for audit/cache (not authorization authority). */
export type MicroStoredAccountMeta = {
  accountId: string;
  isLive: boolean | null;
  traderLoginMasked: string | null;
  brokerTitleShort: string | null;
  observedAt: string;
};

export type MicroAccountSelectionResult =
  | {
      ok: true;
      selectedAccountId: string;
      selected: MicroAuthorizedAccount;
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
        | "LIVE_ACCOUNT_NOT_ALLOWED"
        | "ACCOUNT_NOT_IN_AUTHORIZED_LIST"
        | "BROKER_NOT_ALLOWED"
        | "ACCOUNT_ISLIVE_UNKNOWN";
      accounts: MicroAuthorizedAccount[];
    };

export function parsePermissionScope(res: unknown): MicroPermissionScope {
  const root = (res ?? {}) as Record<string, unknown>;
  const raw = root.permissionScope ?? root.permission_scope;
  if (raw == null) return "UNKNOWN";
  if (typeof raw === "number") {
    if (raw === MICRO_PERMISSION_SCOPE.SCOPE_VIEW) return "SCOPE_VIEW";
    if (raw === MICRO_PERMISSION_SCOPE.SCOPE_TRADE) return "SCOPE_TRADE";
    return "UNKNOWN";
  }
  const s = String(raw).trim().toUpperCase();
  if (s === "SCOPE_VIEW" || s === "VIEW" || s === "0") return "SCOPE_VIEW";
  if (s === "SCOPE_TRADE" || s === "TRADE" || s === "1") return "SCOPE_TRADE";
  return "UNKNOWN";
}

export function assertViewOnlyPermissionScope(res: unknown): {
  permissionScope: "SCOPE_VIEW";
} {
  const scope = parsePermissionScope(res);
  if (scope === "SCOPE_TRADE") {
    throw Object.assign(new Error("MICRO_TRADING_SCOPE_REJECTED"), {
      code: "MICRO_TRADING_SCOPE_REJECTED"
    });
  }
  if (scope !== "SCOPE_VIEW") {
    throw Object.assign(new Error("MICRO_PERMISSION_SCOPE_UNKNOWN"), {
      code: "MICRO_PERMISSION_SCOPE_UNKNOWN",
      permissionScope: scope
    });
  }
  return { permissionScope: "SCOPE_VIEW" };
}

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
        traderLogin: o.traderLogin != null ? String(o.traderLogin) : null,
        brokerHint:
          o.brokerName != null
            ? String(o.brokerName)
            : o.brokerTitle != null
              ? String(o.brokerTitle)
              : null
      });
    }
  }
  const seen = new Set<string>();
  return out.filter((a) => {
    if (seen.has(a.accountId)) return false;
    seen.add(a.accountId);
    return true;
  });
}

export function getBrokerAllowlist(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const raw = (env.MICRO_CTRADER_BROKER_ALLOWLIST ?? "Pepperstone").trim();
  if (!raw) return ["Pepperstone"];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function brokerMatchesAllowlist(
  brokerHint: string | null,
  allowlist: string[] = getBrokerAllowlist()
): "MATCH" | "UNKNOWN" | "REJECT" {
  if (!brokerHint || !brokerHint.trim()) return "UNKNOWN";
  const hint = brokerHint.toLowerCase();
  for (const allowed of allowlist) {
    if (hint.includes(allowed.toLowerCase())) return "MATCH";
  }
  return "REJECT";
}

function isDemoCompatible(
  account: MicroAuthorizedAccount,
  intended: MicroCTraderEnvironment
): boolean {
  if (intended === "DEMO") {
    if (account.isLive === true) return false;
    if (account.isLive == null) return false; // require known DEMO
    return true;
  }
  if (account.isLive === false) return false;
  if (account.isLive == null) return false;
  return true;
}

/**
 * Select account for Micro activation.
 * - Never auto-select account[0] when multiple exist
 * - Never silently replace DEMO with LIVE
 * - Never infer isLive from Micro environment
 * - Auto-select only when exactly one compatible account
 */
export function selectMicroAccount(args: {
  accounts: MicroAuthorizedAccount[];
  intendedEnvironment: MicroCTraderEnvironment;
  explicitAccountId?: string | null;
  requireBrokerAllowlist?: boolean;
  brokerAllowlist?: string[];
}): MicroAccountSelectionResult {
  const accounts = args.accounts;
  if (!accounts.length) {
    return { ok: false, reason: "NO_AUTHORIZED_ACCOUNTS", accounts };
  }

  const allowlist = args.brokerAllowlist ?? getBrokerAllowlist();
  const requireBroker = args.requireBrokerAllowlist !== false;

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
    if (args.intendedEnvironment === "DEMO" && found.isLive === true) {
      return {
        ok: false,
        reason: "LIVE_ACCOUNT_NOT_ALLOWED",
        accounts
      };
    }
    if (args.intendedEnvironment === "DEMO" && found.isLive == null) {
      return { ok: false, reason: "ACCOUNT_ISLIVE_UNKNOWN", accounts };
    }
    if (args.intendedEnvironment === "LIVE" && found.isLive === false) {
      return {
        ok: false,
        reason: "ACCOUNT_NOT_IN_AUTHORIZED_LIST",
        accounts
      };
    }
    const brokerCheck = brokerMatchesAllowlist(found.brokerHint, allowlist);
    if (requireBroker && brokerCheck === "REJECT") {
      return { ok: false, reason: "BROKER_NOT_ALLOWED", accounts };
    }
    // UNKNOWN broker: allowed for selection but LIVE_CONNECTED requires later confirm
    return {
      ok: true,
      selectedAccountId: found.accountId,
      selected: found,
      mode: "EXPLICIT",
      accounts
    };
  }

  const compatible = accounts.filter((a) => {
    if (!isDemoCompatible(a, args.intendedEnvironment)) return false;
    const b = brokerMatchesAllowlist(a.brokerHint, allowlist);
    if (requireBroker && b === "REJECT") return false;
    return true;
  });

  if (args.intendedEnvironment === "DEMO") {
    const knownLive = accounts.filter((a) => a.isLive === true);
    const knownDemo = accounts.filter((a) => a.isLive === false);
    if (knownDemo.length === 0 && knownLive.length > 0) {
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
      selected: compatible[0]!,
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

  return {
    ok: false,
    reason: "MULTIPLE_COMPATIBLE_NEED_SELECTION",
    accounts
  };
}

export function toStoredAccountMeta(
  accounts: MicroAuthorizedAccount[],
  nowMs = Date.now()
): MicroStoredAccountMeta[] {
  const observedAt = new Date(nowMs).toISOString();
  return accounts.map((a) => ({
    accountId: a.accountId,
    isLive: a.isLive,
    traderLoginMasked: a.traderLogin
      ? `****${String(a.traderLogin).slice(-3)}`
      : null,
    brokerTitleShort: a.brokerHint
      ? a.brokerHint.slice(0, 64)
      : null,
    observedAt
  }));
}

/** Safe metadata for UI — never tokens. */
export function toSafeAccountMetadata(
  accounts: MicroAuthorizedAccount[],
  intended: MicroCTraderEnvironment = "DEMO"
): Array<{
  accountId: string;
  accountIdMasked: string;
  environment: "DEMO" | "LIVE" | "UNKNOWN";
  traderLoginMasked: string | null;
  brokerHint: string | null;
  selectable: boolean;
  eligibility: "ELIGIBLE" | "NOT_ELIGIBLE_LIVE" | "NOT_ELIGIBLE_BROKER" | "NOT_ELIGIBLE";
}> {
  const allowlist = getBrokerAllowlist();
  return accounts.map((a) => {
    const envLabel: "DEMO" | "LIVE" | "UNKNOWN" =
      a.isLive === true ? "LIVE" : a.isLive === false ? "DEMO" : "UNKNOWN";
    const broker = brokerMatchesAllowlist(a.brokerHint, allowlist);
    let eligibility:
      | "ELIGIBLE"
      | "NOT_ELIGIBLE_LIVE"
      | "NOT_ELIGIBLE_BROKER"
      | "NOT_ELIGIBLE" = "ELIGIBLE";
    if (intended === "DEMO" && a.isLive === true) {
      eligibility = "NOT_ELIGIBLE_LIVE";
    } else if (broker === "REJECT") {
      eligibility = "NOT_ELIGIBLE_BROKER";
    } else if (intended === "DEMO" && a.isLive !== false) {
      eligibility = "NOT_ELIGIBLE";
    }
    return {
      accountId: a.accountId,
      accountIdMasked:
        a.accountId.length <= 4
          ? `****${a.accountId}`
          : `****${a.accountId.slice(-4)}`,
      environment: envLabel,
      traderLoginMasked: a.traderLogin
        ? `****${String(a.traderLogin).slice(-3)}`
        : null,
      brokerHint: a.brokerHint,
      selectable: eligibility === "ELIGIBLE",
      eligibility
    };
  });
}
