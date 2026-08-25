/**
 * Derive truthful Price Location context from verified structure + price.
 * Never invents levels — returns "Context unavailable" when unverified.
 */

import { valueLocationLabel } from "./intradayFormat";

export type StructureLevels = {
  poc?: number | null;
  vah?: number | null;
  val?: number | null;
};

function near(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

/** Prefer explicit valueLocation; otherwise derive from POC/VAH/VAL vs price. */
export function marketsPriceLocationLabel(args: {
  price: number | null | undefined;
  structure?: StructureLevels | null;
  valueLocation?: string | null;
}): string {
  const loc = args.valueLocation?.trim();
  if (loc && loc !== "UNKNOWN" && loc !== "—") {
    const mapped = valueLocationLabel(loc);
    if (mapped !== "Context unavailable") return mapped;
  }

  const price = args.price;
  const s = args.structure;
  if (
    price == null ||
    !Number.isFinite(price) ||
    !s ||
    s.vah == null ||
    s.val == null ||
    !Number.isFinite(s.vah) ||
    !Number.isFinite(s.val)
  ) {
    return "Context unavailable";
  }

  const vah = s.vah;
  const val = s.val;
  const poc = s.poc != null && Number.isFinite(s.poc) ? s.poc : null;
  const span = Math.max(Math.abs(vah - val), 1);
  const nearTol = Math.max(span * 0.08, 0.5);

  if (near(price, vah, nearTol)) return "Near resistance";
  if (near(price, val, nearTol)) return "Near support";
  if (poc != null && near(price, poc, nearTol)) {
    return price >= poc ? "Above POC" : "Below POC";
  }
  if (price > vah) return "Above VAH";
  if (price < val) return "Below VAL";
  if (price >= val && price <= vah) {
    if (poc != null) {
      if (price > poc) return "Above POC";
      if (price < poc) return "Below POC";
    }
    return "Inside value";
  }
  return "Context unavailable";
}
