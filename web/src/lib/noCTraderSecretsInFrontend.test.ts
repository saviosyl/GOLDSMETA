import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Frontend may mention secret *names* in setup copy, but must never embed
 * live credential material (tokens, secrets used for auth).
 */
const FORBIDDEN_PATTERNS: RegExp[] = [
  /CTRADER_CLIENT_SECRET\s*=\s*["'][A-Za-z0-9+/=_\-.]{12,}["']/,
  /CTRADER_TOKEN_ENCRYPTION_KEY\s*=\s*["'][A-Za-z0-9+/=_\-.]{12,}["']/,
  /client_secret\s*=\s*["'][A-Za-z0-9+/=_\-.]{12,}["']/,
  /"accessToken"\s*:\s*"[A-Za-z0-9._\-]{20,}"/,
  /"refreshToken"\s*:\s*"[A-Za-z0-9._\-]{20,}"/,
  /Bearer\s+[A-Za-z0-9._\-]{20,}/
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "coverage") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (
      /\.(ts|tsx|js|jsx)$/.test(name) &&
      !name.includes(".test.")
    ) {
      out.push(p);
    }
  }
  return out;
}

describe("frontend must not contain cTrader secrets", () => {
  it("scans web/src production sources for embedded credential material", () => {
    const root = join(process.cwd(), "src");
    const files = walk(root);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const re of FORBIDDEN_PATTERNS) {
        if (re.test(text)) offenders.push(`${file}: ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
