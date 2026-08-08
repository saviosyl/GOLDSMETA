/**
 * UI-only display translation for AutoTrade / broker activity strings.
 * Does not alter stored enums or API payloads.
 */

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bPEPPERSTONE_CTRADER\b/gi, "Pepperstone cTrader"],
  [/\bT212_INVEST\b/gi, "Trading 212 Invest"],
  [/\bT212_PRACTICE\b/gi, "Trading 212 Practice"],
  [/\bMANUAL\b/g, "Manual"],
  [/\bCSGLDC1s_EQ\b/gi, "XAUUSD"],
  [/\bDEMO_AUTO\b/gi, "Demo Auto"],
  [/\bLIVE_AUTO\b/gi, "Live Auto"],
  [/\bSHADOW\b/g, "Shadow"],
  [/\breconnect required\b/gi, "Reconnect required"]
];

export function friendlyActivityMessage(raw: string | null | undefined): string {
  if (!raw) return "";
  let out = String(raw);
  for (const [re, repl] of REPLACEMENTS) {
    out = out.replace(re, repl);
  }
  // Soften leftover SCREAMING_SNAKE tokens without inventing meaning.
  out = out.replace(/\b([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)\b/g, (m) =>
    m
      .toLowerCase()
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
  return out;
}
