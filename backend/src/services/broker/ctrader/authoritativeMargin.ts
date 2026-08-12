/**
 * Authoritative Pepperstone Demo margin snapshot + expected-margin gate.
 *
 * ProtoOATrader does NOT provide freeMargin/equity/usedMargin.
 * Those must be derived from:
 *   - ProtoOATrader.balance (+ moneyDigits, leverageInCents)
 *   - ProtoOAReconcileRes.position[] (usedMargin per position, open-count proof)
 *   - ProtoOAGetPositionUnrealizedPnLRes (net unrealised when positions > 0)
 *   - ProtoOAExpectedMarginReq/Res (candidate margin for final protocol volume)
 *
 * equity = balance + unrealisedNetPnl
 * freeMargin = equity - usedMargin
 *
 * Never invent missing P/L or used-margin. Fail closed → MARGIN_UNAVAILABLE.
 * Live execution remains impossible via existing hard locks.
 */

import {
  moneyFromDigitsSafe,
  safeFiniteNumber,
  safeInteger
} from "./openApiNumeric";

/** Align with Demo AutoTrade default maxQuoteAgeSeconds (15s). */
export const MARGIN_SNAPSHOT_MAX_AGE_MS = 15_000;

export type MarginPositionUsed = {
  positionId: string;
  /** Deposit-currency used margin after moneyDigits conversion. */
  usedMargin: number | null;
};

export type MarginUnrealisedRow = {
  positionId: string;
  /** Deposit-currency net unrealised after moneyDigits conversion. */
  netUnrealisedPnl: number | null;
};

export type AuthoritativeMarginSnapshot = {
  balance: number;
  unrealisedNetPnl: number;
  equity: number;
  usedMargin: number;
  freeMargin: number;
  moneyDigits: number;
  leverage: number | null;
  openPositionCount: number;
  source: "BROKER_FLAT" | "BROKER_POSITIONS";
  capturedAt: string;
};

export type ExpectedMarginQuote = {
  volume: number;
  buyMargin: number;
  sellMargin: number;
  moneyDigits: number;
};

export type MarginGateOk = {
  ok: true;
  freeMargin: number;
  expectedMargin: number;
  marginSnapshot: AuthoritativeMarginSnapshot;
  marginAgeMs: number;
  marginCapturedAt: string;
  marginSource: AuthoritativeMarginSnapshot["source"];
  expectedMarginSource: "PROTO_OA_EXPECTED_MARGIN";
};

export type MarginGateFail = {
  ok: false;
  reason:
    | "MARGIN_UNAVAILABLE"
    | "EXPECTED_MARGIN_UNAVAILABLE"
    | "RISK_SIZE_EXCEEDS_MARGIN"
    | "MARGIN_SNAPSHOT_STALE"
    | "LIVE_ACCOUNT_FORBIDDEN";
  notes: string[];
  marginSnapshot: AuthoritativeMarginSnapshot | null;
  expectedMargin: number | null;
  marginAgeMs: number | null;
};

export type MarginGateResult = MarginGateOk | MarginGateFail;

/**
 * Convert monetary raw units with validated moneyDigits.
 * Accepts number | string | bigint | Long-like via openApiNumeric.
 */
export function moneyFromDigits(
  value: unknown,
  moneyDigits: number
): number | null {
  return moneyFromDigitsSafe(value, moneyDigits);
}

/**
 * Derive equity / freeMargin from broker facts only.
 * Flat-account path requires reconcile proof openPositionCount === 0.
 */
