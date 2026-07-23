import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDashboardDecisionPoll } from "./useDashboardDecisionPoll";

describe("useDashboardDecisionPoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible"
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls on the interval and records last success", async () => {
    const onTick = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useDashboardDecisionPoll({ intervalMs: 30_000, onTick })
    );

    expect(onTick).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(result.current.lastSuccessAt).toBeTruthy();
    expect(result.current.pollError).toBe(false);
  });

  it("skips ticks while the tab is hidden and refreshes when visible", async () => {
    let hidden = true;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (hidden ? "hidden" : "visible")
    });
    const onTick = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useDashboardDecisionPoll({ intervalMs: 30_000, onTick }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(onTick).not.toHaveBeenCalled();

    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it("sets pollError after repeated failures", async () => {
    const onTick = vi.fn().mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() =>
      useDashboardDecisionPoll({ intervalMs: 1_000, onTick })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(result.current.consecutiveFailures).toBeGreaterThanOrEqual(2);
    expect(result.current.pollError).toBe(true);
  });

  it("does not overlap in-flight polls", async () => {
    let resolveTick: (() => void) | undefined;
    const onTick = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveTick = resolve;
        })
    );
    renderHook(() => useDashboardDecisionPoll({ intervalMs: 1_000, onTick }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(onTick).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    // Still in flight — second interval skipped
    expect(onTick).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveTick?.();
    });
  });
});
