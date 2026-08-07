/**
 * Explicit Pepperstone account allowlist for the always-on quote worker.
 * When set, the worker refuses any selected account not in the list.
 * Empty / unset = no extra restriction (still bound to the user's selected account).
 */

export function parseAccountAllowlist(
  source: NodeJS.ProcessEnv = process.env
): string[] {
  const raw = (source.CTRADER_QUOTE_ACCOUNT_ALLOWLIST ?? "").trim();
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  ];
}

export function assertAccountAllowlisted(
  ctidTraderAccountId: string,
  source: NodeJS.ProcessEnv = process.env
): void {
  const allow = parseAccountAllowlist(source);
  if (allow.length === 0) return;
  if (!allow.includes(String(ctidTraderAccountId))) {
    throw Object.assign(new Error("CTRADER_ACCOUNT_NOT_ALLOWLISTED"), {
      code: "CTRADER_ACCOUNT_NOT_ALLOWLISTED"
    });
  }
}

export function requireLiveAllowlist(
  source: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    String(source.CTRADER_QUOTE_REQUIRE_LIVE ?? "")
      .trim()
      .toLowerCase() === "true"
  );
}