export function computeAuthoritativeMarginSnapshot(input: {
  balance: number | null;
  moneyDigits: number;
  leverage: number | null;
  /** Authoritative open-position count from ProtoOAReconcileRes. */
  openPositionCount: number;
  /** True only when reconcile completed successfully. */
  reconcileOk: boolean;
  positionsUsedMargin: MarginPositionUsed[];
  unrealisedRows: MarginUnrealisedRow[] | null;
  capturedAt?: string;
}):
  | { ok: true; snapshot: AuthoritativeMarginSnapshot }
  | { ok: false; reason: "MARGIN_UNAVAILABLE"; notes: string[] } {
  const notes: string[] = [];
  const digits =
    Number.isFinite(input.moneyDigits) && input.moneyDigits >= 0
      ? Math.floor(input.moneyDigits)
      : 2;

  if (input.balance == null || !Number.isFinite(input.balance)) {
    return {
      ok: false,
      reason: "MARGIN_UNAVAILABLE",
      notes: ["ProtoOATrader.balance missing — fail closed"]
    };
  }
  if (!input.reconcileOk) {
    return {
      ok: false,
      reason: "MARGIN_UNAVAILABLE",
      notes: [
        "ProtoOAReconcileRes unavailable — cannot prove open-position state"
      ]
    };
  }
  if (
    !Number.isInteger(input.openPositionCount) ||
    input.openPositionCount < 0
  ) {
    return {
      ok: false,
      reason: "MARGIN_UNAVAILABLE",
      notes: ["openPositionCount invalid"]
    };
  }

  const capturedAt = input.capturedAt ?? new Date().toISOString();

  // Zero-open-position case: usedMargin=0, unrealised=0, equity=balance.
  if (input.openPositionCount === 0) {
    const balance = input.balance;
    const snapshot: AuthoritativeMarginSnapshot = {
      balance,
      unrealisedNetPnl: 0,
      equity: balance,
      usedMargin: 0,
      freeMargin: balance,
      moneyDigits: digits,
      leverage: input.leverage,
      openPositionCount: 0,
      source: "BROKER_FLAT",
      capturedAt
    };
    notes.push("broker-flat reconcile proof: open positions = 0");
    return { ok: true, snapshot };
  }

  // Open positions: require usedMargin on every position + unrealised PnL rows.
  if (input.positionsUsedMargin.length !== input.openPositionCount) {
    return {
      ok: false,
      reason: "MARGIN_UNAVAILABLE",
      notes: [
        `usedMargin rows ${input.positionsUsedMargin.length} != openPositionCount ${input.openPositionCount}`
      ]
    };
  }

  let usedMargin = 0;
  for (const row of input.positionsUsedMargin) {
    if (row.usedMargin == null || !Number.isFinite(row.usedMargin)) {
      return {
        ok: false,
        reason: "MARGIN_UNAVAILABLE",
        notes: [
          `ProtoOAPosition.usedMargin missing for position ${row.positionId}`
        ]
      };
    }
    usedMargin += row.usedMargin;
  }
  usedMargin = Number(usedMargin.toFixed(8));

  if (input.unrealisedRows == null) {
    return {
      ok: false,
      reason: "MARGIN_UNAVAILABLE",
      notes: [
        "ProtoOAGetPositionUnrealizedPnL unavailable with open positions — fail closed"
      ]
    };
  }

  const byId = new Map(
    input.unrealisedRows.map((r) => [r.positionId, r.netUnrealisedPnl] as const)
  );
  let unrealisedNetPnl = 0;
  for (const pos of input.positionsUsedMargin) {
    const pnl = byId.get(pos.positionId);
    if (pnl == null || !Number.isFinite(pnl)) {
      return {
        ok: false,
        reason: "MARGIN_UNAVAILABLE",
        notes: [
          `netUnrealizedPnL missing for open position ${pos.positionId}`
        ]
      };
    }
    unrealisedNetPnl += pnl;
  }
  unrealisedNetPnl = Number(unrealisedNetPnl.toFixed(8));

  const equity = Number((input.balance + unrealisedNetPnl).toFixed(8));
  const freeMargin = Number((equity - usedMargin).toFixed(8));
  if (!Number.isFinite(freeMargin)) {
    return {
      ok: false,
      reason: "MARGIN_UNAVAILABLE",
      notes: ["freeMargin not finite after derivation"]
    };
  }

  return {
    ok: true,
    snapshot: {
      balance: input.balance,
      unrealisedNetPnl,
      equity,
      usedMargin,
      freeMargin,
      moneyDigits: digits,
      leverage: input.leverage,
      openPositionCount: input.openPositionCount,
      source: "BROKER_POSITIONS",
      capturedAt
    }
  };
}

export function parseExpectedMarginEntries(args: {
  margins: unknown;
  moneyDigits: number;
}): ExpectedMarginQuote[] {
  const digits = safeInteger(args.moneyDigits);
  if (digits == null || digits < 0 || digits > 18) return [];
  const list = Array.isArray(args.margins) ? args.margins : [];
  const out: ExpectedMarginQuote[] = [];
  for (const item of list) {
    const row = (item ?? {}) as Record<string, unknown>;
    const volume = safeInteger(row.volume);
    const buyMargin = moneyFromDigitsSafe(row.buyMargin, digits);
    const sellMargin = moneyFromDigitsSafe(row.sellMargin, digits);
    if (volume == null || buyMargin == null || sellMargin == null) {
      continue;
    }
    if (!(buyMargin > 0) || !(sellMargin > 0)) {
      continue;
    }
    out.push({
      volume,
      buyMargin,
      sellMargin,
      moneyDigits: digits
    });
  }
  return out;
}

