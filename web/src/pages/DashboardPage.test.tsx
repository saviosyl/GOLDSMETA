import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DashboardPage } from "./DashboardPage";
import { ApiError } from "../types/models";
import { clearUserCaches } from "../lib/offlineCache";
import buy from "../fixtures/buy.json";
import type { Decision } from "../types/models";

const latestDecision = vi.fn();

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    api: {
      latestDecision
    }
  })
}));

describe("DashboardPage empty decision state", () => {
  beforeEach(() => {
    clearUserCaches();
    latestDecision.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows No decision yet without an error banner when latest returns null (404 NOT_FOUND)", async () => {
    latestDecision.mockResolvedValue(null);

    render(<DashboardPage />);

    expect(await screen.findByRole("heading", { name: "No decision yet" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/Unable to load decision/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/NOT_FOUND/i)).not.toBeInTheDocument();
  });

  it("keeps the error banner for real load failures", async () => {
    latestDecision.mockRejectedValue(new ApiError(500, "INTERNAL", "Server error"));

    render(<DashboardPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("INTERNAL: Server error");
    expect(screen.getByRole("heading", { name: "No decision yet" })).toBeInTheDocument();
  });

  it("renders a live decision card when a decision exists", async () => {
    latestDecision.mockResolvedValue(buy as Decision);

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("BUY")).toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: "No decision yet" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
