/**
 * Micro-owned XAUUSD symbol resolution.
 * Prefer exact name XAUUSD. Fail closed on ambiguity.
 * Never hard-code symbol IDs. Does not import Core symbolResolver.
 */

export type MicroRawSymbol = {
  symbolId?: string | number;
  symbolName?: string;
  description?: string;
  baseAsset?: string;
  quoteAsset?: string;
  digits?: number;
  pipPosition?: number;
};

export type MicroResolvedSymbol = {
  symbolId: string;
  symbolName: string;
  digits: number | null;
  pipPosition: number | null;
  baseAsset: string | null;
  quoteAsset: string | null;
};

const FORBIDDEN_NAME = /(_SB|_SBE|-F|PERP|INDEX|XAG|XAUEUR|FUTURE)/i;

function normalizeName(name: string): string {
  return name.trim().toUpperCase().replace(/[/\s._-]/g, "");
}

/**
 * Deterministic XAUUSD pick:
 * 1) Exact single XAUUSD name match
 * 2) Else single non-forbidden gold/USD heuristic match with assets
 * Otherwise null (fail closed).
 */
export function resolveMicroXauUsd(symbols: MicroRawSymbol[]): MicroResolvedSymbol | null {
  const exact = symbols.filter(
    (s) => String(s.symbolName ?? "").trim().toUpperCase() === "XAUUSD"
  );
  let raw: MicroRawSymbol | null = null;
  if (exact.length === 1) {
    raw = exact[0]!;
  } else if (exact.length === 0) {
    const matches = symbols.filter((s) => {
      const name = String(s.symbolName ?? "");
      if (FORBIDDEN_NAME.test(name)) return false;
      const n = normalizeName(name);
      if (n === "XAGUSD" || n.startsWith("XAG")) return false;
      if (n === "XAUEUR") return false;
      const base = String(s.baseAsset ?? "").toUpperCase();
      const quote = String(s.quoteAsset ?? "").toUpperCase();
      if ((base === "XAU" || base === "GOLD") && (quote === "USD" || quote === "USDT")) {
        return true;
      }
      return false;
    });
    if (matches.length === 1) raw = matches[0]!;
  } else {
    return null;
  }
  if (!raw || raw.symbolId == null) return null;
  const symbolName = String(raw.symbolName ?? "").trim();
  if (!symbolName) return null;
  if (FORBIDDEN_NAME.test(symbolName)) return null;
  const n = normalizeName(symbolName);
  if (n.includes("XAG") || n === "XAUEUR") return null;

  return {
    symbolId: String(raw.symbolId),
    symbolName,
    digits: typeof raw.digits === "number" ? raw.digits : null,
    pipPosition: typeof raw.pipPosition === "number" ? raw.pipPosition : null,
    baseAsset: raw.baseAsset ? String(raw.baseAsset) : symbolName.toUpperCase() === "XAUUSD" ? "XAU" : null,
    quoteAsset: raw.quoteAsset ? String(raw.quoteAsset) : symbolName.toUpperCase() === "XAUUSD" ? "USD" : null
  };
}
