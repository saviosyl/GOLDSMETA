import { describe, expect, it, vi, beforeEach, type ReactNode } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { createChart } from "lightweight-charts";
import { XauusdChartCard } from "./XauusdChartCard";
import { QuoteProvider } from "../../lib/quoteContext";
import { ReviewAuthProvider, type AuthContextValue } from "../../lib/auth";
import * as candlesHook from "../../hooks/useXauusdCandles";
import { computeFitPriceRange } from "../../lib/chartView";

vi.mock("../../hooks/useXauusdCandles", () => ({
  useXauusdCandles: vi.fn()
}));

const sampleBars = Array.from({ length: 120 }, (_, i) => ({
  time: 1_700_000_000 + i * 900,
  open: 2350 + (i > 30 ? 0.1 : 0),
  high: i < 30 ? 5000 : 2351,
  low: i < 30 ? 500 : 2349,
  close: 2350.5
}));

function authValue(role: "USER" | "OWNER"): AuthContextValue {
  return {
    user: { email: `${role.toLowerCase()}@example.com`, emailVerified: true } as AuthContextValue["user"],
    loading: false,
    configured: true,
    api: {} as AuthContextValue["api"],
    signIn: async () => undefined,
    signUp: async () => undefined,
    signOut: async () => undefined,
    registrationEnabled: false,
    apiBaseUrl: "",
    account: {
      uidMasked: "xx****yy",
      role,
      approvalStatus: "APPROVED",
      emailVerified: true,
      access: "APP",
      profile: {}
    },
    accountLoading: false,
    accountError: null,
    accountResolved: true,
    refreshAccount: async () => null
  };
}

function renderChart(
  props: Partial<Parameters<typeof XauusdChartCard>[0]> = {},
  role: "USER" | "OWNER" = "USER"
) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <ReviewAuthProvider value={authValue(role)}>
        <QuoteProvider>{children}</QuoteProvider>
      </ReviewAuthProvider>
    </MemoryRouter>
  );
  return render(
    <XauusdChartCard
      currentPrice={2395}
      poc={2390}
      vah={2392}
      val={2388}
      support={2380}
      resistance={2400}
      bid={2394.9}
      ask={2395.1}
      {...props}
    />,
    { wrapper: Wrapper }
  );
}

