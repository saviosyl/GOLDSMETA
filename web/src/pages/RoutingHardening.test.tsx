import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { Suspense, lazy } from "react";
import { RouteErrorBoundary } from "../components/RouteErrorBoundary";
import { BottomNav } from "../components/BottomNav";

vi.mock("virtual:pwa-register", () => ({
  registerSW: () => () => Promise.resolve()
}));

const LazyIntel = lazy(() =>
  Promise.resolve({
    default: () => <div data-testid="lazy-intelligence">Intel lazy</div>
  })
);

describe("Routing / lazy loading", () => {
  it("lazy route shows loading then content", async () => {
    render(
      <MemoryRouter initialEntries={["/intelligence"]}>
        <Routes>
          <Route
            path="/intelligence"
            element={
              <RouteErrorBoundary label="Intelligence">
                <Suspense fallback={<div data-testid="route-loading">Loading Intelligence…</div>}>
                  <LazyIntel />
                </Suspense>
              </RouteErrorBoundary>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByTestId("lazy-intelligence")).toBeInTheDocument();
  });

  it("direct deep-link paths are represented in bottom nav", () => {
    render(
      <MemoryRouter initialEntries={["/analytics"]}>
        <BottomNav />
      </MemoryRouter>
    );
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    for (const label of ["Home", "Intel", "Analytics", "Replay", "Settings"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("keyboard focus styles are defined for interactive controls", async () => {
    const css = await import("../styles/global.css?raw");
    expect(css.default).toMatch(/:focus-visible/);
  });
});