/** Re-export for margin call sites that need finite numeric coercion. */
export { safeFiniteNumber, safeInteger };

export function selectSideExpectedMargin(args: {
  side: "BUY" | "SELL";
  protocolVolume: number;
  quotes: ExpectedMarginQuote[];
}): number | null {
  const match = args.quotes.find((q) => q.volume === args.protocolVolume);
  if (!match) return null;
  return args.side === "BUY" ? match.buyMargin : match.sellMargin;
}

export function evaluateMarginSafetyGate(args: {
  snapshot: AuthoritativeMarginSnapshot | null;
  expectedMargin: number | null;
  expectedMarginOk: boolean;
  nowMs?: number;
  maxAgeMs?: number;
  selectedAccountIsLive?: boolean;
}): MarginGateResult {
  const nowMs = args.nowMs ?? Date.now();
  const maxAgeMs = args.maxAgeMs ?? MARGIN_SNAPSHOT_MAX_AGE_MS;

  if (args.selectedAccountIsLive) {
    return {
      ok: false,
      reason: "LIVE_ACCOUNT_FORBIDDEN",
      notes: ["Live account — Demo margin gate refuses submission"],
      marginSnapshot: args.snapshot,
      expectedMargin: args.expectedMargin,
      marginAgeMs: null
    };
  }

  if (!args.snapshot) {
    return {
      ok: false,
      reason: "MARGIN_UNAVAILABLE",
      notes: ["Authoritative margin snapshot missing"],
      marginSnapshot: null,
      expectedMargin: args.expectedMargin,
      marginAgeMs: null
    };
  }

  const capturedMs = Date.parse(args.snapshot.capturedAt);
  const marginAgeMs = Number.isFinite(capturedMs)
    ? Math.max(0, nowMs - capturedMs)
    : Number.POSITIVE_INFINITY;

  if (!(marginAgeMs <= maxAgeMs)) {
    return {
      ok: false,
      reason: "MARGIN_SNAPSHOT_STALE",
      notes: [
        `marginAgeMs=${marginAgeMs} exceeds maxAgeMs=${maxAgeMs}`
      ],
      marginSnapshot: args.snapshot,
      expectedMargin: args.expectedMargin,
      marginAgeMs: Number.isFinite(marginAgeMs) ? marginAgeMs : null
    };
  }

  if (
    !Number.isFinite(args.snapshot.freeMargin) ||
    args.snapshot.freeMargin == null
  ) {
    return {
      ok: false,
      reason: "MARGIN_UNAVAILABLE",
      notes: ["Derived freeMargin not finite"],
      marginSnapshot: args.snapshot,
      expectedMargin: args.expectedMargin,
      marginAgeMs
    };
  }

  if (!args.expectedMarginOk || args.expectedMargin == null) {
    return {
      ok: false,
      reason: "EXPECTED_MARGIN_UNAVAILABLE",
      notes: [
        "ProtoOAExpectedMarginReq failed or side margin missing for final volume"
      ],
      marginSnapshot: args.snapshot,
      expectedMargin: args.expectedMargin,
      marginAgeMs
    };
  }

  if (!(args.expectedMargin > 0) || !Number.isFinite(args.expectedMargin)) {
    return {
      ok: false,
      reason: "EXPECTED_MARGIN_UNAVAILABLE",
      notes: ["Expected margin not a positive finite number"],
      marginSnapshot: args.snapshot,
      expectedMargin: args.expectedMargin,
      marginAgeMs
    };
  }

  // Existing policy: expected must not exceed freeMargin (no buffer loosening).
  if (args.expectedMargin > args.snapshot.freeMargin + 1e-6) {
    return {
      ok: false,
      reason: "RISK_SIZE_EXCEEDS_MARGIN",
      notes: [
        `Expected margin ${args.expectedMargin} > freeMargin ${args.snapshot.freeMargin}`
      ],
      marginSnapshot: args.snapshot,
      expectedMargin: args.expectedMargin,
      marginAgeMs
    };
  }

  return {
    ok: true,
    freeMargin: args.snapshot.freeMargin,
    expectedMargin: args.expectedMargin,
    marginSnapshot: args.snapshot,
    marginAgeMs,
    marginCapturedAt: args.snapshot.capturedAt,
    marginSource: args.snapshot.source,
    expectedMarginSource: "PROTO_OA_EXPECTED_MARGIN"
  };
}
