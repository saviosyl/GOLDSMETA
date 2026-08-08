/**
 * Trading session permission filter (UTC-based approximate FX sessions).
 */

export type SessionName = "Asia" | "London" | "NewYork" | "All";

export function currentSessionUtc(now = new Date()): Exclude<SessionName, "All"> {
  const h = now.getUTCHours();
  // Rough FX windows (UTC): Asia 00–08, London 07–16, New York 12–21
  if (h >= 12 && h < 21) return "NewYork";
  if (h >= 7 && h < 16) return "London";
  return "Asia";
}

export function sessionAllowed(
  allowedSessions: string[] | null | undefined,
  now = new Date()
): { ok: boolean; current: string; reason: string | null } {
  const current = currentSessionUtc(now);
  const list = (allowedSessions ?? []).map((s) => String(s).trim());
  if (list.length === 0 || list.some((s) => /^all$/i.test(s))) {
    return { ok: true, current, reason: null };
  }
  const norm = list.map((s) => s.toLowerCase());
  const cur = current.toLowerCase();
  // Accept London / NewYork / New York / Asia
  const aliases: Record<string, string[]> = {
    asia: ["asia", "asian", "tokyo"],
    london: ["london", "eu", "europe"],
    newyork: ["newyork", "new york", "ny", "new_york", "us"]
  };
  const ok = Object.entries(aliases).some(([key, al]) => {
    if (key !== cur.replace(/\s/g, "")) return false;
    return norm.some((n) => al.includes(n.replace(/\s+/g, "")) || al.includes(n));
  });
  // Also direct includes
  const direct = norm.some(
    (n) => n === cur.toLowerCase() || n.replace(/\s+/g, "") === cur.toLowerCase()
  );
  if (ok || direct) return { ok: true, current, reason: null };
  return { ok: false, current, reason: "SESSION_BLOCKED" };
}
