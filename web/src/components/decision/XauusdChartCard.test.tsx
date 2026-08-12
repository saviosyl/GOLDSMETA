import { describe, expect, it, vi, beforeEach, type ReactNode } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createChart } from "lightweight-charts";
import { XauusdChartCard } from "./XauusdChartCard";
import { QuoteProvider } from "../../lib/quoteContext";
import * as candlesHook from "../../hooks/useXauusdCandles";

vi.mock("../../hooks/useXauusdCandles", () => ({
  useXauusdCandles: vi.fn()
}));

const sampleBars = Array.from({ length: 40 }, (_, i) => ({
  time: 1_700_000_000 + i * 900,
  open: 2350 + i * 0.1,
  high: 2351 + i * 0.1,
  low: 2349 + i * 0.1,
  close: 2350.5 + i * 0.1
}));

function renderChart(props: Partial<Parameters<typeof XauusdChartCard>[0]> = {}) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <QuoteProvider>{children}</QuoteProvider>
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
    renderChart({ bid: 2394.9, ask: 2395.1 });
    expect(await screen.findByTestId("plan-market-card")).toBeInTheDocument();
    expect(screen.getByTestId("chart-fit-view")).toHaveAccessibleName(/fit view/i);
    expect(screen.getByTestId("chart-fullscreen")).toHaveAccessibleName(/full screen/i);
    expect(screen.getByTestId("chart-live-price")).toBeInTheDocument();
    expect(screen.getByTestId("xauusd-chart-host")).toHaveAttribute("data-has-bars", "1");
  });

  it("auto-fits on initial load via setVisibleLogicalRange (not only fitContent)", async () => {
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalled());
    const chart = vi.mocked(createChart).mock.results[0]?.value;
    expect(chart.timeScale().setVisibleLogicalRange).toHaveBeenCalled();
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
        <QuoteProvider>
          <XauusdChartCard currentPrice={2395} poc={2390} bid={2394.9} ask={2395.1} />
        </QuoteProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(createChart).toHaveBeenCalled());
    const chart = vi.mocked(createChart).mock.results[0]?.value;
    const setRange = chart.timeScale().setVisibleLogicalRange as ReturnType<typeof vi.fn>;
    // Simulate user pan/zoom
    const subs = chart.timeScale().subscribeVisibleLogicalRangeChange.mock.calls;
    const handler = subs[0]?.[0] as (() => void) | undefined;
    expect(handler).toBeTypeOf("function");
    act(() => {
      handler?.();
    });
    setRange.mockClear();
    rerender(
      <MemoryRouter>
        <QuoteProvider>
          <XauusdChartCard currentPrice={2396.5} poc={2390} bid={2396.4} ask={2396.6} />
        </QuoteProvider>
      </MemoryRouter>
    );
    // Quote/price-line update must not re-fit.
    expect(setRange).not.toHaveBeenCalled();
  });

  it("opens and exits fullscreen (in-app fallback)", async () => {
    renderChart();
    const card = await screen.findByTestId("plan-market-card");
    expect(card).toHaveAttribute("data-fullscreen", "0");
    fireEvent.click(screen.getByTestId("chart-fullscreen"));
    expect(card).toHaveAttribute("data-fullscreen", "1");
    expect(screen.getByTestId("chart-exit-fullscreen")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("chart-exit-fullscreen"));
    expect(card).toHaveAttribute("data-fullscreen", "0");
  });

  it("ESC exits fullscreen", async () => {
    renderChart();
    const card = await screen.findByTestId("plan-market-card");
    fireEvent.click(screen.getByTestId("chart-fullscreen"));
    expect(card).toHaveAttribute("data-fullscreen", "1");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(card).toHaveAttribute("data-fullscreen", "0");
  });
});
