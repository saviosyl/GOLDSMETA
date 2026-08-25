import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

if (typeof window !== "undefined") {
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false
      })
    });
  }

  if (typeof window.ResizeObserver === "undefined") {
    class ResizeObserverStub {
      observe() {
        return undefined;
      }
      unobserve() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    }
    Object.defineProperty(window, "ResizeObserver", {
      writable: true,
      configurable: true,
      value: ResizeObserverStub
    });
  }
}

vi.mock("lightweight-charts", () => {
  const priceScale = {
    applyOptions: vi.fn(),
    options: vi.fn(() => ({ autoScale: true })),
    width: vi.fn(() => 50)
  };
  const series = {
    setData: vi.fn(),
    applyOptions: vi.fn(),
    createPriceLine: vi.fn(() => ({})),
    removePriceLine: vi.fn(),
    priceScale: () => priceScale
  };
  const timeScale = {
    fitContent: vi.fn(),
    setVisibleLogicalRange: vi.fn(),
    getVisibleLogicalRange: vi.fn(() => ({ from: 30, to: 119 })),
    subscribeVisibleLogicalRangeChange: vi.fn(),
    unsubscribeVisibleLogicalRangeChange: vi.fn()
  };
  const chart = {
    addCandlestickSeries: vi.fn(() => series),
    applyOptions: vi.fn(),
    timeScale: () => timeScale,
    remove: vi.fn()
  };
  return {
    ColorType: { Solid: "solid" },
    createChart: vi.fn(() => chart)
  };
});
