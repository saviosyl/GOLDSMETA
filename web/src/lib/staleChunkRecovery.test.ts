import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STALE_CHUNK_RECOVERY_KEY,
  attemptStaleChunkRecovery,
  clearStaleChunkRecoveryFlag,
  hasAttemptedStaleChunkRecovery,
  isChunkLoadError
} from "./staleChunkRecovery";

describe("staleChunkRecovery", () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearStaleChunkRecoveryFlag();
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("detects dynamic import / chunk load failures", () => {
    expect(
      isChunkLoadError(
        new TypeError(
          "Failed to fetch dynamically imported module: https://example.com/gm/InsightsPage-abc.js"
        )
      )
    ).toBe(true);
    expect(isChunkLoadError(new Error("ChunkLoadError: Loading chunk 7 failed"))).toBe(true);
    expect(
      isChunkLoadError(
        new TypeError(
          "Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of \"text/html\"."
        )
      )
    ).toBe(true);
    expect(isChunkLoadError(new SyntaxError("Unexpected token '<'"))).toBe(true);
    expect(isChunkLoadError(new Error("Network timeout"))).toBe(false);
  });

  it("reloads once per build and then refuses to loop", async () => {
    const reload = vi.fn();
    const first = await attemptStaleChunkRecovery({ commitSha: "abc1234", reload });
    expect(first).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(hasAttemptedStaleChunkRecovery("abc1234")).toBe(true);
    expect(sessionStorage.getItem(STALE_CHUNK_RECOVERY_KEY)).toContain("abc1234");

    const second = await attemptStaleChunkRecovery({ commitSha: "abc1234", reload });
    expect(second).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("allows recovery again after a new build identity", async () => {
    const reload = vi.fn();
    await attemptStaleChunkRecovery({ commitSha: "oldbuild", reload });
    const next = await attemptStaleChunkRecovery({ commitSha: "newbuild", reload });
    expect(next).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
