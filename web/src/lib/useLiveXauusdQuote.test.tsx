import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { QuoteProvider, useShellQuote } from "./quoteContext";
import { useLiveXauusdQuote } from "./useLiveXauusdQuote";

const getCTraderLiveQuote = vi.fn();

vi.mock("./auth", () => ({
  useAuth: () => ({
    api: {
      getCTraderLiveQuote: (...args: unknown[]) => getCTraderLiveQuote(...args)
    }
  })
}));

function wrapper({ children }: { children: ReactNode }) {
  return <QuoteProvider>{children}</QuoteProvider>;
}

function quoteResponse(mid: number, seq: number) {
  return {
    available: true,
    livePriceHealth: "LIVE",
    quote: {
      symbolId: "41",
      symbolName: "XAUUSD",
      digits: 2,
      pipPosition: 1,
      bid: mid - 0.3,
      ask: mid + 0.3,
      mid,
      spread: 0.6,
      brokerTimestamp: "2026-08-06T12:30:42.000Z",
      receivedAt: "2026-08-06T12:30:42.100Z",
      quoteSequence: seq,
      freshness: "LIVE",
      marketStatus: "OPEN",
      ageMs: 100,
      executable: true,
      environment: "LIVE"
    }
  };
}

describe("useLiveXauusdQuote", () => {
  beforeEach(() => {
    getCTraderLiveQuote.mockReset();
  });

  it("loads the latest quote snapshot immediately without waiting for a plan update", async () => {
    getCTraderLiveQuote.mockResolvedValue(quoteResponse(4265.045, 3));

    const { result } = renderHook(
      () => {
        useLiveXauusdQuote({ enabled: true });
        return useShellQuote();
      },
      { wrapper }
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.quote?.price).toBeCloseTo(4265.045, 5);
    expect(result.current.quote?.source).toBe("broker");
    expect(result.current.quote?.freshness).toBe("LIVE");
    expect(result.current.quote?.bid).toBeCloseTo(4264.745, 5);
    expect(result.current.quote?.ask).toBeCloseTo(4265.345, 5);
    expect(getCTraderLiveQuote).toHaveBeenCalled();
  });

  it("retrieves a fresh snapshot after reconnect (online event)", async () => {
    getCTraderLiveQuote.mockResolvedValue(quoteResponse(1.5, 1));

    renderHook(() => useLiveXauusdQuote({ enabled: true }), { wrapper });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const callsAfterMount = getCTraderLiveQuote.mock.calls.length;

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getCTraderLiveQuote.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it("does not clear broker quote when decision fallback would overwrite", async () => {
    getCTraderLiveQuote.mockResolvedValue(quoteResponse(4265.1, 1));
    const { result } = renderHook(
      () => {
        useLiveXauusdQuote({ enabled: true });
        return useShellQuote();
      },
      { wrapper }
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.quote?.source).toBe("broker");

    act(() => {
      result.current.setQuote((prev) => {
        if (prev?.source === "broker") return prev;
        return {
          price: 999,
          updatedLabel: "00:00:00",
          source: "decision",
          fresh: true
        };
      });
    });
    expect(result.current.quote?.price).toBeCloseTo(4265.1, 5);
    expect(result.current.quote?.source).toBe("broker");
  });
});