describe("XauusdChartCard fit + fullscreen", () => {
  beforeEach(() => {
    vi.mocked(candlesHook.useXauusdCandles).mockReturnValue({
      bars: sampleBars,
      loading: false,
      error: null,
      source: "broker",
      refresh: vi.fn()
    } as unknown as ReturnType<typeof candlesHook.useXauusdCandles>);
    vi.mocked(createChart).mockClear();
  });

  it("renders Fit and Fullscreen controls with accessible names", async () => {
    renderChart();
    expect(await screen.findByTestId("plan-market-card")).toBeInTheDocument();
    expect(screen.getByTestId("chart-fit-view")).toHaveAccessibleName(/fit view/i);
    expect(screen.getByTestId("chart-fullscreen")).toHaveAccessibleName(/full screen/i);
    expect(screen.getByTestId("chart-live-price")).toBeInTheDocument();
    expect(screen.getByTestId("xauusd-chart-host")).toHaveAttribute("data-has-bars", "1");
    expect(screen.getByTestId("xauusd-chart-host")).toHaveAttribute("data-touch-mode", "pan-y");
  });

  it("auto-fits on initial load via setVisibleLogicalRange", async () => {
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalled());
    const chart = vi.mocked(createChart).mock.results[0]?.value;
    expect(chart.timeScale().setVisibleLogicalRange).toHaveBeenCalled();
    const series = chart.addCandlestickSeries.mock.results[0]?.value;
    expect(series.applyOptions).toHaveBeenCalled();
  });

  it("Fit uses recent-visible geometry (hidden outlier does not dominate helper)", () => {
    const fit = computeFitPriceRange(sampleBars, { currentPrice: 2350, poc: 2350.2 });
    expect(fit!.max).toBeLessThan(2400);
  });

  it("Fit button re-applies useful view", async () => {
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalled());
    const chart = vi.mocked(createChart).mock.results[0]?.value;
    const setRange = chart.timeScale().setVisibleLogicalRange as ReturnType<typeof vi.fn>;
    setRange.mockClear();
    fireEvent.click(screen.getByTestId("chart-fit-view"));
    expect(setRange).toHaveBeenCalled();
  });

  it("manual zoom is not reset when live price / quote levels update", async () => {
    const { rerender } = render(
      <MemoryRouter>
        <ReviewAuthProvider value={authValue("USER")}>
          <QuoteProvider>
            <XauusdChartCard currentPrice={2395} poc={2390} bid={2394.9} ask={2395.1} />
          </QuoteProvider>
        </ReviewAuthProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(createChart).toHaveBeenCalled());
    const chart = vi.mocked(createChart).mock.results[0]?.value;
    const setRange = chart.timeScale().setVisibleLogicalRange as ReturnType<typeof vi.fn>;
    const subs = chart.timeScale().subscribeVisibleLogicalRangeChange.mock.calls;
    const handler = subs[0]?.[0] as (() => void) | undefined;
    expect(handler).toBeTypeOf("function");
    act(() => {
      handler?.();
    });
    setRange.mockClear();
    rerender(
      <MemoryRouter>
        <ReviewAuthProvider value={authValue("USER")}>
          <QuoteProvider>
            <XauusdChartCard currentPrice={2396.5} poc={2390} bid={2396.4} ask={2396.6} />
          </QuoteProvider>
        </ReviewAuthProvider>
      </MemoryRouter>
    );
    expect(setRange).not.toHaveBeenCalled();
  });

  it("embedded host allows pan-y; fullscreen captures gestures", async () => {
    renderChart();
    const host = await screen.findByTestId("xauusd-chart-host");
    expect(host).toHaveAttribute("data-touch-mode", "pan-y");
    expect(host.className).toMatch(/is-embedded-host/);
    fireEvent.click(screen.getByTestId("chart-fullscreen"));
    expect(host).toHaveAttribute("data-touch-mode", "capture");
    expect(host.className).toMatch(/is-fullscreen-host/);
  });

  it("fullscreen focus moves inside, trap stays, exit restores focus", async () => {
    const user = userEvent.setup();
    renderChart();
    const openBtn = await screen.findByTestId("chart-fullscreen");
    openBtn.focus();
    expect(openBtn).toHaveFocus();
    await user.click(openBtn);
    const card = screen.getByTestId("plan-market-card");
    expect(card).toHaveAttribute("data-fullscreen", "1");
    await waitFor(() => {
      expect(screen.getByTestId("chart-exit-fullscreen")).toHaveFocus();
    });
    // Tab cycles within dialog
    await user.tab();
    expect(card.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(card).toHaveAttribute("data-fullscreen", "0");
    await waitFor(() => {
      expect(screen.getByTestId("chart-fullscreen")).toHaveFocus();
    });
  });

  it("Exit button closes fullscreen", async () => {
    renderChart();
    fireEvent.click(await screen.findByTestId("chart-fullscreen"));
    fireEvent.click(screen.getByTestId("chart-exit-fullscreen"));
    expect(screen.getByTestId("plan-market-card")).toHaveAttribute("data-fullscreen", "0");
  });
});

describe("XauusdChartCard role parity (normal USER + OWNER)", () => {
  beforeEach(() => {
    vi.mocked(candlesHook.useXauusdCandles).mockReturnValue({
      bars: sampleBars,
      loading: false,
      error: null,
      source: "broker",
      refresh: vi.fn()
    } as unknown as ReturnType<typeof candlesHook.useXauusdCandles>);
  });

  for (const role of ["USER", "OWNER"] as const) {
    it(`${role}: Fit, fullscreen, live price, overlays`, async () => {
      renderChart({}, role);
      expect(await screen.findByTestId("chart-fit-view")).toBeInTheDocument();
      expect(screen.getByTestId("chart-fullscreen")).toBeInTheDocument();
      expect(screen.getByTestId("chart-live-price")).toBeInTheDocument();
      expect(screen.getByTestId("chart-level-legend").textContent).toMatch(/POC/);
      expect(screen.getByTestId("chart-level-legend").textContent).toMatch(/Support/);
      fireEvent.click(screen.getByTestId("chart-fullscreen"));
      expect(screen.getByTestId("plan-market-card")).toHaveAttribute("data-fullscreen", "1");
      expect(screen.getByTestId("chart-live-price")).toBeInTheDocument();
    });
  }
});
