import { describe, expect, it } from "vitest";
import gm404 from "../../public/gm/404.html?raw";
import gmv7404 from "../../public/gmv7/404.html?raw";
import assets404 from "../../public/assets/404.html?raw";

/**
 * Cloudflare Pages serves the nearest 404.html for missing files under a
 * directory. Without public/gmv7/404.html, missing hashed chunks SPA-fallback
 * to index.html with HTTP 200 + text/html (and can be cached immutable).
 */
describe("Hashed asset SPA-fallback safety", () => {
  it("ships nearest 404.html for gm, gmv7, and assets", () => {
    for (const [name, body] of [
      ["gm", gm404],
      ["gmv7", gmv7404],
      ["assets", assets404]
    ] as const) {
      expect(body, name).toMatch(/Not Found/i);
      expect(body, name).not.toMatch(/id=["']root["']/);
      expect(body.toLowerCase(), name).not.toContain("goldmeta is not configured");
    }
  });
});