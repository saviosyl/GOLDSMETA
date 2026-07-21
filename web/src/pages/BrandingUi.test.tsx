import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { BrandHeader } from "../components/BrandHeader";
import { SignInPage } from "./SignInPage";
import { BottomNav } from "../components/BottomNav";
import cssText from "../styles/global.css?raw";

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    signIn: vi.fn(),
    signUp: vi.fn(),
    configured: true,
    apiBaseUrl: "https://us-central1-goldmeta-web.cloudfunctions.net/api"
  })
}));

describe("GoldMeta V5.2 branding UI", () => {
  it("renders brand mark in header", () => {
    render(
      <MemoryRouter>
        <BrandHeader />
      </MemoryRouter>
    );
    const img = screen.getByTestId("brand-header").querySelector("img.brand-mark");
    expect(img).toBeTruthy();
    expect(img).toHaveAttribute("src", "/brand/mark-dark.svg");
    expect(screen.getByText("GoldMeta")).toBeInTheDocument();
  });

  it("renders horizontal logo on sign-in", () => {
    render(<SignInPage />);
    expect(screen.getByTestId("signin-logo")).toBeInTheDocument();
    const logo = screen.getByAltText(/GoldMeta — Gold Market Intelligence/i);
    expect(logo).toHaveAttribute("src", "/brand/logo-horizontal-dark.svg");
  });

  it("primary nav remains accessible", () => {
    render(
      <MemoryRouter>
        <BottomNav />
      </MemoryRouter>
    );
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });

  it("safe-area CSS variables are defined", () => {
    expect(cssText).toMatch(/--safe-top/);
    expect(cssText).toMatch(/--safe-bottom/);
    expect(cssText).toMatch(/padding-bottom: calc\(76px \+ var\(--safe-bottom\)\)/);
  });

  it("no broker execution controls in CSS/UI chrome copy", () => {
    expect(cssText).not.toMatch(/BUY NOW|SELL NOW|place order/i);
  });
});
