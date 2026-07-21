import { describe, expect, it } from "vitest";
import viteConfig from "../../vite.config.ts?raw";
import redirects from "../../public/_redirects?raw";
import headers from "../../public/_headers?raw";

describe("PWA cache safety", () => {
  it("does not runtime-cache private /v1/decisions API responses", () => {
    expect(viteConfig).not.toMatch(/url\.pathname\.includes\("\/v1\/decisions"\)/);
    expect(viteConfig).toMatch(/runtimeCaching:\s*\[\s*\]/);
    expect(viteConfig).toMatch(/cleanupOutdatedCaches:\s*true/);
  });

  it("SPA redirects keep client routes on the app shell", () => {
    expect(redirects).toMatch(/\/\*\s+\/index\.html\s+200/);
  });

  it("HTML / SW headers force revalidation", () => {
    expect(headers).toMatch(/\/index\.html[\s\S]*Cache-Control: no-cache/);
    expect(headers).toMatch(/\/sw\.js[\s\S]*Cache-Control: no-cache/);
  });
});
