import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RouteErrorBoundary } from "./RouteErrorBoundary";
import { GOLD_META_COMMIT_SHA } from "../lib/buildIdentity";
import { STALE_CHUNK_RECOVERY_KEY } from "../lib/staleChunkRecovery";

function Boom({ message }: { message: string }) {
  throw new Error(message);
}

describe("RouteErrorBoundary stale-chunk recovery", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("auto-recovers once on dynamic import failure without exposing hashed URLs", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });

    render(
      <RouteErrorBoundary label="Insights">
        <Boom message="Failed to fetch dynamically imported module: https://x/gm/InsightsPage-s36bqSvW.js" />
      </RouteErrorBoundary>
    );

    await waitFor(() => {
      expect(sessionStorage.getItem(STALE_CHUNK_RECOVERY_KEY)).toBeTruthy();
    });
    expect(screen.queryByText(/InsightsPage-s36bqSvW/i)).not.toBeInTheDocument();
  });

  it("shows Update required after a prior recovery attempt for this build", async () => {
    sessionStorage.setItem(
      STALE_CHUNK_RECOVERY_KEY,
      JSON.stringify({ commit: GOLD_META_COMMIT_SHA, at: Date.now() })
    );

    render(
      <RouteErrorBoundary label="Insights">
        <Boom message="Failed to fetch dynamically imported module: https://x/gm/InsightsPage-s36bqSvW.js" />
      </RouteErrorBoundary>
    );

    expect(await screen.findByTestId("stale-chunk-message")).toHaveTextContent(
      /updated while this page was open/i
    );
    expect(screen.getByTestId("stale-chunk-reload")).toBeInTheDocument();
    expect(screen.queryByText(/InsightsPage-s36bqSvW/i)).not.toBeInTheDocument();
  });
});
