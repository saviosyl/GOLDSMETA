import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OpenPositionCard } from "./OpenPositionCard";

describe("OpenPositionCard TP display", () => {
  it("shows only strategy-provided TP levels; missing TP2/TP3 are —", () => {
    render(
      <OpenPositionCard
        position={{
          symbol: "XAUUSD",
          side: "BUY",
          entry: 4300,
          current: 4310,
          lots: 0.01,
          stopLoss: 4290,
          tp1: 4350,
          tp2: null,
          tp3: null,
          tp1Status: "PENDING",
          fundsLabel: "DEMO FUNDS",
          managementState: "SL_PROTECTED"
        }}
      />
    );
    expect(screen.getByText("TP1").closest("div")?.querySelector("dd")?.textContent).toMatch(
      /4350\.00/
    );
    expect(screen.getByText("TP2").closest("div")?.querySelector("dd")?.textContent).toBe("—");
    expect(screen.getByText("TP3").closest("div")?.querySelector("dd")?.textContent).toBe("—");
  });
});
